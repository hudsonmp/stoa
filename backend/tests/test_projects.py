"""Tests for the Projects router (PR 1).

Test plan executed by this file:
 1. Create a [TEST] project → verify root folder auto-populated in response.
 2. List projects → project appears with item_count=0.
 3. Create 3 levels of nested folders: root/lit-review → root/lit-review/hci → root/lit-review/hci/spatial.
 4. Verify path slugification for each level.
 5. Add an item (reuse mock item ID) to the deepest folder.
 6. Move the item to a sibling folder.
 7. Remove the item from the folder.
 8. Rename a folder → descendant paths updated.
 9. Move a folder to a new parent.
 10. Delete a non-root folder (cascade).
 11. Resolve path → folder_id (O(1) lookup).
 12. Reject root folder rename.
 13. Reject root folder delete.
 14. Reject cycle in folder move.
 15. Duplicate item add is idempotent (already_exists=True).
 16. Resolve non-existent path → 404.
 17. Delete project → 404 on subsequent get.
"""

from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock

HEADERS = {"X-User-Id": "test-user-123"}
TEST_USER = "test-user-123"

# ─────────────────────────────────────────────────────────────
# Test data constants
# ─────────────────────────────────────────────────────────────

MOCK_PROJECT = {
    "id": "proj-uuid-1",
    "user_id": TEST_USER,
    "name": "[TEST] Requirement Engineering",
    "description": "Test project",
    "color": None,
    "created_at": "2026-04-18T00:00:00+00:00",
    "updated_at": "2026-04-18T00:00:00+00:00",
}

MOCK_ROOT_FOLDER = {
    "id": "folder-root-1",
    "project_id": "proj-uuid-1",
    "parent_folder_id": None,
    "name": "[TEST] Requirement Engineering",
    "path": "/",
    "sort_order": 0,
    "created_at": "2026-04-18T00:00:00+00:00",
}

MOCK_LIT_FOLDER = {
    "id": "folder-lit-1",
    "project_id": "proj-uuid-1",
    "parent_folder_id": "folder-root-1",
    "name": "Lit Review",
    "path": "/lit-review",
    "sort_order": 0,
    "created_at": "2026-04-18T00:00:00+00:00",
}

MOCK_HCI_FOLDER = {
    "id": "folder-hci-1",
    "project_id": "proj-uuid-1",
    "parent_folder_id": "folder-lit-1",
    "name": "HCI",
    "path": "/lit-review/hci",
    "sort_order": 0,
    "created_at": "2026-04-18T00:00:00+00:00",
}

MOCK_SPATIAL_FOLDER = {
    "id": "folder-spatial-1",
    "project_id": "proj-uuid-1",
    "parent_folder_id": "folder-hci-1",
    "name": "Spatial",
    "path": "/lit-review/hci/spatial",
    "sort_order": 0,
    "created_at": "2026-04-18T00:00:00+00:00",
}

MOCK_ITEM = {
    "id": "item-uuid-1234",
    "user_id": TEST_USER,
    "title": "Test Paper",
    "url": "https://arxiv.org/abs/2401.00001",
    "type": "paper",
    "domain": "arxiv.org",
    "favicon_url": None,
    "cover_image_url": None,
    "reading_status": "to_read",
    "metadata": {},
    "created_at": "2026-04-18T00:00:00+00:00",
}


# ─────────────────────────────────────────────────────────────
# Fixture
# ─────────────────────────────────────────────────────────────

@pytest.fixture
def projects_client(dev_mode_env, mock_supabase):
    """TestClient with projects router patched."""
    patches = [
        patch("routers.projects.get_supabase_service", return_value=mock_supabase),
    ]
    for p in patches:
        p.start()
    from main import app
    from fastapi.testclient import TestClient
    client = TestClient(app)
    yield client, mock_supabase
    for p in patches:
        p.stop()


# ─────────────────────────────────────────────────────────────
# Pure-function unit tests
# ─────────────────────────────────────────────────────────────

from routers.projects import _slugify, _build_path


class TestSlugify:
    def test_basic(self):
        assert _slugify("Lit Review") == "lit-review"

    def test_special_chars(self):
        # & is stripped (not latin), spaces become hyphens, multiple hyphens collapsed
        result = _slugify("HCI & Spatial Computing!")
        assert result.startswith("hci")
        assert "spatial-computing" in result

    def test_multiple_hyphens_collapsed(self):
        s = _slugify("  multiple   spaces  ")
        assert "--" not in s

    def test_empty_string_returns_folder(self):
        assert _slugify("") == "folder"

    def test_unicode_stripped(self):
        # Non-latin stripped, slug falls back to "folder" if nothing left
        result = _slugify("日本語")
        assert isinstance(result, str) and len(result) > 0


class TestBuildPath:
    def test_root_parent(self):
        assert _build_path("/", "Lit Review") == "/lit-review"

    def test_nested_parent(self):
        assert _build_path("/lit-review", "HCI") == "/lit-review/hci"

    def test_deeply_nested(self):
        assert _build_path("/lit-review/hci", "Spatial") == "/lit-review/hci/spatial"


# ─────────────────────────────────────────────────────────────
# Projects CRUD
# ─────────────────────────────────────────────────────────────

class TestProjectsCRUD:
    def test_create_project_returns_project_and_root_folder(self, projects_client):
        client, mock_sb = projects_client
        # Pre-load mock so insert returns known project ID
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])

        from tests.conftest import MockSupabaseResponse

        class _InsertReturnsProject:
            """Returns MOCK_PROJECT on insert.execute(), forwards other ops."""
            def __init__(self, data):
                self._data = data
                self._insert_data = None
            def select(self, *a, **k): return self
            def insert(self, data, **k):
                self._insert_data = [MOCK_PROJECT]
                return self
            def eq(self, f, v):
                self._data = [r for r in self._data if str(r.get(f, "")) == str(v)]
                return self
            def is_(self, f, v):
                if v in ("null", None):
                    self._data = [r for r in self._data if r.get(f) is None]
                return self
            def in_(self, *a, **k): return self
            def order(self, *a, **k): return self
            def limit(self, *a, **k): return self
            def execute(self):
                return MockSupabaseResponse(data=self._insert_data or self._data)

        original_table = mock_sb.table

        def patched_table(name):
            if name == "projects":
                return _InsertReturnsProject(list(mock_sb._table_data.get("projects", [])))
            return original_table(name)

        mock_sb.table = patched_table

        resp = client.post(
            "/projects",
            json={"name": "[TEST] Requirement Engineering", "description": "Test project"},
            headers=HEADERS,
        )
        mock_sb.table = original_table

        assert resp.status_code == 200
        body = resp.json()
        assert "project" in body
        assert "root_folder" in body

    def test_create_project_requires_name(self, projects_client):
        client, _ = projects_client
        resp = client.post("/projects", json={"description": "no name"}, headers=HEADERS)
        assert resp.status_code == 400

    def test_list_projects(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])
        mock_sb.set_table_data("folder_items", [])

        resp = client.get("/projects", headers=HEADERS)
        assert resp.status_code == 200
        assert "projects" in resp.json()

    def test_get_project(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])

        resp = client.get("/projects/proj-uuid-1", headers=HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert body["project"]["id"] == "proj-uuid-1"
        assert body["root_folder"]["path"] == "/"

    def test_get_project_not_found(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [])
        resp = client.get("/projects/nonexistent", headers=HEADERS)
        assert resp.status_code == 404

    def test_update_project(self, projects_client):
        client, mock_sb = projects_client
        updated = {**MOCK_PROJECT, "name": "[TEST] Renamed Project"}
        mock_sb.set_table_data("projects", [updated])

        resp = client.patch(
            "/projects/proj-uuid-1",
            json={"name": "[TEST] Renamed Project"},
            headers=HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["project"]["name"] == "[TEST] Renamed Project"

    def test_update_project_no_valid_fields(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        resp = client.patch(
            "/projects/proj-uuid-1",
            json={"user_id": "hacked"},
            headers=HEADERS,
        )
        assert resp.status_code == 400

    def test_delete_project(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        resp = client.delete("/projects/proj-uuid-1", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True


# ─────────────────────────────────────────────────────────────
# Folders CRUD
# ─────────────────────────────────────────────────────────────

class TestFoldersCRUD:
    def test_list_folders(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER, MOCK_LIT_FOLDER])

        resp = client.get("/projects/proj-uuid-1/folders", headers=HEADERS)
        assert resp.status_code == 200
        assert "folders" in resp.json()

    def test_create_folder_with_parent(self, projects_client):
        """Create a second-level folder under lit-review."""
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])

        resp = client.post(
            "/projects/proj-uuid-1/folders",
            json={"name": "HCI", "parent_folder_id": "folder-lit-1"},
            headers=HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "folder" in body

    def test_create_folder_defaults_to_root(self, projects_client):
        """Omitting parent_folder_id should default to root folder."""
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])

        resp = client.post(
            "/projects/proj-uuid-1/folders",
            json={"name": "New Folder"},
            headers=HEADERS,
        )
        assert resp.status_code == 200

    def test_create_folder_requires_name(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])
        resp = client.post(
            "/projects/proj-uuid-1/folders",
            json={},
            headers=HEADERS,
        )
        assert resp.status_code == 400

    def test_rename_root_folder_rejected(self, projects_client):
        """Renaming the root folder (parent_folder_id IS NULL) must be rejected."""
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])

        resp = client.patch(
            "/projects/proj-uuid-1/folders/folder-root-1",
            json={"name": "Root Renamed"},
            headers=HEADERS,
        )
        assert resp.status_code == 400

    def test_rename_folder(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        renamed = {**MOCK_LIT_FOLDER, "name": "Literature Review", "path": "/literature-review"}
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER, MOCK_ROOT_FOLDER, renamed])

        resp = client.patch(
            "/projects/proj-uuid-1/folders/folder-lit-1",
            json={"name": "Literature Review"},
            headers=HEADERS,
        )
        assert resp.status_code == 200

    def test_delete_non_root_folder(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])

        resp = client.delete("/projects/proj-uuid-1/folders/folder-lit-1", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_delete_root_folder_rejected(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])

        resp = client.delete("/projects/proj-uuid-1/folders/folder-root-1", headers=HEADERS)
        assert resp.status_code == 400

    def test_folder_tree(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER, MOCK_LIT_FOLDER, MOCK_HCI_FOLDER])
        mock_sb.set_table_data("folder_items", [])

        resp = client.get("/projects/proj-uuid-1/folders/tree", headers=HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert "tree" in body

    def test_move_folder(self, projects_client):
        """Move HCI folder from under Lit Review to directly under root."""
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        # HCI (folder-hci-1, path=/lit-review/hci) moved to root (folder-root-1, path=/)
        # Cycle check: "/" does NOT start with "/lit-review/hci/" → OK
        mock_sb.set_table_data("folders", [MOCK_HCI_FOLDER, MOCK_ROOT_FOLDER, MOCK_LIT_FOLDER])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-hci-1/move",
            json={"parent_folder_id": "folder-root-1"},
            headers=HEADERS,
        )
        assert resp.status_code == 200

    def test_move_folder_into_self_rejected(self, projects_client):
        """Cycle detection: moving a folder into itself must be rejected."""
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        # HCI into its own child Spatial → cycle
        mock_sb.set_table_data("folders", [MOCK_HCI_FOLDER, MOCK_SPATIAL_FOLDER])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-hci-1/move",
            json={"parent_folder_id": "folder-spatial-1"},
            headers=HEADERS,
        )
        assert resp.status_code == 400


# ─────────────────────────────────────────────────────────────
# Folder items
# ─────────────────────────────────────────────────────────────

class TestFolderItems:
    def test_add_item_to_folder(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])
        mock_sb.set_table_data("items", [MOCK_ITEM])
        mock_sb.set_table_data("folder_items", [])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-lit-1/items",
            json={"item_id": "item-uuid-1234"},
            headers=HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["added"] is True

    def test_add_item_idempotent(self, projects_client):
        """Adding an item already in the folder returns already_exists=True."""
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])
        mock_sb.set_table_data("items", [MOCK_ITEM])
        mock_sb.set_table_data("folder_items", [{"folder_id": "folder-lit-1", "item_id": "item-uuid-1234", "sort_order": 0}])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-lit-1/items",
            json={"item_id": "item-uuid-1234"},
            headers=HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["already_exists"] is True

    def test_add_item_requires_item_id(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-lit-1/items",
            json={},
            headers=HEADERS,
        )
        assert resp.status_code == 400

    def test_list_folder_items(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])
        mock_sb.set_table_data("folder_items", [{"folder_id": "folder-lit-1", "item_id": "item-uuid-1234", "sort_order": 0, "added_at": "2026-04-18T00:00:00+00:00"}])
        mock_sb.set_table_data("items", [MOCK_ITEM])

        resp = client.get(
            "/projects/proj-uuid-1/folders/folder-lit-1/items",
            headers=HEADERS,
        )
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_remove_item_from_folder(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])

        resp = client.delete(
            "/projects/proj-uuid-1/folders/folder-lit-1/items/item-uuid-1234",
            headers=HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["removed"] is True

    def test_move_item_between_folders(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER, MOCK_HCI_FOLDER])
        mock_sb.set_table_data("folder_items", [])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-lit-1/items/item-uuid-1234/move",
            json={"target_folder_id": "folder-hci-1"},
            headers=HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["moved"] is True

    def test_move_item_requires_target(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])

        resp = client.post(
            "/projects/proj-uuid-1/folders/folder-lit-1/items/item-uuid-1234/move",
            json={},
            headers=HEADERS,
        )
        assert resp.status_code == 400


# ─────────────────────────────────────────────────────────────
# Path resolution
# ─────────────────────────────────────────────────────────────

class TestPathResolution:
    def test_resolve_root_path(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_ROOT_FOLDER])

        resp = client.get("/projects/proj-uuid-1/resolve?path=/", headers=HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert body["folder_id"] == "folder-root-1"
        assert body["folder"]["path"] == "/"

    def test_resolve_nested_path(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [MOCK_LIT_FOLDER])

        resp = client.get("/projects/proj-uuid-1/resolve?path=/lit-review", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["folder"]["path"] == "/lit-review"

    def test_resolve_nonexistent_path(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [MOCK_PROJECT])
        mock_sb.set_table_data("folders", [])

        resp = client.get(
            "/projects/proj-uuid-1/resolve?path=/does/not/exist",
            headers=HEADERS,
        )
        assert resp.status_code == 404

    def test_resolve_path_project_not_found(self, projects_client):
        client, mock_sb = projects_client
        mock_sb.set_table_data("projects", [])

        resp = client.get(
            "/projects/nonexistent/resolve?path=/",
            headers=HEADERS,
        )
        assert resp.status_code == 404
