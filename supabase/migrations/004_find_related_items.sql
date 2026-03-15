-- RPC function to find semantically related items using embedding similarity.
-- Uses the source item's first chunk embedding (title + intro) as the query vector,
-- finds the most similar chunks across all other items, deduplicates by item,
-- and returns the top N most similar items.

CREATE OR REPLACE FUNCTION find_related_items(
  source_item_id uuid,
  filter_user_id uuid,
  match_count int DEFAULT 4
)
RETURNS TABLE (
  id uuid,
  title text,
  url text,
  type text,
  domain text,
  favicon_url text,
  similarity float
)
LANGUAGE plpgsql
AS $$
DECLARE
  source_embedding vector(1536);
BEGIN
  -- Get the first chunk's embedding for the source item
  SELECT c.embedding INTO source_embedding
  FROM chunks c
  WHERE c.item_id = source_item_id
    AND c.chunk_index = 0
  LIMIT 1;

  -- If no embedding found, return empty result set
  IF source_embedding IS NULL THEN
    RETURN;
  END IF;

  -- Find most similar items: group chunks by item, take max similarity per item
  RETURN QUERY
  WITH best_chunks AS (
    SELECT
      c.item_id AS citem_id,
      MAX(1 - (c.embedding <=> source_embedding)) AS sim
    FROM chunks c
    JOIN items i ON i.id = c.item_id
    WHERE i.user_id = filter_user_id
      AND i.id != source_item_id
      AND 1 - (c.embedding <=> source_embedding) > 0.3
    GROUP BY c.item_id
  )
  SELECT
    i.id,
    i.title,
    i.url,
    i.type,
    i.domain,
    i.favicon_url,
    bc.sim AS similarity
  FROM best_chunks bc
  JOIN items i ON i.id = bc.citem_id
  ORDER BY bc.sim DESC
  LIMIT match_count;
END;
$$;
