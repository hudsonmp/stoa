-- Idempotency key for client-driven note creation (autosave race fix).
--
-- The PDF note editor generates a `draft_id` UUID once per editing session and
-- sends it on the first POST /notes.  If a concurrent request (same tab crash,
-- service worker retry, etc.) POSTs the same draft_id before the first
-- response arrives, the backend returns the existing row instead of inserting
-- a duplicate.
--
-- Constraints:
--   - draft_id is nullable: legacy notes created without it are unaffected.
--   - The partial unique index covers only non-NULL draft_ids so multiple old
--     rows with NULL are fine.

-- 1. Add column
ALTER TABLE notes ADD COLUMN IF NOT EXISTS draft_id text;

-- 2. Partial unique index: (user_id, draft_id) WHERE draft_id IS NOT NULL
--    This enforces idempotency without affecting rows that predate this column.
CREATE UNIQUE INDEX IF NOT EXISTS notes_user_draft_id_idx
  ON notes (user_id, draft_id)
  WHERE draft_id IS NOT NULL;
