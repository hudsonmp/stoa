-- MCP retrieval pipeline: project index cache, agent-source metadata.
--
-- This migration is *additive* and coordinates with (but does not depend on):
--   - feat/projects         introduces `folders(id, user_id, parent_id, name, …)`
--                           with path resolution /a/b/c → folder_id.
--   - feat/pdf-foundation   introduces `highlights.selectors jsonb` (W3C Web
--                           Annotation). Until that ships, we add the column
--                           here behind IF NOT EXISTS so annotate_on_behalf has
--                           a place to write selectors.
--   - feat/notes-evergreen  introduces `note_links`. Already shipped (006).
--
-- If feat/projects lands after this, its `folders` migration stays idempotent
-- and both sides can coexist. The path-resolver in the backend (services/
-- project_path.py) falls back to collection-name / NULL when folders don't
-- exist yet.

-- ── highlights: W3C Web Annotation selectors ────────────────────────────────
-- jsonb array of selector objects as defined by W3C Web Annotation Model.
-- Shape: [{ "type": "TextQuoteSelector", "exact": "...", "prefix": "...", "suffix": "..." },
--         { "type": "TextPositionSelector", "start": 123, "end": 456 },
--         { "type": "CssSelector", "value": "div.content > p:nth-child(3)" }]
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS selectors jsonb;

-- ── agent_source: who/what created this record ──────────────────────────────
-- When an agent writes highlights or notes on behalf of the user, it tags the
-- row with its identity so the user can audit, filter, or revert later.
-- Shape: { "agent_id": "claude-code-lit-review-2026-04-18T...", "session_id": "…", "run_id": "…" }
-- Null = user-authored (direct action in UI/extension).
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS agent_source jsonb;
ALTER TABLE notes      ADD COLUMN IF NOT EXISTS agent_source jsonb;

-- ── project_indexes: cache of "when did we last embed the project?" ─────────
-- folder_id nullable so that while feat/projects is unshipped we can index by
-- collection_id or a symbolic path hash; backend decides which column to use.
CREATE TABLE IF NOT EXISTS project_indexes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users,
  folder_id        uuid,                       -- coordinates with feat/projects
  collection_id    uuid REFERENCES collections, -- fallback while folders unship
  path_key         text NOT NULL,              -- canonical "/projects/foo/bar" — source of truth for cache invalidation
  content_hash     text NOT NULL,              -- SHA-256 of sorted(item_id||updated_at + note_id||updated_at)
  chunk_count      int  NOT NULL DEFAULT 0,
  item_count       int  NOT NULL DEFAULT 0,
  note_count       int  NOT NULL DEFAULT 0,
  last_indexed_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, path_key)
);

CREATE INDEX IF NOT EXISTS project_indexes_user_idx
  ON project_indexes (user_id, last_indexed_at DESC);

ALTER TABLE project_indexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own project_indexes"
  ON project_indexes FOR ALL
  USING (auth.uid() = user_id);

-- ── match_notes RPC: cosine similarity over note embeddings ─────────────────
-- Mirrors the shape of match_chunks so the backend can uniformly score notes
-- alongside item chunks. Note embeddings are generated on write via the same
-- embedding service; we store them in a dedicated table (below) rather than
-- mutate `notes` so evergreen-note indexing stays cheap and nullable.

CREATE TABLE IF NOT EXISTS note_embeddings (
  note_id     uuid PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users,
  embedding   vector(768),          -- matches Gemini text-embedding-004 dim
  content_hash text NOT NULL,       -- SHA-256 of note.content; rebuild on mismatch
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_embeddings_user_idx
  ON note_embeddings (user_id);

CREATE INDEX IF NOT EXISTS note_embeddings_vec_idx
  ON note_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

ALTER TABLE note_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own note_embeddings"
  ON note_embeddings FOR ALL
  USING (auth.uid() = user_id);

-- RPC: vector search on notes, optionally filtered by id list (project scope).
-- Note: the existing chunks table uses vector(1536), but Gemini/Google embeddings
-- are 768-dim. We keep this dim-generic by accepting the embedding as a text
-- parameter and casting inside the function — callers pass `::vector(768)`.
CREATE OR REPLACE FUNCTION match_notes(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_user_id uuid,
  filter_note_ids uuid[] DEFAULT NULL,
  filter_evergreen boolean DEFAULT NULL
)
RETURNS TABLE (
  note_id uuid,
  similarity float,
  title text,
  content text,
  evergreen boolean,
  tags text[],
  updated_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    n.id AS note_id,
    1 - (ne.embedding <=> query_embedding) AS similarity,
    n.title,
    n.content,
    n.evergreen,
    n.tags,
    n.updated_at
  FROM note_embeddings ne
  JOIN notes n ON n.id = ne.note_id
  WHERE ne.user_id = filter_user_id
    AND (filter_note_ids IS NULL OR n.id = ANY(filter_note_ids))
    AND (filter_evergreen IS NULL OR n.evergreen = filter_evergreen)
    AND 1 - (ne.embedding <=> query_embedding) > match_threshold
  ORDER BY ne.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Index helper: "which items live under this folder?" — when folders ship,
-- feat/projects will add items.folder_id. Meanwhile we provide a view-free
-- helper that the backend uses with a collection fallback.
