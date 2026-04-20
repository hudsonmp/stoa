-- Migration 014: Bidirectional filesystem sync for Projects
--
-- Adds:
--   1. Per-project sync configuration (sync_path, sync_enabled, last_synced_at)
--      on `projects`.
--   2. `sync_manifest` table that records the item ↔ local path ↔ content-hash
--      mapping used by the vault reconciliation engine. Manifest rows are the
--      vault-local ground truth; the on-disk `.stoa/manifest.json` is written
--      from this table and read back during scans to detect out-of-band edits.
--
-- Design notes:
--   * `local_path` is vault-relative ("Paper Title.pdf", "_evergreen/Note.md").
--     Full OS paths live only in `projects.sync_path` so the manifest is
--     portable across devices (Stage 5 clone).
--   * `content_hash` is SHA-256 hex (64 chars). For notes, it hashes the body
--     after the YAML frontmatter so round-trip updated_at shuffles don't false-
--     positive as changes.
--   * `deleted_at` supports soft-delete reconciliation: if a file disappears
--     locally we mark the manifest row deleted, write a tombstone, and then
--     the router can optionally soft-delete the underlying item.

-- ─── 1. projects: sync config ─────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sync_path        text,
  ADD COLUMN IF NOT EXISTS sync_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at   timestamptz;

-- ─── 2. sync_manifest table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_manifest (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  item_id          uuid REFERENCES items (id) ON DELETE SET NULL,
  -- note_id points at project_notes; FK added when ON DELETE semantics settle
  note_id          uuid,
  local_path       text NOT NULL,                  -- vault-relative
  content_hash     text NOT NULL,                  -- sha256 hex
  last_synced_at   timestamptz NOT NULL DEFAULT now(),
  last_mtime       timestamptz,                    -- fs mtime at last sync
  last_size        bigint,
  deleted_at       timestamptz,
  conflict         boolean NOT NULL DEFAULT false,
  conflict_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One manifest row per (project, vault-relative path).
CREATE UNIQUE INDEX IF NOT EXISTS sync_manifest_project_path_idx
  ON sync_manifest (project_id, local_path)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sync_manifest_project_idx ON sync_manifest (project_id);
CREATE INDEX IF NOT EXISTS sync_manifest_item_idx    ON sync_manifest (item_id);
CREATE INDEX IF NOT EXISTS sync_manifest_note_idx    ON sync_manifest (note_id);
CREATE INDEX IF NOT EXISTS sync_manifest_user_idx    ON sync_manifest (user_id);
CREATE INDEX IF NOT EXISTS sync_manifest_conflict_idx
  ON sync_manifest (project_id) WHERE conflict = true;

-- updated_at trigger (reuses set_updated_at created in migration 008).
DROP TRIGGER IF EXISTS sync_manifest_updated_at ON sync_manifest;
CREATE TRIGGER sync_manifest_updated_at
  BEFORE UPDATE ON sync_manifest
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE sync_manifest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own sync_manifest" ON sync_manifest;
CREATE POLICY "Users manage own sync_manifest"
  ON sync_manifest FOR ALL
  USING (auth.uid() = user_id);

-- ─── 4. items: soft-delete support (spec Stage 2: "soft-delete in Stoa") ──────
-- Existing callers must treat deleted_at IS NOT NULL as deleted.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS items_deleted_at_idx
  ON items (user_id) WHERE deleted_at IS NOT NULL;

-- ─── 5. project_notes: soft-delete for fs-deleted notes ──────────────────────

ALTER TABLE project_notes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
