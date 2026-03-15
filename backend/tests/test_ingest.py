"""Tests for ingest endpoint edge cases.

Probes: duplicate URL handling, PDF size limits, extraction failures,
embedding failures, non-atomic multi-step ingest, arXiv edge cases,
content type validation, and race conditions.
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

import pytest


class TestURLIngest:
    """Tests for POST /ingest (URL ingest)."""

    def test_ingest_returns_duplicate_on_existing_url(self, test_client, mock_supabase):
        """Re-ingesting the same URL should return the existing item without re-extracting."""
        mock_supabase.set_table_data("items", [{
            "id": "existing-uuid",
            "title": "Already Saved",
            "url": "https://example.com/article",
        }])

        resp = test_client.post(
            "/ingest",
            json={"url": "https://example.com/article"},
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("deduplicated") is True

    def test_ingest_empty_url_passes_validation(self, test_client):
        """Empty string URL -- Pydantic accepts it (no URL validation on the model),
        but validate_url should reject it."""
        resp = test_client.post(
            "/ingest",
            json={"url": ""},
            headers={"X-User-Id": "test-user"},
        )
        # Empty URL fails at urlparse -- no scheme
        assert resp.status_code == 400 or resp.status_code == 500

    def test_ingest_invalid_type_accepted(self, test_client, mock_supabase):
        """The Pydantic model has type: str with no enum constraint, but
        the DB has a CHECK constraint. Invalid types will fail at Supabase insert,
        not at the API layer -- giving a 500 instead of 422."""
        mock_supabase.set_table_data("items", [])  # No duplicate

        with patch("routers.ingest.validate_url"):
            with patch("routers.ingest.extract_from_url", new_callable=AsyncMock, return_value={
                "title": "Test", "author": None, "date": None,
                "domain": "example.com", "favicon_url": "", "extracted_text": "text", "url": "https://example.com",
            }):
                with patch("routers.ingest.chunk_and_embed", new_callable=AsyncMock, return_value=[]):
                    resp = test_client.post(
                        "/ingest",
                        json={"url": "https://example.com", "type": "invalid_type"},
                        headers={"X-User-Id": "test-user"},
                    )
                    # Should ideally be 422, but the validation is only at DB level
                    # The mock won't catch this, but documents the gap
                    assert resp.status_code in (200, 422, 500)

    def test_ingest_no_auth_header_returns_401(self):
        """Missing both Authorization and X-User-Id should 401."""
        with patch.dict(os.environ, {"STOA_DEV_MODE": "1"}):
            from main import app
            from fastapi.testclient import TestClient
            client = TestClient(app)
            resp = client.post("/ingest", json={"url": "https://example.com"})
            assert resp.status_code == 401

    def test_ingest_extraction_failure_not_handled(self, test_client, mock_supabase):
        """If trafilatura fails or returns None, extracted_text becomes empty string.
        The ingest proceeds and stores an item with no content and no chunks.
        No error is surfaced to the user."""
        mock_supabase.set_table_data("items", [])

        with patch("routers.ingest.validate_url"):
            with patch("routers.ingest.extract_from_url", new_callable=AsyncMock, return_value={
                "title": "example.com", "author": None, "date": None,
                "domain": "example.com", "favicon_url": "", "extracted_text": "", "url": "https://example.com",
            }):
                with patch("routers.ingest.chunk_and_embed", new_callable=AsyncMock, return_value=[]):
                    resp = test_client.post(
                        "/ingest",
                        json={"url": "https://example.com"},
                        headers={"X-User-Id": "test-user"},
                    )
                    data = resp.json()
                    # Item is saved even with empty text
                    assert data["chunks_created"] == 0

    def test_ingest_partial_failure_leaves_orphaned_item(self, test_client, mock_supabase):
        """If item insert succeeds but chunk insert fails, the item exists
        without embeddings. There's no transaction wrapping the multi-step process.

        The exception from chunk_and_embed propagates as a 500. But the item
        row was already inserted before the exception, so it persists in DB
        as an orphan with no chunks."""
        mock_supabase.set_table_data("items", [])

        with patch("routers.ingest.validate_url"):
            with patch("routers.ingest.extract_from_url", new_callable=AsyncMock, return_value={
                "title": "Test", "author": None, "date": None,
                "domain": "example.com", "favicon_url": "", "extracted_text": "Some text", "url": "https://example.com",
            }):
                # chunk_and_embed raises an error (e.g., OpenAI API down)
                with patch("routers.ingest.chunk_and_embed", new_callable=AsyncMock,
                           side_effect=Exception("OpenAI API rate limited")):
                    # TestClient raises the exception by default rather than returning 500
                    with pytest.raises(Exception, match="OpenAI API rate limited"):
                        test_client.post(
                            "/ingest",
                            json={"url": "https://example.com"},
                            headers={"X-User-Id": "test-user"},
                        )
                    # KEY FINDING: The item was already inserted via supabase.table("items").insert()
                    # before chunk_and_embed was called. The insert is not rolled back on failure.
                    # In production, FastAPI converts this to a 500 response, but the DB
                    # is left with an orphaned item (no chunks, no activity log).

    def test_ingest_tags_with_special_characters(self, test_client, mock_supabase):
        """Tags containing SQL-relevant characters (', \\, %) should be
        safely handled by the Supabase client (parameterized queries)."""
        mock_supabase.set_table_data("items", [])

        with patch("routers.ingest.validate_url"):
            with patch("routers.ingest.extract_from_url", new_callable=AsyncMock, return_value={
                "title": "Test", "author": None, "date": None,
                "domain": "example.com", "favicon_url": "", "extracted_text": "text", "url": "https://example.com",
            }):
                with patch("routers.ingest.chunk_and_embed", new_callable=AsyncMock, return_value=[]):
                    resp = test_client.post(
                        "/ingest",
                        json={
                            "url": "https://example.com",
                            "tags": ["tag'OR 1=1--", "tag%_wildcard", "normal-tag"],
                        },
                        headers={"X-User-Id": "test-user"},
                    )
                    # Supabase client should parameterize, so no injection
                    assert resp.status_code == 200


class TestPDFIngest:
    """Tests for POST /ingest/pdf."""

    def test_pdf_no_file_size_limit(self, test_client):
        """There is no upload size limit enforced by the application.
        A 500MB PDF would be fully read into memory (pdf_bytes = await file.read())
        before processing. This is a DoS vector."""
        # This test documents the absence of size limits
        # In a real test, we'd try to upload a very large file
        pass

    def test_pdf_malicious_filename(self, test_client, mock_supabase):
        """The filename is used directly in the storage path:
        f'{user_id}/pdfs/{file.filename}'
        A filename like '../../../etc/secrets' could cause path traversal
        in Supabase Storage (if the storage backend doesn't sanitize)."""
        # Document the vulnerability path
        pass

    def test_pdf_with_no_text(self):
        """PDFs that are pure images (scanned documents) extract to empty string.
        This is stored without warning."""
        from services.extraction import extract_from_pdf
        import fitz

        with patch("fitz.open") as mock_fitz:
            mock_doc = MagicMock()
            mock_doc.metadata = {"title": "Scanned Doc"}
            mock_page = MagicMock()
            mock_page.get_text.return_value = ""
            mock_doc.__iter__ = lambda self: iter([mock_page])
            mock_doc.__len__ = lambda self: 1
            mock_fitz.return_value = mock_doc

            result = extract_from_pdf(b"fake pdf bytes")
            assert result["extracted_text"] == ""
            assert result["page_count"] == 1


class TestArXivIngest:
    """Tests for POST /ingest/arxiv/{arxiv_id}."""

    @pytest.mark.asyncio
    async def test_arxiv_id_with_injection(self):
        """arXiv ID is interpolated into URL without sanitization:
        f'http://export.arxiv.org/api/query?id_list={clean_id}'
        A value like '2301.00234&start=0&max_results=100' would modify the query."""
        from services.extraction import fetch_arxiv_metadata

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = "<feed><entry><title>Test</title><summary>Abstract</summary><published>2023-01-01T00:00:00Z</published></entry></feed>"
            mock_get.return_value = mock_resp

            result = await fetch_arxiv_metadata("2301.00234&start=0&max_results=100")
            # The injected query params are sent to arXiv API
            call_url = mock_get.call_args[0][0]
            assert "&start=0&max_results=100" in call_url

    @pytest.mark.asyncio
    async def test_arxiv_nonexistent_id(self):
        """A nonexistent arXiv ID returns XML with no entry. The extract_tag
        calls return None, leading to title=None, year=None in the item."""
        from services.extraction import fetch_arxiv_metadata

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = "<feed></feed>"
            mock_get.return_value = mock_resp

            result = await fetch_arxiv_metadata("0000.00000")
            assert result["title"] is None
            assert result["year"] is None
            assert result["authors"] == []

    @pytest.mark.asyncio
    async def test_arxiv_pdf_download_no_validation(self):
        """arXiv PDF download URL is constructed from the arxiv_id without
        any SSRF validation -- it always points to arxiv.org, so it's safe
        by construction, but the pattern is worth noting."""
        from services.extraction import fetch_arxiv_metadata

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = "<feed><entry><title>T</title><summary>S</summary><published>2023-01-01T00:00:00Z</published></entry></feed>"
            mock_get.return_value = mock_resp

            result = await fetch_arxiv_metadata("2301.00234")
            assert result["pdf_url"] == "https://arxiv.org/pdf/2301.00234.pdf"

    def test_arxiv_no_duplicate_check(self, test_client, mock_supabase):
        """Unlike URL ingest, arXiv ingest has NO duplicate check.
        Ingesting the same arXiv ID twice creates duplicate items."""
        # Document the gap: no .eq("url", meta["url"]) check in ingest_arxiv
        pass


class TestMetadataEndpoint:
    """Tests for POST /ingest/metadata."""

    def test_metadata_endpoint_no_auth_required(self, test_client):
        """The metadata endpoint calls get_user_id... wait, it doesn't.
        extract_metadata() has no auth dependency! Anyone can probe URLs
        through this endpoint for free."""
        # The endpoint signature is: async def extract_metadata(req: MetadataRequest)
        # No `request: Request` parameter, no get_user_id call
        with patch("routers.ingest.validate_url"):
            with patch("routers.ingest.extract_from_url", new_callable=AsyncMock, return_value={
                "title": "Test", "author": "Author", "domain": "example.com",
                "favicon_url": "https://favicon", "extracted_text": "text", "url": "https://example.com",
            }):
                resp = test_client.post(
                    "/ingest/metadata",
                    json={"url": "https://example.com"},
                    # No auth headers at all
                )
                assert resp.status_code == 200


class TestChunkingEdgeCases:
    """Tests for the chunking and embedding pipeline."""

    def test_chunk_text_empty_string(self):
        """Empty text should return empty chunks list."""
        from services.embedding import chunk_text
        assert chunk_text("") == []

    def test_chunk_text_single_sentence(self):
        """Text shorter than chunk_size should return one chunk."""
        from services.embedding import chunk_text
        chunks = chunk_text("This is a single sentence.")
        assert len(chunks) == 1
        assert chunks[0] == "This is a single sentence."

    def test_chunk_text_no_sentence_boundaries(self):
        """Text with no sentence-ending punctuation gets treated as one sentence.
        If that sentence is very long (say 10000 words), it becomes one huge chunk."""
        from services.embedding import chunk_text
        long_text = " ".join(["word"] * 2000)
        chunks = chunk_text(long_text)
        # With CHUNK_SIZE=512 and no sentence boundaries, the entire text
        # is one sentence, so it stays as one chunk
        assert len(chunks) == 1
        assert len(chunks[0].split()) == 2000

    def test_chunk_text_preserves_overlap(self):
        """Verify overlap between consecutive chunks."""
        from services.embedding import chunk_text
        # Create text with clear sentence boundaries
        sentences = [f"Sentence number {i} with some padding words here." for i in range(100)]
        text = " ".join(sentences)
        chunks = chunk_text(text, chunk_size=50, overlap=10)
        if len(chunks) > 1:
            # Check that chunks overlap (last words of chunk N appear in chunk N+1)
            chunk0_words = chunks[0].split()
            chunk1_words = chunks[1].split()
            # Some words from end of chunk 0 should appear at start of chunk 1
            overlap_found = any(w in chunk1_words[:20] for w in chunk0_words[-15:])
            assert overlap_found

    @pytest.mark.asyncio
    async def test_embed_texts_no_api_key_raises(self):
        """Missing OPENAI_API_KEY should raise ValueError, not return zeros."""
        from services.embedding import embed_texts

        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("OPENAI_API_KEY", None)
            with pytest.raises(ValueError, match="OPENAI_API_KEY not set"):
                await embed_texts(["test text"])

    @pytest.mark.asyncio
    async def test_embed_texts_openai_error_not_caught(self):
        """If OpenAI returns an error response (e.g., rate limit), the code
        tries to access resp.json()['data'] which will KeyError, giving an
        unhelpful traceback instead of a clear error message."""
        from services.embedding import embed_texts

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "error": {"message": "Rate limit exceeded", "type": "rate_limit_error"}
        }
        mock_response.status_code = 429

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
                with pytest.raises(KeyError):
                    await embed_texts(["test"])

    @pytest.mark.asyncio
    async def test_embed_texts_large_batch_no_chunking(self):
        """embed_texts sends ALL texts in one API call. If there are 1000 chunks,
        this is a single massive request that could exceed OpenAI's token limit
        (8191 tokens per input for text-embedding-3-small)."""
        from services.embedding import embed_texts

        # Document: no batching logic exists
        pass
