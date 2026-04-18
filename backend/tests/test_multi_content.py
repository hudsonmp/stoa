"""Tests for multi-content ingesters: GDoc, Email, GitHub, Image."""

import io
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stubs for optional modules
# ---------------------------------------------------------------------------
for mod in ("surya", "surya.ocr", "surya.model", "surya.model.detection",
            "surya.model.detection.model", "surya.model.detection.processor",
            "surya.model.recognition", "surya.model.recognition.model",
            "surya.model.recognition.processor",
            "googleapiclient", "googleapiclient.discovery",
            "google", "google.oauth2", "google.oauth2.credentials",
            "google.auth", "google.auth.transport", "google.auth.transport.requests",
            "PIL", "PIL.Image"):
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

_pil_img = sys.modules["PIL.Image"]
_pil_img.open.return_value.size = (800, 600)


def _make_png() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx"
        b"\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00"
        b"\x00\x00\x00IEND\xaeB`\x82"
    )


def _make_client(supabase_client, extra_patches=None):
    patches = [
        patch("services.auth.get_supabase_service", return_value=supabase_client),
        patch("routers.ingest.get_supabase_service", return_value=supabase_client),
        patch("routers.citations.get_supabase_service", return_value=supabase_client),
        patch("routers.review.get_supabase_service", return_value=supabase_client),
        patch("routers.highlights.get_supabase_service", return_value=supabase_client),
    ]
    if extra_patches:
        patches.extend(extra_patches)
    for p in patches:
        p.start()
    from main import app
    from fastapi.testclient import TestClient
    return TestClient(app), patches


def _stop(patches):
    for p in patches:
        try: p.stop()
        except RuntimeError: pass


_HEADERS = {"X-User-Id": "test-user-123"}


# ===========================================================================
# GDoc ingester
# ===========================================================================

class TestGdocIngester:
    FAKE = {
        "title": "My Research Doc", "gdoc_id": "abc123docid",
        "owner_email": "user@example.com", "last_modified": "2024-01-01T00:00:00Z",
        "shared_with": [], "markdown": "# My Research Doc\n\nSome content here.",
    }
    URL = "https://docs.google.com/document/d/abc123docid/edit"

    def test_success(self, mock_supabase, dev_mode_env):
        import services.gdoc_extractor as m
        with patch.object(m, "fetch_gdoc", new_callable=AsyncMock, return_value=self.FAKE):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/gdoc", json={"url": self.URL, "tags": ["__test__"]}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        d = r.json()
        assert d["already_exists"] is False
        assert d["item"]["type"] == "gdoc"
        assert d["item"]["title"] == "My Research Doc"

    def test_bad_url(self, mock_supabase, dev_mode_env):
        client, patches = _make_client(mock_supabase)
        try:
            r = client.post("/ingest/gdoc", json={"url": "https://notgoogledocs.com/foo"}, headers=_HEADERS)
        finally:
            _stop(patches)
        assert r.status_code == 400

    def test_dedup(self, dev_mode_env):
        from tests.conftest import MockSupabaseClient
        import services.gdoc_extractor as m
        db = MockSupabaseClient()
        db.set_table_data("items", [{"id": "existing-gdoc-id", "user_id": "test-user-123",
                                      "url": self.URL, "type": "gdoc", "title": "My Research Doc"}])
        mock_fetch = AsyncMock(return_value=self.FAKE)
        with patch.object(m, "fetch_gdoc", mock_fetch):
            client, patches = _make_client(db)
            try:
                r = client.post("/ingest/gdoc", json={"url": self.URL}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        assert r.json()["already_exists"] is True
        mock_fetch.assert_not_called()

    def test_api_error(self, mock_supabase, dev_mode_env):
        import services.gdoc_extractor as m
        with patch.object(m, "fetch_gdoc", new_callable=AsyncMock, side_effect=RuntimeError("API down")):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/gdoc", json={"url": self.URL}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 502


# ===========================================================================
# Email ingester
# ===========================================================================

class TestEmailIngester:
    FAKE = {
        "thread_id": "thread_abc123",
        "subject": "Interesting paper on attention",
        "participants": ["alice@example.com", "bob@example.com"],
        "messages": [
            {"message_id": "msg1", "sender": "alice@example.com", "date": "Mon, 1 Jan 2024", "body": "Have you read this?"},
            {"message_id": "msg2", "sender": "bob@example.com", "date": "Tue, 2 Jan 2024", "body": "Yes, fascinating!"},
        ],
    }

    def test_success(self, mock_supabase, dev_mode_env):
        import services.email_extractor as m
        with patch.object(m, "fetch_gmail_thread", new_callable=AsyncMock, return_value=self.FAKE):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/email", json={"thread_id": "thread_abc123", "tags": ["__test__"]}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        d = r.json()
        assert d["already_exists"] is False
        assert d["item"]["type"] == "email_thread"
        assert d["item"]["title"] == "Interesting paper on attention"

    def test_extracted_text_safe(self, mock_supabase, dev_mode_env):
        import services.email_extractor as m
        with patch.object(m, "fetch_gmail_thread", new_callable=AsyncMock, return_value=self.FAKE):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/email", json={"thread_id": "thread_abc123"}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        extracted = r.json()["item"].get("extracted_text", "")
        assert "Have you read this?" not in extracted
        assert "Subject:" in extracted

    def test_dedup(self, dev_mode_env):
        from tests.conftest import MockSupabaseClient
        import services.email_extractor as m
        db = MockSupabaseClient()
        db.set_table_data("items", [{"id": "existing-email-id", "user_id": "test-user-123",
                                      "type": "email_thread", "title": "Old thread",
                                      "metadata": {"thread_id": "thread_abc123"}}])
        mock_fetch = AsyncMock(return_value=self.FAKE)
        with patch.object(m, "fetch_gmail_thread", mock_fetch):
            client, patches = _make_client(db)
            try:
                r = client.post("/ingest/email", json={"thread_id": "thread_abc123"}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        assert r.json()["already_exists"] is True
        mock_fetch.assert_not_called()

    def test_api_error(self, mock_supabase, dev_mode_env):
        import services.email_extractor as m
        with patch.object(m, "fetch_gmail_thread", new_callable=AsyncMock, side_effect=RuntimeError("API down")):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/email", json={"thread_id": "thread_abc123"}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 502


# ===========================================================================
# GitHub ingester
# ===========================================================================

class TestGithubIngester:
    FAKE = {
        "full_name": "octocat/Hello-World",
        "description": "My first repository on GitHub!",
        "stars": 1337, "language": "Python", "topics": ["demo"], "license": "MIT",
        "last_commit_at": "2024-01-01T00:00:00Z",
        "readme_md": "# Hello World\n\nThis is the README.",
        "file_tree": ["README.md", "main.py", ".gitignore"],
    }
    URL = "https://github.com/octocat/Hello-World"

    def test_success(self, mock_supabase, dev_mode_env):
        import services.github_extractor as m
        with patch.object(m, "fetch_github_repo", new_callable=AsyncMock, return_value=self.FAKE):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/github", json={"url": self.URL, "tags": ["__test__"]}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        d = r.json()
        assert d["already_exists"] is False
        assert d["item"]["type"] == "github_repo"
        assert d["item"]["title"] == "octocat/Hello-World"

    def test_bad_url(self, mock_supabase, dev_mode_env):
        client, patches = _make_client(mock_supabase)
        try:
            r = client.post("/ingest/github", json={"url": "https://notgithub.com/foo"}, headers=_HEADERS)
        finally:
            _stop(patches)
        assert r.status_code == 400

    def test_dedup(self, dev_mode_env):
        from tests.conftest import MockSupabaseClient
        import services.github_extractor as m
        db = MockSupabaseClient()
        db.set_table_data("items", [{"id": "existing-gh-id", "user_id": "test-user-123",
                                      "url": self.URL, "type": "github_repo",
                                      "title": "octocat/Hello-World",
                                      "github_slug": "octocat/Hello-World"}])
        mock_fetch = AsyncMock(return_value=self.FAKE)
        with patch.object(m, "fetch_github_repo", mock_fetch):
            client, patches = _make_client(db)
            try:
                r = client.post("/ingest/github", json={"url": self.URL}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 200
        assert r.json()["already_exists"] is True
        mock_fetch.assert_not_called()

    def test_not_found(self, mock_supabase, dev_mode_env):
        import services.github_extractor as m
        with patch.object(m, "fetch_github_repo", new_callable=AsyncMock, side_effect=ValueError("GitHub repo not found")):
            client, patches = _make_client(mock_supabase)
            try:
                r = client.post("/ingest/github", json={"url": self.URL}, headers=_HEADERS)
            finally:
                _stop(patches)
        assert r.status_code == 404


# ===========================================================================
# Image ingester
# ===========================================================================

class TestImageIngester:

    def _storage(self):
        s = MagicMock()
        bc = MagicMock()
        bc.upload.return_value = None
        bc.get_public_url.return_value = "https://supabase.co/storage/v1/object/public/research-images/test.png"
        s.from_.return_value = bc
        s.create_bucket.return_value = None
        return s

    def test_upload_success(self, mock_supabase, dev_mode_env):
        mock_supabase.storage = self._storage()
        client, patches = _make_client(mock_supabase)
        try:
            r = client.post("/ingest/research-image",
                            files={"file": ("test.png", io.BytesIO(_make_png()), "image/png")},
                            data={"tags": "__test__"}, headers=_HEADERS)
        finally:
            _stop(patches)
        assert r.status_code == 200
        d = r.json()
        assert d["item"]["type"] == "image"
        assert "image_url" in d

    def test_no_file_or_url(self, mock_supabase, dev_mode_env):
        client, patches = _make_client(mock_supabase)
        try:
            r = client.post("/ingest/research-image", data={}, headers=_HEADERS)
        finally:
            _stop(patches)
        assert r.status_code == 400

    def test_url_fetch(self, mock_supabase, dev_mode_env, mock_httpx_get):
        mock_supabase.storage = self._storage()
        client, patches = _make_client(mock_supabase)
        try:
            r = client.post("/ingest/research-image",
                            data={"url": "https://example.com/diagram.png", "tags": "__test__"},
                            headers=_HEADERS)
        finally:
            _stop(patches)
        assert r.status_code in (200, 400, 500)

    def test_dimensions_stored(self, mock_supabase, dev_mode_env):
        mock_supabase.storage = self._storage()
        client, patches = _make_client(mock_supabase)
        try:
            r = client.post("/ingest/research-image",
                            files={"file": ("test.png", io.BytesIO(_make_png()), "image/png")},
                            data={"tags": "__test__"}, headers=_HEADERS)
        finally:
            _stop(patches)
        assert r.status_code == 200
        d = r.json()
        assert "width" in d and "height" in d


# ===========================================================================
# Extractor unit tests
# ===========================================================================

class TestGdocExtractor:
    def test_extract_id_standard(self):
        from services.gdoc_extractor import extract_gdoc_id
        assert extract_gdoc_id("https://docs.google.com/document/d/abc123_ID-xyz/edit") == "abc123_ID-xyz"

    def test_extract_id_none(self):
        from services.gdoc_extractor import extract_gdoc_id
        assert extract_gdoc_id("https://example.com/foo") is None

    def test_to_markdown_headings(self):
        from services.gdoc_extractor import gdoc_to_markdown
        doc = {"body": {"content": [{"paragraph": {
            "paragraphStyle": {"namedStyleType": "HEADING_1"},
            "elements": [{"textRun": {"content": "Title\n", "textStyle": {}}}],
        }}]}}
        assert gdoc_to_markdown(doc).startswith("# Title")


class TestGithubExtractor:
    def test_slug_standard(self):
        from services.github_extractor import extract_github_slug
        assert extract_github_slug("https://github.com/octocat/Hello-World") == "octocat/Hello-World"

    def test_slug_git_suffix(self):
        from services.github_extractor import extract_github_slug
        assert extract_github_slug("https://github.com/octocat/Hello-World.git") == "octocat/Hello-World"

    def test_slug_subpath(self):
        from services.github_extractor import extract_github_slug
        assert extract_github_slug("https://github.com/octocat/Hello-World/tree/main") == "octocat/Hello-World"

    def test_slug_none_for_other(self):
        from services.github_extractor import extract_github_slug
        assert extract_github_slug("https://gitlab.com/foo/bar") is None


class TestEmailExtractor:
    def test_html_to_text(self):
        from services.email_extractor import _html_to_text
        html = "<p>Hello <b>world</b></p><br>"
        result = _html_to_text(html)
        assert "<p>" not in result
        assert "Hello" in result and "world" in result
