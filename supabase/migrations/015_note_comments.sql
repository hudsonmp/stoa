-- Migration 015: Google-Docs-style sidebar comments on project notes.
--
-- A comment is a threaded, range-anchored annotation on a project_note. The
-- anchor is a W3C Web Annotation selector (same shape used by
-- project_highlights.selectors) pointing into the rendered note HTML — the
-- editor also marks the text range with an inline `<span data-comment-id>`
-- so selection loss during re-render is bounded.
--
-- Why range_selector is jsonb
-- ───────────────────────────
-- The selector may be a TextQuoteSelector, a TextPositionSelector, a
-- CssSelector, or a refinedBy composite. Storing jsonb keeps the schema
-- forward-compatible as we evolve anchor machinery; the editor validates
-- shape at write time.
--
-- Threading
-- ─────────
-- `parent_id` nullable -> root comments have no parent, replies reference the
-- root (or any ancestor). Pragma: two-level threading is expected in the UI;
-- the schema does not enforce that.
--
-- Scope
-- ─────
-- Comments attach to `project_notes.id` only. Library notes (notes table) do
-- not have comments; if we need them there later we'll add a second column
-- or a polymorphic ref.

CREATE TABLE IF NOT EXISTS note_comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_note_id  uuid NOT NULL REFERENCES project_notes (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users,
  parent_id        uuid REFERENCES note_comments (id) ON DELETE CASCADE,
  range_selector   jsonb,              -- W3C selector pointing into the note HTML
  body             text NOT NULL,
  resolved         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_comments_note_created_idx
  ON note_comments (project_note_id, created_at);
CREATE INDEX IF NOT EXISTS note_comments_user_idx
  ON note_comments (user_id);
CREATE INDEX IF NOT EXISTS note_comments_parent_idx
  ON note_comments (parent_id);
CREATE INDEX IF NOT EXISTS note_comments_selector_gin
  ON note_comments USING gin (range_selector);

DROP TRIGGER IF EXISTS note_comments_updated_at ON note_comments;
CREATE TRIGGER note_comments_updated_at
  BEFORE UPDATE ON note_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE note_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own note_comments" ON note_comments;
CREATE POLICY "Users manage own note_comments"
  ON note_comments FOR ALL
  USING (auth.uid() = user_id);
