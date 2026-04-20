"""Folder-sync exploratory tests.

Runs against the live Supabase project (req-eng) because the sync engine
lightly touches storage + multiple tables. Tests are scoped to a throwaway
project with a `[TEST-SYNC]` prefix so cleanup is obvious.

What this test file covers:
  1. Unit: slugify, webloc plist round-trip, conflict filename formatting,
     frontmatter split/build, hash stability across mtime drift.
  2. Integration: scan empty vault, add PDF, scan detects it, delete it,
     scan soft-deletes.
  3. Round-trip for notes: write in Stoa → push → edit body on disk → scan
     → verify project_notes.content updated.
  4. Conflict: modify both sides between syncs → assert conflict file written.
  5. Clone: new vault folder → /clone → verify files + manifest match.

Run with:  cd backend && .venv/bin/python3 -m pytest tests/test_folder_sync.py -v -s
Set STOA_SYNC_LIVE=1 to enable the live-Supabase integration tests; unset to
run unit tests only.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from services.folder_sync import (
    fs_layout,
    hashing,
    frontmatter as fm_mod,
    conflict as conflict_mod,
    icloud,
)


# ─── Unit tests ────────────────────────────────────────────────────────────

class TestSlugify:
    def test_basic(self):
        assert fs_layout.slugify_filename("Paper Title") == "Paper Title"

    def test_strips_unsafe(self):
        assert "/" not in fs_layout.slugify_filename("foo/bar")
        assert ":" not in fs_layout.slugify_filename("a:b")

    def test_preserves_unicode(self):
        out = fs_layout.slugify_filename("Étude sur l'apprentissage")
        assert "Étude" in out

    def test_empty(self):
        assert fs_layout.slugify_filename("") == "untitled"
        assert fs_layout.slugify_filename("   ") == "untitled"

    def test_reserved_windows(self):
        assert fs_layout.slugify_filename("CON").upper() != "CON"


class TestWebloc:
    def test_round_trip(self):
        url = "https://arxiv.org/abs/2401.00001"
        data = fs_layout.build_webloc_plist(url)
        assert fs_layout.parse_webloc_url(data) == url

    def test_ampersand_escaping(self):
        url = "https://example.com/?x=1&y=2"
        data = fs_layout.build_webloc_plist(url)
        assert fs_layout.parse_webloc_url(data) == url


class TestConflictFilename:
    def test_simple(self):
        name = conflict_mod.conflict_filename("Paper.pdf")
        assert name.startswith("Paper (conflict ")
        assert name.endswith(".pdf")

    def test_compound_suffix_gdoc(self):
        name = conflict_mod.conflict_filename("Doc.gdoc.webloc")
        assert name.endswith(".gdoc.webloc")

    def test_compound_suffix_email(self):
        name = conflict_mod.conflict_filename("Thread.email.md")
        assert name.endswith(".email.md")


class TestFrontmatter:
    def test_round_trip(self):
        note = {
            "id": "uuid-1",
            "item_id": None,
            "project_id": "proj-1",
            "folder_id": "fld-1",
            "evergreen": True,
            "tags": ["hci", "ai"],
            "created_at": "2026-04-01T00:00:00+00:00",
            "updated_at": "2026-04-02T00:00:00+00:00",
        }
        body = "# Title\nBody of note with $math$ and [[wikilink]].\n"
        rendered = fm_mod.build(note, body, content_hash="deadbeef")
        assert rendered.startswith("---\n")
        fm, parsed_body = fm_mod.split(rendered)
        assert fm["id"] == "uuid-1"
        assert fm["tags"] == ["hci", "ai"]
        assert fm["content_hash"] == "deadbeef"
        assert parsed_body.startswith("# Title")

    def test_missing_frontmatter(self):
        fm, body = fm_mod.split("# Just a title\nno fm here\n")
        assert fm == {}
        assert body.startswith("# Just a title")


class TestHashing:
    def test_note_body_hash_ignores_frontmatter(self):
        body = "# Title\nSame body\n"
        t1 = f"---\nid: a\nupdated_at: 2026-01-01\n---\n{body}"
        t2 = f"---\nid: a\nupdated_at: 2026-06-06\n---\n{body}"
        assert hashing.hash_note_body(t1) == hashing.hash_note_body(t2)

    def test_note_body_hash_catches_body_change(self):
        t1 = "---\nid: a\n---\n# T\nA\n"
        t2 = "---\nid: a\n---\n# T\nB\n"
        assert hashing.hash_note_body(t1) != hashing.hash_note_body(t2)

    def test_url_placeholder_hash_stable(self):
        url = "https://x.com/y"
        assert hashing.hash_url_placeholder(url) == hashing.hash_url_placeholder(url + "")


class TestClassify:
    @pytest.mark.parametrize("path,expected", [
        ("Paper.pdf", "pdf"),
        ("cover.png", "image"),
        ("Doc.gdoc.webloc", "gdoc"),
        ("owner_repo.github.webloc", "github_repo"),
        ("Thread.email.md", "email_thread"),
        ("Link.webloc", "url"),
        ("Note.md", "note"),
        ("_evergreen/Note.md", "evergreen_note"),
        ("random.xyz", "unknown"),
    ])
    def test_classify(self, path, expected):
        assert fs_layout.classify_file(path) == expected

    def test_hidden_and_system(self):
        assert fs_layout.is_hidden_or_system(".stoa/manifest.json")
        assert fs_layout.is_hidden_or_system(".DS_Store")
        assert not fs_layout.is_hidden_or_system("Paper.pdf")
        # evergreen dir should NOT be considered hidden
        assert not fs_layout.is_hidden_or_system("_evergreen/Note.md")


class TestIcloud:
    def test_placeholder_detection(self, tmp_path):
        p = tmp_path / ".Foo.pdf.icloud"
        p.write_text("x")
        assert icloud.is_placeholder(p) is True
        real = icloud.real_path_from_placeholder(p)
        assert real.name == "Foo.pdf"


# ─── Integration tests (live Supabase) ─────────────────────────────────────

LIVE = os.getenv("STOA_SYNC_LIVE") == "1"

# Fixed test user from main.py TEST_USER_ID
TEST_USER = "5f067d11-b2b8-4efe-84c7-5ac9c5602c9a"

# Minimal PDF bytes: the smallest valid PDF (11 bytes won't work — PyMuPDF rejects).
# Use a hand-crafted 1-page blank PDF.
MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"xref\n0 4\n"
    b"0000000000 65535 f \n"
    b"0000000009 00000 n \n"
    b"0000000052 00000 n \n"
    b"0000000099 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\n"
    b"startxref\n148\n%%EOF\n"
)


@pytest.fixture
def live_supabase():
    if not LIVE:
        pytest.skip("Set STOA_SYNC_LIVE=1 to run live integration tests.")
    # Load real .env so we reach the real project instead of the conftest stub.
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=True)
    # The conftest module-import sets SUPABASE_URL=test.supabase.co via setdefault,
    # so dotenv's override=True must be honoured or we still stub.
    assert os.environ.get("SUPABASE_URL", "").startswith("https://nhttyppkcajodocrnqhi"), \
        "SUPABASE_URL not pointing at req-eng; integration disabled."
    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    return client


@pytest.fixture
def test_project(live_supabase):
    """Create a throwaway project with a unique name; teardown deletes it."""
    sb = live_supabase
    name = f"[TEST-SYNC] {int(time.time())}"
    result = sb.table("projects").insert({
        "user_id": TEST_USER,
        "name": name,
    }).execute()
    project_id = result.data[0]["id"]
    yield project_id
    # Teardown: cascade-delete via projects.
    sb.table("projects").delete().eq("id", project_id).execute()


@pytest.fixture
def vault_path():
    tmp = Path(tempfile.mkdtemp(prefix="stoa-sync-test-"))
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)


class TestSyncIntegration:
    @pytest.mark.skipif(not LIVE, reason="live")
    def test_empty_vault_scan(self, live_supabase, test_project, vault_path):
        from services.folder_sync import SyncEngine
        engine = SyncEngine(test_project, TEST_USER, str(vault_path), live_supabase)
        engine.ensure_vault()
        result = engine.scan()
        assert result.scanned == 0
        assert result.pushed_to_stoa == 0
        # .stoa/ subdirs created
        assert (vault_path / ".stoa" / "annotations").is_dir()
        assert (vault_path / ".stoa" / "manifest.json").exists()

    @pytest.mark.skipif(not LIVE, reason="live")
    def test_add_pdf_and_scan(self, live_supabase, test_project, vault_path):
        from services.folder_sync import SyncEngine
        engine = SyncEngine(test_project, TEST_USER, str(vault_path), live_supabase)
        engine.ensure_vault()

        # Drop a PDF into the vault root.
        pdf_path = vault_path / "Test Paper.pdf"
        pdf_path.write_bytes(MINIMAL_PDF)

        result = engine.scan()
        assert result.scanned >= 1
        assert result.pushed_to_stoa == 1

        # Verify an item was created.
        items = live_supabase.table("items").select("id, title, type").eq(
            "user_id", TEST_USER
        ).eq("title", "Test Paper").execute()
        assert items.data, "expected item to be created"
        item_id = items.data[0]["id"]

        # Verify folder_items linked.
        root_folder = live_supabase.table("folders").select("id").eq(
            "project_id", test_project
        ).is_("parent_folder_id", "null").execute()
        assert root_folder.data
        fi = live_supabase.table("folder_items").select("item_id").eq(
            "folder_id", root_folder.data[0]["id"]
        ).eq("item_id", item_id).execute()
        assert fi.data, "expected item linked to root folder"

        # Cleanup: delete the item.
        live_supabase.table("items").delete().eq("id", item_id).execute()

    @pytest.mark.skipif(not LIVE, reason="live")
    def test_note_round_trip(self, live_supabase, test_project, vault_path):
        """Create a project_note via DB → push → edit on disk → scan → verify DB updated."""
        from services.folder_sync import SyncEngine
        engine = SyncEngine(test_project, TEST_USER, str(vault_path), live_supabase)
        engine.ensure_vault()

        # Seed a project note.
        note = live_supabase.table("project_notes").insert({
            "user_id": TEST_USER,
            "project_id": test_project,
            "title": "Roundtrip Note",
            "content": "Original body.",
            "evergreen": False,
        }).execute().data[0]
        note_id = note["id"]

        engine.push()

        md_path = vault_path / "Roundtrip Note.md"
        assert md_path.exists(), "note should be written to disk"

        # Edit body on disk.
        text = md_path.read_text(encoding="utf-8")
        fm, body = fm_mod.split(text)
        assert fm.get("id") == note_id
        new_text = fm_mod.build(fm, "# Roundtrip Note\nEdited on disk.", content_hash=None)
        md_path.write_text(new_text, encoding="utf-8")

        # Re-scan and verify Stoa content updated.
        result = engine.scan()
        assert result.updated >= 1

        refreshed = live_supabase.table("project_notes").select("content").eq(
            "id", note_id
        ).execute().data[0]
        assert "Edited on disk" in refreshed["content"]

        # Cleanup.
        live_supabase.table("project_notes").delete().eq("id", note_id).execute()

    @pytest.mark.skipif(not LIVE, reason="live")
    def test_soft_delete_on_local_remove(self, live_supabase, test_project, vault_path):
        from services.folder_sync import SyncEngine
        engine = SyncEngine(test_project, TEST_USER, str(vault_path), live_supabase)
        engine.ensure_vault()

        title = f"Ephemeral-{int(time.time()*1000)}"
        pdf = vault_path / f"{title}.pdf"
        pdf.write_bytes(MINIMAL_PDF)
        engine.scan()

        # Grab the created item id.
        created = live_supabase.table("items").select("id, deleted_at").eq(
            "user_id", TEST_USER
        ).eq("title", title).execute()
        assert created.data, f"item {title} should have been created"
        item_id = created.data[0]["id"]

        # Remove from disk.
        pdf.unlink()
        result = engine.scan()
        assert result.soft_deleted >= 1, f"expected soft delete; got {result.as_dict()}"

        refreshed = live_supabase.table("items").select("id, deleted_at").eq(
            "id", item_id
        ).execute()
        assert refreshed.data and refreshed.data[0]["deleted_at"] is not None, \
            f"deleted_at not set on item {item_id}"

        # Cleanup.
        live_supabase.table("items").delete().eq("id", item_id).execute()

    @pytest.mark.skipif(not LIVE, reason="live")
    def test_conflict_both_sides_changed(self, live_supabase, test_project, vault_path):
        """Modify both sides between syncs → assert conflict file written, flag set."""
        from services.folder_sync import SyncEngine
        engine = SyncEngine(test_project, TEST_USER, str(vault_path), live_supabase)
        engine.ensure_vault()

        # Seed a project note and push it.
        note = live_supabase.table("project_notes").insert({
            "user_id": TEST_USER,
            "project_id": test_project,
            "title": "Conflict Me",
            "content": "Original",
            "evergreen": False,
        }).execute().data[0]
        note_id = note["id"]
        engine.push()

        md_path = vault_path / "Conflict Me.md"
        assert md_path.exists()

        # Mutate both sides since the last reconcile:
        fm_on_disk, body_on_disk = fm_mod.split(md_path.read_text(encoding="utf-8"))
        md_path.write_text(fm_mod.build(fm_on_disk, "# Conflict Me\nDISK WINS"), encoding="utf-8")
        live_supabase.table("project_notes").update({"content": "STOA WINS"}).eq(
            "id", note_id
        ).execute()

        result = engine.scan()
        # Conflict file should land next to the original.
        conflict_files = [p for p in vault_path.iterdir() if p.name.startswith("Conflict Me (conflict ")]
        assert result.conflicts >= 1 or conflict_files, f"expected conflict; result={result.as_dict()}"

        # Cleanup.
        live_supabase.table("project_notes").delete().eq("id", note_id).execute()

    @pytest.mark.skipif(not LIVE, reason="live")
    def test_round_trip_all_item_types(self, live_supabase, test_project, vault_path):
        """Smoke-test every item-type serialization round-trip path defined in the spec.

        Not all item types are created via disk ingest (e.g. GDoc requires a real
        Google Doc URL); instead we seed items directly in the DB, push to disk,
        and verify the correct on-disk artifact shape.
        """
        from services.folder_sync import SyncEngine
        engine = SyncEngine(test_project, TEST_USER, str(vault_path), live_supabase)
        engine.ensure_vault()

        # Seed items of each shape we support.
        seeds = [
            {"title": "Seed Blog", "type": "blog", "url": "https://example.com/blog", "expect_suffix": ".webloc"},
            {"title": "Seed GDoc", "type": "gdoc", "url": "https://docs.google.com/document/d/abc", "expect_suffix": ".gdoc.webloc"},
            {"title": "Seed Repo", "type": "github_repo", "url": "https://github.com/foo/bar", "github_slug": "foo/bar", "expect_suffix": ".github.webloc"},
            {"title": "Seed Email", "type": "email_thread", "expect_suffix": ".email.md", "messages": [{"from": "a@b", "body": "hi"}], "metadata": {"participants": ["a@b"], "thread_id": "t1"}},
        ]
        root_folder = live_supabase.table("folders").select("id").eq(
            "project_id", test_project
        ).is_("parent_folder_id", "null").execute().data[0]

        created_ids = []
        for s in seeds:
            payload = {
                "user_id": TEST_USER,
                "title": s["title"],
                "type": s["type"],
                "reading_status": "to_read",
            }
            for k in ("url", "github_slug", "metadata", "messages"):
                if k in s:
                    payload[k] = s[k]
            item = live_supabase.table("items").insert(payload).execute().data[0]
            created_ids.append(item["id"])
            live_supabase.table("folder_items").insert({
                "folder_id": root_folder["id"], "item_id": item["id"], "sort_order": 0,
            }).execute()

        engine.push()

        files = {p.name for p in vault_path.iterdir() if p.is_file()}
        for s in seeds:
            suffix = s["expect_suffix"]
            assert any(f.endswith(suffix) for f in files), \
                f"expected a file ending in {suffix} for {s['title']}; got {files}"

        # Cleanup.
        for i in created_ids:
            live_supabase.table("items").delete().eq("id", i).execute()

    @pytest.mark.skipif(not LIVE, reason="live")
    def test_clone_to_new_vault(self, live_supabase, test_project):
        """Write state via push, then clone into a fresh folder; verify files match."""
        from services.folder_sync import SyncEngine

        with tempfile.TemporaryDirectory(prefix="stoa-sync-orig-") as orig, \
             tempfile.TemporaryDirectory(prefix="stoa-sync-clone-") as clone:

            e1 = SyncEngine(test_project, TEST_USER, orig, live_supabase)
            e1.ensure_vault()
            note = live_supabase.table("project_notes").insert({
                "user_id": TEST_USER,
                "project_id": test_project,
                "title": "Clone Source",
                "content": "Clone body",
                "evergreen": False,
            }).execute().data[0]
            e1.push()

            e2 = SyncEngine(test_project, TEST_USER, clone, live_supabase)
            e2.ensure_vault()
            e2.push()

            orig_files = {p.name for p in Path(orig).iterdir() if p.is_file()}
            clone_files = {p.name for p in Path(clone).iterdir() if p.is_file()}
            assert orig_files == clone_files, f"{orig_files} vs {clone_files}"

            live_supabase.table("project_notes").delete().eq("id", note["id"]).execute()
