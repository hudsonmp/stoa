-- Migration 006: Bidirectional Friendships + Profiles
--
-- Design (replaces the abandoned unidirectional-follow model):
--   - Stoa's social layer is a private salon between mutually-consenting friends,
--     not a broadcast follow graph. Every edge requires both sides to accept.
--   - There is NO per-item public/private toggle. Anything a user saves is
--     visible to their accepted friends, full stop. No activity_visible kill
--     switch, no is_public per-row setting. Simpler trust model.
--
-- What this migration does:
--   1. DROPs the old `follows` table from migration 001 (unused).
--   2. Adds `profiles` table: username + display_name + bio. No visibility flags.
--   3. Adds `friendships` table: directed request row with status (pending | accepted).
--      Friendship is bidirectional iff a row exists in EITHER direction with
--      status='accepted'.
--   4. Backfills profiles for existing auth users + trigger on new signups.
--   5. Rewrites RLS policies on items / highlights / activity to gate cross-user
--      reads on "exists an accepted friendship between viewer and owner".
--   6. Drops the `activity.is_public` dependency — everything is visible to
--      friends, so `is_public` becomes vestigial. Left in place for data safety
--      but no policy reads it anymore.

-- ---------------------------------------------------------------------------
-- 1. Drop the old unidirectional follows table
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS follows CASCADE;

-- Remove the old "read public activity" policy from migration 001 — its
-- is_public semantic is gone under the new model.
DROP POLICY IF EXISTS "Users read public activity" ON activity;

-- ---------------------------------------------------------------------------
-- 2. profiles — one row per Stoa user, public identity only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username);

-- Backfill: give every existing auth user a placeholder profile.
-- Username is derived from email local-part + a slice of the user_id for
-- collision safety. The owner will rename via the setup flow on first login.
INSERT INTO profiles (user_id, username, display_name)
SELECT
  u.id,
  lower(regexp_replace(split_part(u.email, '@', 1), '[^a-z0-9_]', '_', 'g'))
    || '_' || substring(u.id::text, 1, 6),
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
FROM auth.users u
LEFT JOIN profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL
ON CONFLICT DO NOTHING;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_username text;
BEGIN
  base_username := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9_]', '_', 'g'));
  base_username := left(base_username, 18);

  INSERT INTO profiles (user_id, username, display_name)
  VALUES (
    NEW.id,
    base_username || '_' || substring(NEW.id::text, 1, 6),
    coalesce(NEW.raw_user_meta_data->>'full_name', base_username)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are publicly readable" ON profiles;
CREATE POLICY "Profiles are publicly readable" ON profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
CREATE POLICY "Users insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. friendships — bidirectional consent via status='accepted'
-- ---------------------------------------------------------------------------
-- One row per directed request. The ACCEPTED state represents a mutual
-- friendship regardless of which direction the request flowed. The helper
-- function `are_friends(a, b)` abstracts the "check either direction" query.

CREATE TABLE IF NOT EXISTS friendships (
  requester_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  addressee_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Read: you can see any friendship row involving yourself (own outbox/inbox).
-- You can also see accepted friendships between other users so the mutual
-- friends list on profiles works.
DROP POLICY IF EXISTS "Users read own friendships" ON friendships;
CREATE POLICY "Users read own friendships" ON friendships
  FOR SELECT USING (
    auth.uid() = requester_id
    OR auth.uid() = addressee_id
    OR status = 'accepted'
  );

-- Insert: only you can send requests on your own behalf.
DROP POLICY IF EXISTS "Users create own friendship requests" ON friendships;
CREATE POLICY "Users create own friendship requests" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = requester_id);

-- Update: only the addressee can flip status pending → accepted. (We use the
-- app layer to enforce this specific transition; the RLS policy just ensures
-- the addressee is the one who can modify the row.)
DROP POLICY IF EXISTS "Addressee updates own friendship requests" ON friendships;
CREATE POLICY "Addressee updates own friendship requests" ON friendships
  FOR UPDATE USING (auth.uid() = addressee_id);

-- Delete: either side can break the friendship (unfriend) or withdraw a
-- pending request.
DROP POLICY IF EXISTS "Either party deletes friendship" ON friendships;
CREATE POLICY "Either party deletes friendship" ON friendships
  FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Helper: are two users in an accepted friendship?
CREATE OR REPLACE FUNCTION are_friends(user_a uuid, user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = user_a AND addressee_id = user_b)
        OR (requester_id = user_b AND addressee_id = user_a)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Cross-user read policies — friends can see each other's saves
-- ---------------------------------------------------------------------------
-- The "you see your friends' bookshelves" property comes from RLS, not app
-- logic. Each policy reads: "you can see this row if it's yours OR if the
-- owner is an accepted friend of yours."

-- Items: already has "Users manage own items" (FOR ALL). Add a friends SELECT.
DROP POLICY IF EXISTS "Friends read each others items" ON items;
CREATE POLICY "Friends read each others items" ON items
  FOR SELECT USING (
    auth.uid() = user_id
    OR are_friends(auth.uid(), user_id)
  );

-- Highlights: same pattern. Friends can see each other's highlights.
DROP POLICY IF EXISTS "Friends read each others highlights" ON highlights;
CREATE POLICY "Friends read each others highlights" ON highlights
  FOR SELECT USING (
    auth.uid() = user_id
    OR are_friends(auth.uid(), user_id)
  );

-- Activity: friends read each other's feed rows.
DROP POLICY IF EXISTS "Friends read each others activity" ON activity;
CREATE POLICY "Friends read each others activity" ON activity
  FOR SELECT USING (
    auth.uid() = user_id
    OR are_friends(auth.uid(), user_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Activity feed view — joined profile + item, filtered to friend activity
-- ---------------------------------------------------------------------------
-- Consumed by /social/feed. The view doesn't filter by viewer (RLS handles
-- that), just joins for display convenience.
CREATE OR REPLACE VIEW activity_feed AS
SELECT
  a.id,
  a.user_id,
  a.action,
  a.item_id,
  a.highlight_id,
  a.created_at,
  p.username,
  p.display_name,
  p.avatar_url,
  i.title AS item_title,
  i.url AS item_url,
  i.type AS item_type,
  i.cover_image_url AS item_cover_image_url,
  i.domain AS item_domain,
  i.favicon_url AS item_favicon_url
FROM activity a
JOIN profiles p ON p.user_id = a.user_id
LEFT JOIN items i ON i.id = a.item_id;

-- ---------------------------------------------------------------------------
-- 6. Hudson's profile — claim 'hudson' username
-- ---------------------------------------------------------------------------
-- Hudson explicitly asked for username 'hudson'. This runs at migration time
-- so it's deterministic: find Hudson's auth user via email, update their
-- profile username. Safe to re-run (idempotent via ON CONFLICT handling).
DO $$
DECLARE
  hudson_id uuid;
BEGIN
  SELECT id INTO hudson_id
  FROM auth.users
  WHERE email ILIKE 'hudson%' OR email ILIKE '%hudsonmp%' OR email ILIKE '%mitchell%pullman%'
  ORDER BY created_at ASC
  LIMIT 1;

  IF hudson_id IS NOT NULL THEN
    UPDATE profiles
    SET username = 'hudson',
        display_name = coalesce(display_name, 'Hudson Mitchell-Pullman'),
        updated_at = now()
    WHERE user_id = hudson_id
      AND NOT EXISTS (SELECT 1 FROM profiles WHERE username = 'hudson' AND user_id <> hudson_id);
  END IF;
END $$;
