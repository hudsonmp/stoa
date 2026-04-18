-- Migration 008: Projects + Finder-style folder hierarchy
-- Projects is a NEW, PARALLEL concept to Collections.
-- Collections are NOT modified here.
-- An item can live in a Collection AND a Project folder simultaneously.

-- ────────────────────────────────────────────────
-- 1. projects table
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  name         text NOT NULL,
  description  text,
  color        text,                         -- optional accent color hex
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);

-- ────────────────────────────────────────────────
-- 2. folders table (nested, arbitrary depth)
-- ────────────────────────────────────────────────
-- Root folder: parent_folder_id IS NULL.
-- Each project has exactly one root folder, auto-created on project insert.
-- path: materialised LTREE-style slug for MCP addressing, e.g.
--   /requirement-engineering/computational-thinking
--   kept denormalised for O(1) lookups, maintained by trigger.
CREATE TABLE IF NOT EXISTS folders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_folder_id uuid REFERENCES folders (id) ON DELETE CASCADE,
  name             text NOT NULL,
  path             text NOT NULL,            -- e.g. "/" or "/lit-review/hci"
  sort_order       int DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (parent_folder_id, name)            -- sibling names must be unique; NULL-safe for root
);

CREATE INDEX IF NOT EXISTS folders_project_id_idx      ON folders (project_id);
CREATE INDEX IF NOT EXISTS folders_parent_folder_id_idx ON folders (parent_folder_id);
CREATE INDEX IF NOT EXISTS folders_path_idx            ON folders (project_id, path);

-- ────────────────────────────────────────────────
-- 3. folder_items join table
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS folder_items (
  folder_id  uuid NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  sort_order int DEFAULT 0,
  added_at   timestamptz DEFAULT now(),
  PRIMARY KEY (folder_id, item_id)
);

CREATE INDEX IF NOT EXISTS folder_items_item_id_idx ON folder_items (item_id);

-- ────────────────────────────────────────────────
-- 4. updated_at trigger helper for projects
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────
-- 5. Auto-create root folder on project insert
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_root_folder()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO folders (project_id, parent_folder_id, name, path, sort_order)
  VALUES (NEW.id, NULL, NEW.name, '/', 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_create_root_folder ON projects;
CREATE TRIGGER projects_create_root_folder
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION create_root_folder();

-- ────────────────────────────────────────────────
-- 6. bump projects.updated_at when folder_items changes
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bump_project_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id
  FROM folders
  WHERE id = COALESCE(NEW.folder_id, OLD.folder_id);

  UPDATE projects SET updated_at = now() WHERE id = v_project_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS folder_items_bump_project ON folder_items;
CREATE TRIGGER folder_items_bump_project
  AFTER INSERT OR DELETE ON folder_items
  FOR EACH ROW EXECUTE FUNCTION bump_project_updated_at();

-- ────────────────────────────────────────────────
-- 7. Path resolution helper: resolve_folder_path(project_id, path) -> folder_id
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION resolve_folder_path(p_project_id uuid, p_path text)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM folders
  WHERE project_id = p_project_id
    AND path = p_path
  LIMIT 1;
$$;

-- ────────────────────────────────────────────────
-- 8. RLS policies
-- ────────────────────────────────────────────────
ALTER TABLE projects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_items ENABLE ROW LEVEL SECURITY;

-- projects: owner only
DROP POLICY IF EXISTS projects_owner ON projects;
CREATE POLICY projects_owner ON projects
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- folders: owner via project join
DROP POLICY IF EXISTS folders_owner ON folders;
CREATE POLICY folders_owner ON folders
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- folder_items: owner via folder -> project join
DROP POLICY IF EXISTS folder_items_owner ON folder_items;
CREATE POLICY folder_items_owner ON folder_items
  USING (
    folder_id IN (
      SELECT f.id FROM folders f
      JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    folder_id IN (
      SELECT f.id FROM folders f
      JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = auth.uid()
    )
  );
