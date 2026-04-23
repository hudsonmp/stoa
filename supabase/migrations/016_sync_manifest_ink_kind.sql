-- Migration 016: Extend sync_manifest for iPad ink sidecars.
--
-- Adds a `kind` column (nullable: existing rows are NULL, which we treat as
-- the default 'file' kind) plus two ink-specific columns:
--
--   * page_index : 0-based page index (ink is per-page).
--   * meta       : jsonb of ink-specific metadata (SHAs for .pkd/.png/meta.json,
--                  page dims in PDF points, raster scale, pk_version).
--
-- Design notes:
--   * We do NOT use an enum: room to add 'ink','comment','annotation' etc.
--     without ALTER TYPE roundtrips. A text column with a CHECK constraint is
--     equivalent at this cardinality (≤4 values).
--   * The uniqueness constraint on (project_id, local_path) still holds for
--     ink rows because `.stoa/ink/<item_id>/p<n>.png` is unique per-(item,page).
--     We store the PNG path as the canonical local_path; .pkd and meta.json
--     SHAs live in `meta` so a single row tracks the whole triple.
--   * Soft-delete semantics: if a page's ink files disappear, we mark the row
--     deleted_at, matching the rest of the engine's tombstone pattern.

ALTER TABLE sync_manifest
  ADD COLUMN IF NOT EXISTS kind        text,
  ADD COLUMN IF NOT EXISTS page_index  integer,
  ADD COLUMN IF NOT EXISTS meta        jsonb;

-- Constrain kind to the known universe so bugs can't silently insert junk.
ALTER TABLE sync_manifest
  DROP CONSTRAINT IF EXISTS sync_manifest_kind_check;

ALTER TABLE sync_manifest
  ADD CONSTRAINT sync_manifest_kind_check
  CHECK (kind IS NULL OR kind IN ('file', 'ink'));

-- Secondary index for ink lookups by (project, item, page).
CREATE INDEX IF NOT EXISTS sync_manifest_ink_lookup_idx
  ON sync_manifest (project_id, item_id, page_index)
  WHERE kind = 'ink' AND deleted_at IS NULL;
