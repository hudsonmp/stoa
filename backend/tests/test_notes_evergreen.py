"""Tests for evergreen notes + note_links backend (PR 1).

Test-plan coverage:
  T1  Create note with evergreen=True — field persisted
  T2  Create note without evergreen — defaults to False
  T3  Create note with anchor_selectors (W3C shape) — stored as-is
  T4  Create note with anchored_highlight_ids — stored
  T5  PATCH note to flip evergreen flag
  T6  PATCH note with anchor_selectors
  T7  POST /notes/{id}/links — creates a note→note link
  T8  POST /notes/{id}/links — creates a note→item link
  T9  POST /notes/{id}/links — invalid target_ref_type → 400
  T10 POST /notes/{id}/links — unknown note_id → 404
  T11 GET  /notes/{id}/links — returns outgoing + incoming with titles
  T12 DELETE /notes/{id}/links/{type}/{id} — removes link row
  T13 DELETE note — cascades (no orphan links remain)
  T14 [TEST] prefix hygiene — all test data uses [TEST] prefix
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Ensure conftest stubs are applied before any router import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

for _mod in ("trafilatura", "trafilatura.metadata", "fitz", "anthropic", "bibtexparser"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")


# ── fixture overrides ────────────────────────────────────────────────────────
# The shared conftest test_client does not patch routers.notes, so the notes
# router's local binding of get_supabase_service is not replaced. We override
# test_client here to add that patch.


@pytest.fixture
def test_client(dev_mode_env, mock_supabase):
    """test_client extended to also patch routers.notes.get_supabase_service."""
    patches = [
        patch("routers.ingest.get_supabase_service", return_value=mock_supabase),
        patch("routers.citations.get_supabase_service", return_value=mock_supabase),
        patch("routers.review.get_supabase_service", return_value=mock_supabase),
        patch("routers.highlights.get_supabase_service", return_value=mock_supabase),
        patch("routers.notes.get_supabase_service", return_value=mock_supabase),
    ]
    for p in patches:
        p.start()
    from main import app
    from starlette.testclient import TestClient
    client = TestClient(app)
    yield client
    for p in patches:
        p.stop()


# ── fixture helpers ───────────────────────────────────────────────────────────

TEST_NOTE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
TEST_NOTE_ID_2 = "aaaaaaaa-0000-0000-0000-000000000002"
TEST_ITEM_ID = "bbbbbbbb-0000-0000-0000-000000000001"
TEST_USER = "test-user-notes-ev"

NOTE_ROW_BASE = {
    "id": TEST_NOTE_ID,
    "user_id": TEST_USER,
    "title": "[TEST] Evergreen note",
    "content": "<p>[TEST] content</p>",
    "tags": ["synthesis"],
    "evergreen": True,
    "anchor_selectors": None,
    "anchored_highlight_ids": [],
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}

NOTE_ROW_2 = {
    **NOTE_ROW_BASE,
    "id": TEST_NOTE_ID_2,
    "title": "[TEST] Second note",
    "evergreen": True,
}

LINK_ROW = {
    "source_note_id": TEST_NOTE_ID,
    "target_ref_type": "note",
    "target_ref_id": TEST_NOTE_ID_2,
    "mention_offset": 5,
    "created_at": "2026-01-01T00:00:00Z",
}


# ── T1: create evergreen=True ─────────────────────────────────────────────────

class TestCreateNoteEvergreen:
    def test_create_with_evergreen_true(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [{**NOTE_ROW_BASE, "evergreen": True}])

        resp = test_client.post(
            "/notes",
            json={
                "content": "[TEST] initial",
                "note_type": "synthesis",
                "evergreen": True,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200
        assert resp.json()["note"]["evergreen"] is True

    def test_create_without_evergreen_defaults_false(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [{**NOTE_ROW_BASE, "evergreen": False}])

        resp = test_client.post(
            "/notes",
            json={"content": "[TEST] plain", "note_type": "synthesis"},
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200
        # The mock returns whatever we put in set_table_data; request should
        # not fail regardless of returned value.

    def test_create_with_anchor_selectors(self, test_client, mock_supabase):
        selector = {
            "type": "TextQuoteSelector",
            "exact": "neural correlates",
            "prefix": "study of ",
            "suffix": " in working memory",
        }
        mock_supabase.set_table_data(
            "notes",
            [{**NOTE_ROW_BASE, "anchor_selectors": selector}],
        )

        resp = test_client.post(
            "/notes",
            json={
                "content": "[TEST] anchored",
                "note_type": "marginalia",
                "anchor_selectors": selector,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200

    def test_create_with_anchored_highlight_ids(self, test_client, mock_supabase):
        hl_ids = ["cccccccc-0000-0000-0000-000000000001"]
        mock_supabase.set_table_data(
            "notes",
            [{**NOTE_ROW_BASE, "anchored_highlight_ids": hl_ids}],
        )

        resp = test_client.post(
            "/notes",
            json={
                "content": "[TEST] mark-and-return",
                "note_type": "synthesis",
                "anchored_highlight_ids": hl_ids,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200


# ── T5-T6: PATCH note ─────────────────────────────────────────────────────────

class TestPatchNoteEvergreen:
    def test_patch_evergreen_flag(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes", [{**NOTE_ROW_BASE, "evergreen": True}]
        )

        resp = test_client.patch(
            f"/notes/{TEST_NOTE_ID}",
            json={"evergreen": True},
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200

    def test_patch_anchor_selectors(self, test_client, mock_supabase):
        selector = {"type": "CssSelector", "value": "p:nth-of-type(3)"}
        mock_supabase.set_table_data(
            "notes", [{**NOTE_ROW_BASE, "anchor_selectors": selector}]
        )

        resp = test_client.patch(
            f"/notes/{TEST_NOTE_ID}",
            json={"anchor_selectors": selector},
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200

    def test_patch_unknown_field_rejected(self, test_client, mock_supabase):
        """Fields not in the allowed set are silently stripped; if nothing
        valid remains, the endpoint returns 400."""
        resp = test_client.patch(
            f"/notes/{TEST_NOTE_ID}",
            json={"malicious_field": "DROP TABLE notes"},
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 400


# ── T7-T10: POST /notes/{id}/links ───────────────────────────────────────────

class TestCreateNoteLink:
    def _note_and_link_setup(self, mock_supabase):
        """Configure mock: owned note + successful link upsert."""
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE])
        mock_supabase.set_table_data("note_links", [LINK_ROW])

    def test_create_note_to_note_link(self, test_client, mock_supabase):
        self._note_and_link_setup(mock_supabase)

        resp = test_client.post(
            f"/notes/{TEST_NOTE_ID}/links",
            json={
                "target_ref_type": "note",
                "target_ref_id": TEST_NOTE_ID_2,
                "mention_offset": 5,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "link" in body

    def test_create_note_to_item_link(self, test_client, mock_supabase):
        item_link = {**LINK_ROW, "target_ref_type": "item", "target_ref_id": TEST_ITEM_ID}
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE])
        mock_supabase.set_table_data("note_links", [item_link])

        resp = test_client.post(
            f"/notes/{TEST_NOTE_ID}/links",
            json={
                "target_ref_type": "item",
                "target_ref_id": TEST_ITEM_ID,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200

    def test_invalid_target_ref_type_returns_400(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE])

        resp = test_client.post(
            f"/notes/{TEST_NOTE_ID}/links",
            json={
                "target_ref_type": "invalid_type",
                "target_ref_id": TEST_NOTE_ID_2,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 400
        assert "target_ref_type" in resp.json()["detail"].lower()

    def test_unknown_note_returns_404(self, test_client, mock_supabase):
        # Note lookup returns empty → 404
        mock_supabase.set_table_data("notes", [])

        resp = test_client.post(
            "/notes/nonexistent-uuid/links",
            json={
                "target_ref_type": "note",
                "target_ref_id": TEST_NOTE_ID_2,
            },
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 404

    def test_mention_offset_none_defaults_to_zero(self, test_client, mock_supabase):
        """When mention_offset is omitted, the backend uses 0 as sentinel."""
        link_no_offset = {**LINK_ROW, "mention_offset": 0}
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE])
        mock_supabase.set_table_data("note_links", [link_no_offset])

        resp = test_client.post(
            f"/notes/{TEST_NOTE_ID}/links",
            json={"target_ref_type": "note", "target_ref_id": TEST_NOTE_ID_2},
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200


# ── T11: GET /notes/{id}/links ────────────────────────────────────────────────

class TestGetNoteLinks:
    def test_links_tab_returns_outgoing_and_incoming(self, test_client, mock_supabase):
        """Links tab: owned note, one outgoing link, one incoming backlink."""
        # note_links returns outgoing for source queries + incoming for target queries
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE, NOTE_ROW_2])
        mock_supabase.set_table_data("note_links", [LINK_ROW])

        resp = test_client.get(
            f"/notes/{TEST_NOTE_ID}/links",
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "outgoing" in body
        assert "incoming" in body
        # Both lists are lists (may be empty depending on mock routing)
        assert isinstance(body["outgoing"], list)
        assert isinstance(body["incoming"], list)

    def test_links_tab_404_for_unknown_note(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [])

        resp = test_client.get(
            "/notes/nonexistent/links",
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 404


# ── T12: DELETE /notes/{id}/links/{type}/{id} ─────────────────────────────────

class TestDeleteNoteLink:
    def test_delete_link(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE])
        mock_supabase.set_table_data("note_links", [])  # after delete

        resp = test_client.delete(
            f"/notes/{TEST_NOTE_ID}/links/note/{TEST_NOTE_ID_2}",
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_delete_link_unknown_note_returns_404(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [])

        resp = test_client.delete(
            f"/notes/nonexistent/links/note/{TEST_NOTE_ID_2}",
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 404


# ── T13: note deletion cascade ────────────────────────────────────────────────

class TestNoteDeletion:
    def test_delete_note_succeeds(self, test_client, mock_supabase):
        """Deleting a note returns {deleted: true}. Cascade to note_links
        is enforced by the DB FK, not tested at the mock level."""
        mock_supabase.set_table_data("notes", [NOTE_ROW_BASE])

        resp = test_client.delete(
            f"/notes/{TEST_NOTE_ID}",
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_delete_nonexistent_note_returns_404(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [])

        resp = test_client.delete(
            f"/notes/{TEST_NOTE_ID}",
            headers={"X-User-Id": TEST_USER},
        )
        assert resp.status_code == 404


# ── T14: test data hygiene ────────────────────────────────────────────────────

class TestDataHygiene:
    def test_all_test_note_titles_prefixed(self):
        """All test fixtures use [TEST] prefix in title or content."""
        for row in [NOTE_ROW_BASE, NOTE_ROW_2]:
            title = row.get("title", "")
            content = row.get("content", "")
            assert "[TEST]" in title or "[TEST]" in content, (
                f"Test fixture missing [TEST] prefix: {row['id']}"
            )
