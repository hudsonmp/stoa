-- Migration 013: searchable tags on project highlights
-- Tags are short interpretive-frame labels ("cite", "method", "question", etc.)
-- distinct from the longer-form `note` column on a highlight.
--
-- Cognitive-science grounding: tags externalize the reader's interpretive
-- frame at ~zero cognitive cost (vs a note, which triggers the generation
-- effect but interrupts reading flow). Tags are the retrieval index; notes
-- are the synthesis. Different jobs.

ALTER TABLE project_highlights
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- GIN index for array-containment queries (e.g. WHERE 'cite' = ANY(tags)
-- or tags @> ARRAY['cite']). Cheap writes, fast tag-filter reads.
CREATE INDEX IF NOT EXISTS project_highlights_tags_gin
  ON project_highlights USING GIN (tags);
