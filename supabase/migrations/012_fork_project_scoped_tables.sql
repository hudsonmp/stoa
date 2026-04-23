-- Migration 012: Fork project-scoped notes, highlights, note_links,
--                 and note_embeddings into their own tables.
--
-- Prior streams (S1 pdf-foundation, S3 notes-evergreen, S5 mcp-retrieval)
-- added Projects-adjacent capabilities (evergreen flag, W3C anchor selectors,
-- @mention backlinks, passage-level mark-and-return) as columns bolted onto
-- the general-purpose `notes` and `highlights` tables. The architectural
-- decision is: those capabilities belong to Projects only. The library
-- (non-Project) notes/highlights must behave as they did pre-merge.
--
-- This migration:
--   1. Creates `project_notes`, `project_highlights`, `project_note_links`,
--      and `project_note_embeddings`.
--   2. Drops the contaminating columns from `notes` and `highlights`.
--   3. Drops `note_links` (reborn as `project_note_links`) and
--      `note_embeddings` (reborn as `project_note_embeddings`).
--
-- Pre-flight: verified counts are zero before running. No data migration
-- needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. project_notes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users,
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  person_id     uuid REFERENCES people (id) ON DELETE SET NULL,
  title         text,
  content       text NOT NULL,
  tags          text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Project-only capabilities
  evergreen              boolean NOT NULL DEFAULT false,
  anchor_selectors       jsonb,
  anchored_highlight_ids uuid[],
  draft_id               text,
  agent_source           jsonb,

  -- Project scope
  project_id  uuid REFERENCES projects (id) ON DELETE CASCADE,
  folder_id   uuid REFERENCES folders  (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS project_notes_user_idx    ON project_notes (user_id);
CREATE INDEX IF NOT EXISTS project_notes_item_idx    ON project_notes (item_id);
CREATE INDEX IF NOT EXISTS project_notes_person_idx  ON project_notes (person_id);
CREATE INDEX IF NOT EXISTS project_notes_project_idx ON project_notes (project_id);
CREATE INDEX IF NOT EXISTS project_notes_folder_idx  ON project_notes (folder_id);

CREATE UNIQUE INDEX IF NOT EXISTS project_notes_user_draft_id_idx
  ON project_notes (user_id, draft_id)
  WHERE draft_id IS NOT NULL;

DROP TRIGGER IF EXISTS project_notes_updated_at ON project_notes;
CREATE TRIGGER project_notes_updated_at
  BEFORE UPDATE ON project_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own project_notes" ON project_notes;
CREATE POLICY "Users manage own project_notes"
  ON project_notes FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. project_highlights
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_highlights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users,
  text          text NOT NULL,
  context       text,
  css_selector  text,
  start_offset  int,
  end_offset    int,
  color         text DEFAULT 'yellow',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Project-only capabilities
  selectors     jsonb,
  page_number   int,
  agent_source  jsonb,

  -- Project scope
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  folder_id     uuid REFERENCES folders  (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS project_highlights_item_idx       ON project_highlights (item_id);
CREATE INDEX IF NOT EXISTS project_highlights_user_idx       ON project_highlights (user_id);
CREATE INDEX IF NOT EXISTS project_highlights_project_idx    ON project_highlights (project_id);
CREATE INDEX IF NOT EXISTS project_highlights_folder_idx     ON project_highlights (folder_id);
CREATE INDEX IF NOT EXISTS project_highlights_page_number_idx
  ON project_highlights (item_id, page_number);
CREATE INDEX IF NOT EXISTS project_highlights_selectors_gin
  ON project_highlights USING gin (selectors);

ALTER TABLE project_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own project_highlights" ON project_highlights;
CREATE POLICY "Users manage own project_highlights"
  ON project_highlights FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. project_note_links
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_note_links (
  source_project_note_id uuid NOT NULL REFERENCES project_notes (id) ON DELETE CASCADE,
  target_ref_type        text NOT NULL CHECK (target_ref_type IN ('note','item','person','folder')),
  target_ref_id          uuid NOT NULL,
  mention_offset         int,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_project_note_id, target_ref_type, target_ref_id, mention_offset)
);

CREATE INDEX IF NOT EXISTS idx_project_note_links_target
  ON project_note_links (target_ref_type, target_ref_id);
CREATE INDEX IF NOT EXISTS idx_project_note_links_source
  ON project_note_links (source_project_note_id);

ALTER TABLE project_note_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own project_note_links" ON project_note_links;
CREATE POLICY "Users manage own project_note_links"
  ON project_note_links FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_notes pn
      WHERE pn.id = project_note_links.source_project_note_id
        AND pn.user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. project_note_embeddings
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_note_embeddings (
  project_note_id  uuid PRIMARY KEY REFERENCES project_notes (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users,
  embedding        vector(768),
  content_hash     text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_note_embeddings_user_idx
  ON project_note_embeddings (user_id);

CREATE INDEX IF NOT EXISTS project_note_embeddings_vec_idx
  ON project_note_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

ALTER TABLE project_note_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own project_note_embeddings" ON project_note_embeddings;
CREATE POLICY "Users manage own project_note_embeddings"
  ON project_note_embeddings FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. match_project_notes RPC — cosine similarity, project-scoped
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_project_notes(
  query_embedding  vector(768),
  match_threshold  float,
  match_count      int,
  filter_user_id   uuid,
  filter_note_ids  uuid[] DEFAULT NULL,
  filter_evergreen boolean DEFAULT NULL
)
RETURNS TABLE (
  note_id    uuid,
  similarity float,
  title      text,
  content    text,
  evergreen  boolean,
  tags       text[],
  updated_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pn.id AS note_id,
    1 - (pne.embedding <=> query_embedding) AS similarity,
    pn.title,
    pn.content,
    pn.evergreen,
    pn.tags,
    pn.updated_at
  FROM project_note_embeddings pne
  JOIN project_notes pn ON pn.id = pne.project_note_id
  WHERE pne.user_id = filter_user_id
    AND (filter_note_ids IS NULL OR pn.id = ANY(filter_note_ids))
    AND (filter_evergreen IS NULL OR pn.evergreen = filter_evergreen)
    AND 1 - (pne.embedding <=> query_embedding) > match_threshold
  ORDER BY pne.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Drop contamination from general-purpose tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notes DROP COLUMN IF EXISTS evergreen;
ALTER TABLE notes DROP COLUMN IF EXISTS anchor_selectors;
ALTER TABLE notes DROP COLUMN IF EXISTS anchored_highlight_ids;
ALTER TABLE notes DROP COLUMN IF EXISTS draft_id;
ALTER TABLE notes DROP COLUMN IF EXISTS agent_source;

DROP INDEX IF EXISTS notes_user_draft_id_idx;

ALTER TABLE highlights DROP COLUMN IF EXISTS selectors;
ALTER TABLE highlights DROP COLUMN IF EXISTS page_number;
ALTER TABLE highlights DROP COLUMN IF EXISTS agent_source;

DROP INDEX IF EXISTS highlights_page_number_idx;
DROP INDEX IF EXISTS highlights_selectors_gin;

DROP TABLE IF EXISTS note_links;

DROP FUNCTION IF EXISTS match_notes(vector, float, int, uuid, uuid[], boolean);
DROP TABLE IF EXISTS note_embeddings;
