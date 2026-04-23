-- Migration 008: Friends visibility — defensive exclusion of writings
--
-- Context
--   Migration 006 established the bidirectional-salon rule: anything a user
--   saves is visible to accepted friends, full stop, no per-item toggle.
--   Verified state of the DB on 2026-04-10:
--     - items       : friends read  (all types, no discrimination)
--     - highlights  : friends read
--     - activity    : friends read
--     - notes       : OWNER ONLY (no friend-read policy; already private)
--
--   User request (2026-04-10): "pages I save can be public [to friends],
--   writings and my notes on them should NOT be visible to friends,
--   highlights CAN be public [to friends]."
--
--   The user's rule decomposes to:
--     - items of type != 'writing'  → friends read  (unchanged)
--     - items of type == 'writing'  → private from friends  (THIS CHANGE)
--     - all notes                   → private from friends  (already true)
--     - all highlights              → friends read  (unchanged)
--
--   In Stoa, writings are NOT items of type='writing' in practice —
--   Writings.tsx creates notes tagged 'writing' (10 rows exist). Since
--   notes are already friend-private, writings are already friend-private.
--   BUT the items.type check constraint permits 'writing', and
--   ItemDetail.tsx's type dropdown lets a user convert an existing item
--   to type='writing'. This migration closes that hole defensively.
--
-- Two changes:
--   1. items RLS: rewrite the friend-read policy to exclude type='writing'.
--   2. activity_feed view: add a type filter so the service-role client
--      in /social/feed doesn't leak writing-type activity. RLS is
--      bypassed by the service role, so the view is the enforcement
--      point for that codepath.

-- ---------------------------------------------------------------------------
-- 1. Rewrite the items friend-read RLS policy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Friends read each others items" ON items;

CREATE POLICY "Friends read each others items" ON items
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      are_friends(auth.uid(), user_id)
      AND type IS DISTINCT FROM 'writing'
    )
  );

COMMENT ON POLICY "Friends read each others items" ON items IS
  'Writings are private from friends even under the bidirectional-salon rule — they are thinking-in-progress. Notes inherit the same rule via the absence of any friend-read policy on the notes table. Public share tokens (migration 007) are an orthogonal opt-in broadcast and override this policy for the single item whose token the viewer possesses.';

-- ---------------------------------------------------------------------------
-- 2. Rewrite activity_feed view to hide writing-type activity
-- ---------------------------------------------------------------------------
-- /social/feed uses the service-role Supabase client, which has BYPASSRLS
-- baked in. That means the policy above does NOT constrain the feed
-- endpoint — we must enforce the rule at the view level.
--
-- `IS DISTINCT FROM` (not `!=`) is load-bearing: the LEFT JOIN produces
-- NULL i.type for activity rows without an associated item (e.g. profile
-- updates, future friendship events). `NULL != 'writing'` evaluates to
-- NULL, which is falsy — using `!=` would silently drop those rows.

DROP VIEW IF EXISTS activity_feed;

CREATE VIEW activity_feed AS
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
  i.title              AS item_title,
  i.url                AS item_url,
  i.type               AS item_type,
  i.cover_image_url    AS item_cover_image_url,
  i.domain             AS item_domain,
  i.favicon_url        AS item_favicon_url
FROM activity a
JOIN profiles p ON p.user_id = a.user_id
LEFT JOIN items i ON i.id = a.item_id
WHERE i.type IS DISTINCT FROM 'writing';

COMMENT ON VIEW activity_feed IS
  'Friend activity feed — joins activity, profiles, and items. Filters out writing-type items so the /social/feed endpoint (which uses the service-role client and bypasses RLS) cannot leak writings between friends. IS DISTINCT FROM is intentional: LEFT JOIN produces NULL item.type for non-item activity (profile updates, friendship events), and those rows should remain visible.';
