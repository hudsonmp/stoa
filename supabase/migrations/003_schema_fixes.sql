-- Schema fixes from code review

-- #10: Replace IVFFlat with HNSW index for better recall at low row counts
DROP INDEX IF EXISTS chunks_embedding_idx;
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- #9: Prevent duplicate URL saves per user
ALTER TABLE items ADD CONSTRAINT items_user_url_unique UNIQUE (user_id, url);

-- #8: Add ON DELETE CASCADE to foreign keys
ALTER TABLE person_items DROP CONSTRAINT IF EXISTS person_items_person_id_fkey;
ALTER TABLE person_items ADD CONSTRAINT person_items_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;

ALTER TABLE person_items DROP CONSTRAINT IF EXISTS person_items_item_id_fkey;
ALTER TABLE person_items ADD CONSTRAINT person_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE person_connections DROP CONSTRAINT IF EXISTS person_connections_from_person_id_fkey;
ALTER TABLE person_connections ADD CONSTRAINT person_connections_from_person_id_fkey
  FOREIGN KEY (from_person_id) REFERENCES people(id) ON DELETE CASCADE;

ALTER TABLE person_connections DROP CONSTRAINT IF EXISTS person_connections_to_person_id_fkey;
ALTER TABLE person_connections ADD CONSTRAINT person_connections_to_person_id_fkey
  FOREIGN KEY (to_person_id) REFERENCES people(id) ON DELETE CASCADE;

ALTER TABLE citations DROP CONSTRAINT IF EXISTS citations_item_id_fkey;
ALTER TABLE citations ADD CONSTRAINT citations_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE highlights DROP CONSTRAINT IF EXISTS highlights_item_id_fkey;
ALTER TABLE highlights ADD CONSTRAINT highlights_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_item_id_fkey;
ALTER TABLE notes ADD CONSTRAINT notes_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_person_id_fkey;
ALTER TABLE notes ADD CONSTRAINT notes_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE item_tags DROP CONSTRAINT IF EXISTS item_tags_item_id_fkey;
ALTER TABLE item_tags ADD CONSTRAINT item_tags_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE item_tags DROP CONSTRAINT IF EXISTS item_tags_tag_id_fkey;
ALTER TABLE item_tags ADD CONSTRAINT item_tags_tag_id_fkey
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;

ALTER TABLE collection_items DROP CONSTRAINT IF EXISTS collection_items_collection_id_fkey;
ALTER TABLE collection_items ADD CONSTRAINT collection_items_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;

ALTER TABLE collection_items DROP CONSTRAINT IF EXISTS collection_items_item_id_fkey;
ALTER TABLE collection_items ADD CONSTRAINT collection_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_item_id_fkey;
ALTER TABLE chunks ADD CONSTRAINT chunks_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_highlight_id_fkey;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_highlight_id_fkey
  FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE;

ALTER TABLE activity DROP CONSTRAINT IF EXISTS activity_item_id_fkey;
ALTER TABLE activity ADD CONSTRAINT activity_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE activity DROP CONSTRAINT IF EXISTS activity_highlight_id_fkey;
ALTER TABLE activity ADD CONSTRAINT activity_highlight_id_fkey
  FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE;

-- Update match_chunks RPC to support optional type filtering
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_id uuid,
  filter_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  item_id uuid,
  chunk_index int,
  chunk_text text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.item_id,
    c.chunk_index,
    c.chunk_text,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  JOIN items i ON i.id = c.item_id
  WHERE i.user_id = filter_user_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
    AND (filter_type IS NULL OR i.type = filter_type)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
