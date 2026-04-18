-- Migration 005: Multi-content types (GDoc, Email, GitHub, Image)

-- 1. Drop existing CHECK constraint on items.type
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_type_check;

-- 2. Add the widened constraint
ALTER TABLE items ADD CONSTRAINT items_type_check CHECK (
    type IN (
        'book', 'blog', 'paper', 'podcast', 'page', 'tweet', 'video', 'writing',
        'gdoc', 'email_thread', 'github_repo', 'image'
    )
);

-- 3. Email thread: store full message bodies as JSONB array
ALTER TABLE items ADD COLUMN IF NOT EXISTS messages jsonb;

-- 4. GitHub repo: structured metadata columns
ALTER TABLE items ADD COLUMN IF NOT EXISTS github_slug text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS stars integer;
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_commit_at timestamptz;
ALTER TABLE items ADD COLUMN IF NOT EXISTS readme_md text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS file_tree jsonb;

-- 5. Unique index for GitHub dedup per user
CREATE UNIQUE INDEX IF NOT EXISTS items_user_github_slug_idx
    ON items (user_id, github_slug)
    WHERE github_slug IS NOT NULL;
