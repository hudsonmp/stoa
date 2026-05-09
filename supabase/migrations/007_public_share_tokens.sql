-- Migration 007: Public share tokens for items
--
-- Design:
--   Public shareable links are a separate access axis from the friends layer.
--   Migration 006 established: "There is NO per-item public/private toggle"
--   for the friends layer — anything a user saves is visible to accepted
--   friends. That's the bidirectional-salon rule. THIS migration does NOT
--   violate it.
--
--   A public share link is a one-off, opt-in, unauthenticated view of a
--   single item's public-facing content (title, highlights, main source
--   note, citation). The owner explicitly generates the link; the link
--   itself is the access credential. No friend relationship is required to
--   read it — that's the whole point of sharing.
--
--   Encoding "shared" as (public_share_token IS NOT NULL) makes enable and
--   disable atomic: generating a token enables sharing, clearing it
--   disables. No races between a boolean flag and the token column.
--
-- Columns added to items:
--   - public_share_token text UNIQUE NULL
--       32-byte URL-safe random (~190 bits entropy). Effectively
--       unenumerable. Presence of this value is the "is shared" flag.
--   - public_shared_at timestamptz NULL
--       Audit trail — when the current token was generated. Cleared on
--       unshare.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS public_share_token text,
  ADD COLUMN IF NOT EXISTS public_shared_at timestamptz;

-- UNIQUE among non-null values (partial index — allows many NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS items_public_share_token_key
  ON items (public_share_token)
  WHERE public_share_token IS NOT NULL;

-- Lookup-by-token is the hot read path; this index makes it O(log n).
CREATE INDEX IF NOT EXISTS items_public_share_token_lookup
  ON items (public_share_token)
  WHERE public_share_token IS NOT NULL;

COMMENT ON COLUMN items.public_share_token IS
  'URL-safe random token. NULL = not shared. NON-NULL = item is publicly viewable at /public/:token (no auth required). Generating a new token rotates the share URL.';

COMMENT ON COLUMN items.public_shared_at IS
  'Timestamp of most recent share-token generation. NULL if not shared.';
