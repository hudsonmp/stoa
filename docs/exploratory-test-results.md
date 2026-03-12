# Stoa Exploratory Test Results

Systematic code-level analysis of all backend, Chrome extension, MCP server, and schema components.

---

## Critical

### 1. Dev Mode Auth Bypass Accepts Any Truthy String
**Component:** `services/auth.py`
**Description:** `STOA_DEV_MODE` is checked with `os.getenv("STOA_DEV_MODE")`, which treats *any* non-empty value as truthy -- including `"false"`, `"0"`, `"no"`, `"off"`. If this env var is accidentally set in production (even to disable it), the entire auth system is bypassed.
**Code Path:** `auth.py:34` -- `if os.getenv("STOA_DEV_MODE")`
**Fix:** Check `os.getenv("STOA_DEV_MODE", "").lower() in ("1", "true", "yes")`, or better, never use dev mode in production -- require an explicit flag like `STOA_ENV != "production"`.
**Test:** `test_auth.py::TestDevModeBypass::test_dev_mode_truthy_string_enables_bypass`

### 2. Service Key Bypasses RLS for All Backend Operations
**Component:** `services/auth.py`, all routers
**Description:** Every backend operation uses `get_supabase_service()` (service role key), which completely bypasses Postgres RLS policies. User isolation relies entirely on manual `.eq("user_id", ...)` filters in application code. If any router forgets this filter, data leaks across users. The RLS policies defined in the schema are inert at the backend level.
**Code Path:** All routers import and call `get_supabase_service()`
**Fix:** Use `get_supabase_anon()` with the user's JWT set via `.auth.set_session()` for read operations. Reserve service key for admin-only operations.
**Test:** `test_search.py::TestVectorSearch::test_vector_search_uses_service_key`

### 3. Metadata Endpoint Has No Authentication
**Component:** `routers/ingest.py`
**Description:** `POST /ingest/metadata` does not call `get_user_id()`. Anyone can use this endpoint to probe URLs through Stoa's server, effectively creating an open proxy for URL content extraction.
**Code Path:** `ingest.py:229-239` -- function signature has no `request: Request` parameter
**Fix:** Add `request: Request` parameter and `await get_user_id(request)` call.
**Test:** `test_ingest.py::TestMetadataEndpoint::test_metadata_endpoint_no_auth_required`

---

## High

### 4. No Highlight Ownership Verification on Create
**Component:** `routers/highlights.py`
**Description:** `POST /highlights` does not verify that `item_id` belongs to the requesting user. Any authenticated user can create highlights on any item in the database if they know (or guess) the UUID.
**Code Path:** `highlights.py:26-52` -- no `items` table check
**Fix:** Before inserting, verify `supabase.table("items").select("id").eq("id", req.item_id).eq("user_id", user_id)`.
**Test:** `test_highlights.py::TestCreateHighlight::test_create_highlight_no_item_ownership_check`

### 5. XSS via Stored Highlight Text and CSS Selector
**Component:** `routers/highlights.py`, Chrome extension `content.js`
**Description:** Highlight `text`, `css_selector`, and `color` fields accept arbitrary strings with no sanitization. The Chrome extension uses `css_selector` directly in `document.querySelector()` and applies `color` to CSS class names. Stored XSS is possible if a malicious highlight is injected (e.g., via the API without the extension).
**Code Path:** `highlights.py:31-41` (storage), `content.js:300-344` (rendering with `document.querySelector(highlight.css_selector)`)
**Fix:** Validate `color` against allowed values enum. Sanitize `css_selector` to only allow known-safe CSS selector syntax. Escape highlight text before DOM insertion.
**Test:** `test_highlights.py::TestCreateHighlight::test_create_highlight_xss_in_text`, `test_create_highlight_no_color_validation`

### 6. ilike Wildcard Injection in Search
**Component:** `services/rag_pipeline.py`, `mcp-server/server.py`
**Description:** User-provided search queries are interpolated into ilike patterns as `f"%{query}%"`. SQL wildcards `%` and `_` in the query are not escaped, allowing a query of `%` to match everything and `_` to match any single character. The MCP server's `get_person` and `get_highlights` tools have the same issue with `ilike("name", f"%{person}%")`.
**Code Path:** `rag_pipeline.py:46-47`, `server.py:95,159,389`
**Fix:** Escape `%`, `_`, and `\` in user input before building ilike patterns.
**Test:** `test_search.py::TestFullTextSearchInjection::test_percent_wildcard_in_query`

### 7. Non-Atomic Ingest Creates Orphaned Items on Failure
**Component:** `routers/ingest.py`
**Description:** URL ingest is a multi-step process: insert item -> link people -> add tags -> chunk & embed -> log activity. If any step after item insert fails (e.g., OpenAI API down during embedding), the item persists in the database without chunks, with no indication of failure. There's no transaction wrapping.
**Code Path:** `ingest.py:64-112` -- each step is a separate Supabase call
**Fix:** Either wrap in a transaction (Supabase supports `.rpc()` for stored procedures), implement a cleanup/retry mechanism, or mark items with an `ingestion_status` field.
**Test:** `test_ingest.py::TestURLIngest::test_ingest_partial_failure_leaves_orphaned_item`

### 8. Auth Error Leaks Internal Details
**Component:** `services/auth.py`
**Description:** The catch-all exception handler returns `f"Auth failed: {str(e)}"`, which can leak Supabase URLs, error codes, and internal implementation details in the HTTP response.
**Code Path:** `auth.py:53-54`
**Fix:** Return generic error message; log the full exception server-side.
**Test:** `test_auth.py::TestProductionAuth::test_error_detail_leaks_exception_message`

### 9. OpenAI API Error Response Causes KeyError
**Component:** `services/embedding.py`
**Description:** `embed_texts` assumes the OpenAI response always has `data["data"]`. On rate limit (429), auth error (401), or other failures, the response body has `{"error": {...}}` instead, causing an unhandled `KeyError`. No status code check, no error handling.
**Code Path:** `embedding.py:74-75` -- `resp.json()["data"]`
**Fix:** Check `resp.status_code`, raise descriptive error on non-200.
**Test:** `test_ingest.py::TestChunkingEdgeCases::test_embed_texts_openai_error_not_caught`

---

## Medium

### 10. No PDF Upload Size Limit
**Component:** `routers/ingest.py`
**Description:** `await file.read()` reads the entire uploaded file into memory with no size limit. A 500MB upload would consume 500MB of server RAM. FastAPI/Starlette don't enforce limits by default.
**Code Path:** `ingest.py:125` -- `pdf_bytes = await file.read()`
**Fix:** Add `max_file_size` check before or during read, or use streaming.
**Test:** `test_ingest.py::TestPDFIngest::test_pdf_no_file_size_limit` (documentation)

### 11. PDF Filename Path Traversal
**Component:** `routers/ingest.py`
**Description:** `file.filename` is used directly in the storage path: `f"{user_id}/pdfs/{file.filename}"`. Filenames like `../../../etc/secrets` could cause path traversal in Supabase Storage.
**Code Path:** `ingest.py:129`
**Fix:** Sanitize filename (strip path separators, use UUID-based names).
**Test:** `test_ingest.py::TestPDFIngest::test_pdf_malicious_filename` (documentation)

### 12. arXiv ID Injection in API Query
**Component:** `services/extraction.py`
**Description:** arXiv ID is interpolated into the query URL without sanitization: `f"http://export.arxiv.org/api/query?id_list={clean_id}"`. A value like `2301.00234&start=0&max_results=100` modifies the query parameters.
**Code Path:** `extraction.py:90`
**Fix:** URL-encode the arXiv ID, or validate it against `^\d{4}\.\d{4,5}(v\d+)?$`.
**Test:** `test_ingest.py::TestArXivIngest::test_arxiv_id_with_injection`

### 13. No Duplicate Check for arXiv Ingest
**Component:** `routers/ingest.py`
**Description:** URL ingest checks for duplicates (`.eq("url", req.url)`), but arXiv ingest does not. Ingesting the same arXiv ID twice creates duplicate items, chunks, and citations.
**Code Path:** `ingest.py:152-226` -- no existing item check
**Fix:** Add duplicate check on URL `f"https://arxiv.org/abs/{arxiv_id}"` before proceeding.
**Test:** `test_ingest.py::TestArXivIngest::test_arxiv_no_duplicate_check` (documentation)

### 14. Search Tags/Person Filters Silently Ignored
**Component:** `routers/search.py`
**Description:** `SearchRequest` model accepts `tags` and `person_id` fields, but the `search` handler never passes them to `hybrid_search`. Users think they're filtering by tag/person but get unfiltered results.
**Code Path:** `search.py:23-29` -- `req.tags` and `req.person_id` unused
**Fix:** Implement tag and person filtering in `hybrid_search`, or remove the fields from the model.
**Test:** `test_search.py::TestSearchRouter::test_search_tags_and_person_id_ignored`

### 15. RRF Fusion ID Mismatch Between Vector and Full-Text Results
**Component:** `services/rag_pipeline.py`
**Description:** Vector search returns chunk-level results (id=chunk UUID, item_id=item UUID). Full-text search returns item-level results (id=item UUID). RRF fusion deduplicates on `id`, so the same item appears twice -- once as chunk ID, once as item ID -- breaking score aggregation.
**Code Path:** `rag_pipeline.py:60-72`
**Fix:** Normalize to item_id before fusion, or deduplicate on item_id.
**Test:** `test_search.py::TestRRFFusion::test_rrf_vector_and_fulltext_id_mismatch`

### 16. Chunking Fails on Text Without Sentence Boundaries
**Component:** `services/embedding.py`
**Description:** `chunk_text` splits on sentence-ending punctuation (`[.!?]`). Code samples, tables, or text without periods become one giant chunk. A 10,000-word code snippet is a single chunk that may exceed the embedding model's token limit (8191 tokens).
**Code Path:** `embedding.py:20` -- `re.split(r'(?<=[.!?])\s+', text)`
**Fix:** Add a hard token/word limit per chunk as fallback when sentence splitting produces oversized chunks.
**Test:** `test_ingest.py::TestChunkingEdgeCases::test_chunk_text_no_sentence_boundaries`

### 17. No Embedding Batch Size Limit
**Component:** `services/embedding.py`
**Description:** `embed_texts` sends all texts in a single API call. OpenAI's `text-embedding-3-small` has a limit of 8191 tokens per input and batch limits. A document with 500 chunks would hit these limits.
**Code Path:** `embedding.py:65-75` -- single `client.post()` for all texts
**Fix:** Batch into groups of ~100 texts, respecting token limits.
**Test:** `test_ingest.py::TestChunkingEdgeCases::test_embed_texts_large_batch_no_chunking` (documentation)

### 18. Review Quality Has No Range Validation
**Component:** `routers/review.py`, `services/spaced_rep.py`
**Description:** `quality` field accepts any integer. Values outside 0-3 produce unexpected behavior: negative values are treated as "easy" (difficulty decreases), large values same as quality=3.
**Code Path:** `spaced_rep.py:21-36` -- no bounds check, if/elif/else chain
**Fix:** Add `quality: int = Field(ge=0, le=3)` in the Pydantic model.
**Test:** `test_highlights.py::TestReviewEndpoints::test_review_quality_no_range_validation`, `test_review_negative_quality`

### 19. Review Not Found Returns 200, Not 404
**Component:** `routers/review.py`
**Description:** When `review_id` doesn't exist or doesn't belong to the user, the endpoint returns `{"error": "Review not found"}` with HTTP 200. This is inconsistent with REST conventions.
**Code Path:** `review.py:53-54`
**Fix:** `raise HTTPException(status_code=404, detail="Review not found")`
**Test:** `test_highlights.py::TestReviewEndpoints::test_review_respond_not_found_returns_200`

### 20. DNS Rebinding TOCTOU in SSRF Protection
**Component:** `services/url_validator.py`, `services/extraction.py`
**Description:** URL validation resolves DNS and checks the IP at validation time. But the actual HTTP request (in `extraction.py`) resolves DNS again. An attacker with a DNS server returning different IPs per query (short TTL) can pass validation with a public IP, then have the fetch hit an internal IP.
**Code Path:** `url_validator.py:39-47` (check) vs `extraction.py:15-18` (fetch)
**Fix:** Pin the resolved IP and pass it to httpx, or use httpx's `transport` to enforce the resolved address.
**Test:** `test_url_validator.py::TestSSRFBypasses::test_dns_rebinding_toctou` (documentation)

---

## Low

### 21. Chrome Extension Hardcoded to localhost
**Component:** `content.js`, `service-worker.js`
**Description:** `STOA_API = "http://localhost:8000"` is hardcoded. No configuration mechanism for production deployment.
**Fix:** Read from `chrome.storage.local` or extension settings.

### 22. No Highlight Deletion or Update API
**Component:** `routers/highlights.py`
**Description:** Only POST (create) and GET (list) are implemented. Users cannot delete incorrect highlights or update notes/colors.
**Test:** `test_highlights.py::TestMissingHighlightOperations`

### 23. No Pagination on Any Endpoint
**Component:** All routers
**Description:** Highlights are hardcoded to `limit(100)`, search has no upper bound on `limit`, and other endpoints return all results. No cursor-based or offset pagination.

### 24. Service Worker handleSavePage Sends No Auth Headers
**Component:** `service-worker.js:83-88`
**Description:** `handleSavePage` sends data to `/ingest` without any auth headers (no Bearer token, no X-User-Id). The request will always 401 in production.

### 25. MCP Server user_id Bypass Pattern
**Component:** `mcp-server/server.py`
**Description:** MCP tools use `_get_user_id()` from env var + direct Supabase service key access. This bypasses all API-level auth and rate limiting. Some tools send `user_id` in JSON body to the API, but the API ignores body-level user_id in favor of header-based auth.
**Code Path:** `server.py:56-63` -- `search_library` sends user_id in JSON body

### 26. Supabase Client Created with Empty Strings on Missing Env Vars
**Component:** `services/auth.py`
**Description:** `create_client(os.getenv("SUPABASE_URL", ""), ...)` creates a client with empty URL if env var is missing. This fails silently until the first API call, producing confusing errors.
**Fix:** Fail fast at startup if required env vars are missing.

### 27. IVFFlat Index on Empty Table
**Component:** `supabase/migrations/001_initial_schema.sql`
**Description:** The initial migration creates an IVFFlat index (later replaced with HNSW in migration 003). IVFFlat requires training data and performs poorly on tables with fewer rows than `lists * 10`. The HNSW fix addresses this.

### 28. No Input Type Validation at API Level
**Component:** `routers/ingest.py`
**Description:** The `type` field in `IngestURLRequest` is `str`, not an enum. Invalid types pass Pydantic validation but fail at the Postgres CHECK constraint, producing a 500 error instead of 422.
**Fix:** Use `Literal["book","blog","paper","podcast","page","tweet","video"]` in the Pydantic model.

### 29. CORS Chrome Extension Wildcard May Not Match
**Component:** `main.py`
**Description:** `chrome-extension://*` in `allow_origins` may not work as expected. FastAPI CORS checks for exact string matches, not glob patterns. The actual origin is `chrome-extension://<extension-id>`.
**Fix:** Use a CORS middleware that supports regex patterns, or add the specific extension ID.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 6 |
| Medium | 11 |
| Low | 9 |
| **Total** | **29** |
