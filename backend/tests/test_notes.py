"""Tests for the evergreen notes pipeline: knowledge-type routing and note-to-note linking.

Maps onto the Reading Hamming companion (§4, Different knowledge, different memory):
 - declarative / procedural / conceptual / episodic / stylistic — encode before extracting.
 - Dense linking (Matuschak): synthesis notes with < MIN_LINKS note-to-note links are orphans.
"""

import pytest

HEADERS = {"X-User-Id": "test-user-123"}

from routers.notes import (
    _annotate,
    _build_tags,
    _extract_body_note_links,
    _extract_knowledge_type,
    _extract_linked_note_ids,
    _extract_note_type,
    KNOWLEDGE_TYPES,
    MIN_LINKS,
)


# ---------------- Pure-function tests (no client, no mocks) ----------------


class TestTagHelpers:
    def test_build_tags_includes_knowledge_type_prefix(self):
        tags = _build_tags("synthesis", [], [], knowledge_type="declarative")
        assert "synthesis" in tags
        assert "kt:declarative" in tags

    def test_build_tags_includes_note_links(self):
        tags = _build_tags("synthesis", [], [], note_ids=["note-abc", "note-def"])
        assert "link:note-abc" in tags
        assert "link:note-def" in tags

    def test_build_tags_strips_duplicate_reserved_prefixes(self):
        # User-passed kt:/link:/ref: in extra_tags should not leak through.
        tags = _build_tags(
            "synthesis",
            ["item-1"],
            extra_tags=["kt:conceptual", "link:bogus", "ref:bogus", "custom-tag"],
            knowledge_type="declarative",
            note_ids=["note-1"],
        )
        assert "kt:declarative" in tags  # explicit param wins
        assert "kt:conceptual" not in tags  # extra-tag variant filtered
        assert "link:note-1" in tags
        assert "link:bogus" not in tags
        assert "ref:item-1" in tags
        assert "ref:bogus" not in tags
        assert "custom-tag" in tags

    def test_extract_knowledge_type_returns_none_for_missing(self):
        assert _extract_knowledge_type(["synthesis", "some-tag"]) is None
        assert _extract_knowledge_type(None) is None
        assert _extract_knowledge_type([]) is None

    def test_extract_knowledge_type_ignores_unknown_values(self):
        # Poisoned data: kt:<unknown> should not be returned as a valid knowledge type.
        assert _extract_knowledge_type(["kt:garbage"]) is None
        assert _extract_knowledge_type(["kt:declarative"]) == "declarative"

    def test_extract_linked_note_ids(self):
        tags = ["synthesis", "link:n1", "link:n2", "ref:item-x", "kt:conceptual"]
        assert _extract_linked_note_ids(tags) == ["n1", "n2"]
        assert _extract_linked_note_ids(None) == []

    def test_extract_note_type_defaults_to_marginalia(self):
        assert _extract_note_type(None) == "marginalia"
        assert _extract_note_type([]) == "marginalia"
        assert _extract_note_type(["synthesis"]) == "synthesis"


# ---------------- Endpoint tests ----------------


class TestCreateNoteWithKnowledgeType:
    def test_create_synthesis_with_declarative_kt(self, test_client, mock_supabase):
        r = test_client.post("/notes", headers=HEADERS, json={
                "note_type": "synthesis",
                "knowledge_type": "declarative",
                "title": "Hamming claimed ambiguity-tolerance predicts greatness",
                "content": "...",
            },
        )
        assert r.status_code == 200
        note = r.json()["note"]
        assert "kt:declarative" in note["tags"]
        assert "synthesis" in note["tags"]

    def test_create_rejects_invalid_knowledge_type(self, test_client, mock_supabase):
        r = test_client.post("/notes", headers=HEADERS, json={
                "note_type": "synthesis",
                "knowledge_type": "motor",  # not in the 5-type schema
                "content": "...",
            },
        )
        assert r.status_code == 400
        assert "knowledge_type" in r.json()["detail"]

    def test_create_without_knowledge_type_leaves_kt_unset(
        self, test_client, mock_supabase
    ):
        r = test_client.post("/notes", headers=HEADERS, json={"note_type": "marginalia", "content": "margin note"},
        )
        assert r.status_code == 200
        note = r.json()["note"]
        assert not any(t.startswith("kt:") for t in note["tags"])

    def test_create_with_note_ids_emits_link_tags(self, test_client, mock_supabase):
        r = test_client.post("/notes", headers=HEADERS, json={
                "note_type": "synthesis",
                "content": "bridges two concepts",
                "note_ids": ["note-a", "note-b"],
            },
        )
        assert r.status_code == 200
        tags = r.json()["note"]["tags"]
        assert "link:note-a" in tags
        assert "link:note-b" in tags


class TestOrphanDetection:
    def test_synthesis_with_zero_links_is_orphan(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes",
            [
                {
                    "id": "orphan-1",
                    "user_id": "test-user-123",
                    "content": "isolated",
                    "tags": ["synthesis", "kt:conceptual"],
                },
                {
                    "id": "well-linked",
                    "user_id": "test-user-123",
                    "content": "connected",
                    "tags": ["synthesis", "link:a", "link:b"],
                },
                {
                    "id": "marginalia-excluded",
                    "user_id": "test-user-123",
                    "content": "margin",
                    "tags": ["marginalia"],
                },
            ],
        )
        r = test_client.get("/notes/orphans", headers=HEADERS)
        assert r.status_code == 200
        body = r.json()
        ids = [n["id"] for n in body["notes"]]
        assert "orphan-1" in ids
        assert "well-linked" not in ids
        assert "marginalia-excluded" not in ids
        assert body["min_links"] == MIN_LINKS

    def test_synthesis_with_one_link_is_still_orphan(self, test_client, mock_supabase):
        # MIN_LINKS = 2 (Matuschak's densely-linked rule). One link is not enough.
        mock_supabase.set_table_data(
            "notes",
            [
                {
                    "id": "sparsely-linked",
                    "user_id": "test-user-123",
                    "content": "...",
                    "tags": ["synthesis", "link:just-one"],
                },
            ],
        )
        r = test_client.get("/notes/orphans", headers=HEADERS)
        assert r.status_code == 200
        assert any(n["id"] == "sparsely-linked" for n in r.json()["notes"])


class TestKnowledgeTypeFilter:
    def test_filter_by_declarative(self, test_client, mock_supabase):
        # Mock doesn't actually filter; tests that the endpoint returns what
        # the driver returns, annotated with knowledge_type.
        mock_supabase.set_table_data(
            "notes",
            [
                {
                    "id": "fact-1",
                    "user_id": "test-user-123",
                    "content": "...",
                    "tags": ["synthesis", "kt:declarative"],
                },
            ],
        )
        r = test_client.get("/notes/by-knowledge-type/declarative", headers=HEADERS)
        assert r.status_code == 200
        body = r.json()
        assert body["knowledge_type"] == "declarative"
        assert body["notes"][0]["knowledge_type"] == "declarative"

    def test_filter_rejects_invalid_type(self, test_client, mock_supabase):
        r = test_client.get("/notes/by-knowledge-type/motor", headers=HEADERS)
        assert r.status_code == 400

    def test_all_five_knowledge_types_are_accepted(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [])
        for kt in KNOWLEDGE_TYPES:
            r = test_client.get(f"/notes/by-knowledge-type/{kt}", headers=HEADERS)
            assert r.status_code == 200, f"{kt} should be accepted"


class TestLinkNoteToNote:
    def test_link_rejects_self_link(self, test_client, mock_supabase):
        r = test_client.post("/notes/note-1/link-note", headers=HEADERS, json={"target_note_id": "note-1"},
        )
        assert r.status_code == 400
        assert "itself" in r.json()["detail"].lower()

    def test_link_returns_404_when_source_missing(self, test_client, mock_supabase):
        # No notes configured → .execute() returns []
        mock_supabase.set_table_data("notes", [])
        r = test_client.post("/notes/missing/link-note", headers=HEADERS, json={"target_note_id": "other"},
        )
        assert r.status_code == 404

    def test_unlink_note_from_note(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes",
            [
                {
                    "id": "source",
                    "user_id": "test-user-123",
                    "tags": ["synthesis", "link:target-1", "link:target-2"],
                },
            ],
        )
        r = test_client.delete(
            "/notes/source/link-note/target-1", headers=HEADERS
        )
        assert r.status_code == 200

    def test_unlink_missing_link_is_noop(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes",
            [{"id": "source", "user_id": "test-user-123", "tags": ["synthesis"]}],
        )
        r = test_client.delete(
            "/notes/source/link-note/never-linked", headers=HEADERS
        )
        assert r.status_code == 200
        assert r.json().get("message") == "Not linked"

    def test_unlink_source_missing_returns_404(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [])
        r = test_client.delete(
            "/notes/missing/link-note/anything", headers=HEADERS
        )
        assert r.status_code == 404


class TestBodyLinkExtraction:
    def test_extracts_mention_ids(self):
        content = (
            '<p>See <a data-type="mention" data-id="note:abc-123" '
            'data-kind="note" href="/notes/abc-123" class="stoa-mention">@Some note</a></p>'
        )
        assert _extract_body_note_links(content) == ["abc-123"]

    def test_extracts_plain_href_ids(self):
        content = '<p>Related: <a href="/notes/xyz-789">see here</a></p>'
        assert _extract_body_note_links(content) == ["xyz-789"]

    def test_mention_and_href_are_deduped(self):
        content = (
            '<a data-id="note:shared-id" href="/notes/shared-id">one</a>'
            '<a href="/notes/shared-id">two</a>'
        )
        assert _extract_body_note_links(content) == ["shared-id"]

    def test_empty_or_missing_content(self):
        assert _extract_body_note_links(None) == []
        assert _extract_body_note_links("") == []
        assert _extract_body_note_links("<p>no links here</p>") == []

    def test_annotate_unions_tag_and_body_links(self):
        note = {
            "id": "self",
            "tags": ["synthesis", "link:tagged-1", "link:tagged-2"],
            "content": (
                '<a data-id="note:body-1" href="/notes/body-1">@x</a>'
                '<a href="/notes/tagged-1">already tagged</a>'  # dedupe against tag list
            ),
        }
        _annotate(note)
        # Tag links first, then body-only links, deduped.
        assert note["linked_note_ids"] == ["tagged-1", "tagged-2", "body-1"]

    def test_annotate_self_link_is_dropped(self):
        note = {
            "id": "me",
            "tags": ["synthesis"],
            "content": '<a href="/notes/me">self-ref</a>',
        }
        _annotate(note)
        assert note["linked_note_ids"] == []


class TestCollectionsForNotes:
    def test_create_with_collection_ids_emits_col_tags(self, test_client, mock_supabase):
        r = test_client.post(
            "/notes",
            headers=HEADERS,
            json={
                "note_type": "synthesis",
                "content": "...",
                "collection_ids": ["col-hamming"],
            },
        )
        assert r.status_code == 200
        assert "col:col-hamming" in r.json()["note"]["tags"]

    def test_add_note_to_collection(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes",
            [{"id": "note-1", "user_id": "test-user-123", "tags": ["synthesis"]}],
        )
        r = test_client.post(
            "/notes/note-1/collections",
            headers=HEADERS,
            json={"collection_id": "col-hamming"},
        )
        assert r.status_code == 200

    def test_remove_note_from_collection(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes",
            [{"id": "note-1", "user_id": "test-user-123", "tags": ["synthesis", "col:col-hamming"]}],
        )
        r = test_client.delete(
            "/notes/note-1/collections/col-hamming", headers=HEADERS
        )
        assert r.status_code == 200


class TestFlashcards:
    def test_flashcards_returns_declarative_only_shape(self, test_client, mock_supabase):
        mock_supabase.set_table_data(
            "notes",
            [
                {
                    "id": "card-1",
                    "user_id": "test-user-123",
                    "title": "Hamming claim",
                    "content": "<p>Ambiguity-tolerance predicts greatness.</p>",
                    "tags": ["synthesis", "kt:declarative"],
                    "updated_at": "2026-04-15T00:00:00Z",
                }
            ],
        )
        r = test_client.get("/notes/flashcards", headers=HEADERS)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        card = body["cards"][0]
        assert card["front"] == "Hamming claim"
        assert "<p>" in card["back"]
        assert card["knowledge_type"] == "declarative"

    def test_flashcards_filter_by_collection(self, test_client, mock_supabase):
        mock_supabase.set_table_data("notes", [])
        r = test_client.get(
            "/notes/flashcards?collection_id=col-hamming", headers=HEADERS
        )
        assert r.status_code == 200
        assert r.json()["collection_id"] == "col-hamming"
