# Stoa Feature Gap Analysis

Gaps identified through code-level analysis of all components. Organized by category.

---

## Missing Data Operations

### No Delete Operations for Any Entity
- **Items:** No `DELETE /ingest/{id}` endpoint. Users cannot remove saved items.
- **Highlights:** No `DELETE /highlights/{id}`. Highlights are permanent once created.
- **People:** No delete endpoint. The MCP `add_person` tool can create people but never remove them.
- **Collections:** No CRUD endpoints at all -- collections exist only in the schema and seed script.
- **Tags:** Created during ingest but no management API (list, rename, merge, delete).
- **Notes:** Table exists in schema, MCP server reads from it, but no REST API to create/update/delete notes.
- **Impact:** Users accumulate data they can't clean up. The only recourse is direct Supabase dashboard access.

### No Update Operations
- Highlights: Cannot change color, update note, or fix text after creation.
- Items: No endpoint to update `reading_status` (to_read -> reading -> read). The schema supports it but the API doesn't expose it.
- People: No edit endpoint for updating affiliation, role, notes.
- Tags: Cannot rename or recolor.

### No Bulk Operations
- Cannot batch-ingest multiple URLs in one request.
- Cannot batch-delete or batch-tag items.
- Cannot move items between collections.

---

## Missing API Endpoints

### Collections Have No REST API
The schema defines `collections` and `collection_items` tables, the seed script creates collections, and the MCP server reads from them (`get_reading_list`), but there are NO REST endpoints for:
- Creating collections
- Listing collections
- Adding/removing items from collections
- Reordering items within collections
- Deleting collections

### Notes Have No REST API
The `notes` table exists and the MCP server reads from it, but no REST endpoints for CRUD operations on notes.

### People Have No REST API
People are created as side effects of arXiv ingest and via MCP `add_person`, but there's no REST endpoint for:
- Listing people
- Searching people
- Updating people
- Managing person-item relationships
- Managing person-person connections

### Tab Groups API Is Stub
The service worker saves tab groups to `chrome.storage.local` and logs a message, but never actually sends data to the backend API. The `tab_groups` table in the schema is unused.

---

## Missing Error States and User Feedback

### Silent Extraction Failures
When trafilatura fails to extract content (returns None/empty), the item is saved with `extracted_text: ""`. No error is returned to the user. The item appears in the library but has no searchable content and no chunks for RAG.

### No Ingestion Status Tracking
Items go directly to `reading_status: to_read` regardless of whether extraction and embedding succeeded. There should be an `ingestion_status` field (`pending`, `processing`, `complete`, `failed`) to track pipeline state.

### No Progress Feedback for Long Operations
- arXiv ingest downloads a PDF, extracts text, chunks, and embeds -- this can take 30+ seconds. No progress indication.
- Bulk BibTeX import processes entries sequentially with no progress feedback.

### Missing HTTP Error Codes
- `POST /review/respond` with invalid review_id returns 200 `{"error": "Review not found"}` instead of 404.
- No 429 (rate limiting) on any endpoint.
- No 413 (payload too large) for oversized PDFs or text.

### Embedding Failure Swallowed
If chunk_and_embed raises, the ingest endpoint returns 500 but the item row already exists in the database. The user sees an error but the item is partially created. No retry mechanism.

---

## Atomicity and Consistency Gaps

### Ingest Is Not Transactional
The URL ingest process makes 6+ separate Supabase calls:
1. Insert item
2. Link people (N calls for N person_ids)
3. Upsert tags + link (2N calls for N tags)
4. Add to collection
5. Insert chunks
6. Log activity

A failure at any step leaves the database in an inconsistent state. There's no rollback.

### Concurrent URL Ingest Race Condition
Two simultaneous ingests of the same URL could both pass the duplicate check (SELECT finds nothing), then both try to INSERT. The DB unique constraint (`items_user_url_unique`) would catch the second one at the Postgres level, but this surfaces as an unhandled 500 error instead of a graceful "already saving" response.

### Tag Upsert Race Condition
Two concurrent ingests adding the same tag could both try to upsert into the `tags` table. The `UNIQUE(user_id, name)` constraint handles this at the DB level via `ON CONFLICT`, but the subsequent `item_tags` insert could fail if timing is adversarial.

### Highlight-Review Coupling
Every highlight automatically creates a review queue entry. If the review queue insert fails, the highlight still exists but has no spaced repetition schedule. No mechanism to detect or fix these orphaned highlights.

---

## Missing Monitoring and Observability

### No Logging Framework
The entire backend has zero logging statements. No request logging, no error logging, no performance metrics. Debugging production issues requires adding print statements or attaching a debugger.

### No Health Check for Dependencies
`GET /health` returns `{"status": "ok"}` unconditionally. It doesn't verify:
- Supabase connectivity
- OpenAI API availability
- Whether required env vars are set

### No Rate Limiting
No rate limiting on any endpoint. A single client could:
- Flood `/ingest` to consume OpenAI embedding credits
- Flood `/rag/query` to consume Anthropic API credits
- Perform unlimited URL fetching through `/ingest/metadata` (which has no auth)

### No Request Tracing
No correlation IDs, no request-level timing, no way to trace a request through the ingest pipeline.

---

## Security Gaps (Beyond Bug Report)

### No Input Size Limits
- `extracted_text`: No max length. A 10MB text field would be stored and later embedded.
- `highlight.text`: No max length.
- `highlight.context`: No max length.
- `SearchRequest.query`: No max length. Could embed a 100K-word query.
- `RAGRequest.question`: No max length. Passed directly to Claude prompt.
- `BibTeXImportRequest.bibtex`: No max length. Could be a 100MB BibTeX file.

### No Content Security Policy
The Chrome extension injects DOM elements without CSP headers or sanitization. Highlight restoration uses `document.querySelector` with stored selectors.

### MCP Server Uses Service Key Directly
The MCP server creates its own Supabase client with the service role key, accessing all tables without RLS. While it filters by `STOA_USER_ID`, this env var is trusted without verification.

---

## Chrome Extension Gaps

### No Offline Support
If the API is unreachable, highlights are created in the DOM but the `saveHighlight` function fails silently. The highlight is visible on the page but not persisted. When the user navigates away, it's lost.

### No Local Persistence Fallback
Highlights should be queued in `chrome.storage.local` when the API is down, then synced when connectivity returns. Currently, the service worker stores highlights locally, but the content script talks directly to the API.

### Content Script on Restricted Pages
The manifest matches `<all_urls>`, so the content script loads on every page including:
- `chrome://` internal pages (will fail silently)
- `about:blank`
- PDF viewer pages
- Browser extension pages

The script should check `window.location.protocol` and bail on non-http(s) pages.

### Multiple Rapid Highlights
Rapidly creating highlights triggers multiple `/ingest` calls for the same URL (dedup check protects the DB but wastes API calls and bandwidth). Each highlight creates a new ingest request before the first one returns.

---

## Schema Gaps

### Missing Indexes
- `items.url`: No index on URL column. The duplicate check in ingest (`.eq("url", req.url)`) does a sequential scan. The `items_user_url_unique` constraint provides a unique index on `(user_id, url)`, which helps, but searches by URL alone (Chrome extension's highlight restore) would benefit from a separate index.
- `chunks.item_id`: No explicit index. The foreign key doesn't automatically create one in Postgres.
- `review_queue.next_review_at`: No index. The review endpoint queries `lte("next_review_at", now)` which is a range scan.
- `review_queue.user_id`: No index. Combined with `next_review_at` range query, this is a full table scan.

### Orphan Data Paths
Despite CASCADE deletes on most foreign keys:
- `tags` table: Deleting all items with a tag leaves the tag row (tags have no CASCADE from items). Tags accumulate.
- `people` table: If all person_items are deleted, the person row remains. No mechanism to detect "orphaned" people.
- `activity` table: CASCADE from items and highlights means deleting an item removes its activity log. This may be undesirable for analytics.

### No `updated_at` on Most Tables
Only `notes` has `updated_at`. Items, highlights, people, collections, and tags have no modification timestamp. Cannot track when a reading_status changed or when a highlight note was edited.

### No Full-Text Search Index
Full-text search uses `ilike` (pattern matching), not Postgres full-text search (`tsvector/tsquery`). This is O(n) per query and doesn't support ranking, stemming, or language-aware search.

---

## Feature Wishlist (Product Gaps)

### Reading Progress
- `scroll_position` field exists on items but is only used by the Chrome extension for local persistence. The backend never reads or writes it.
- No "% read" tracking aggregation.
- No "reading time" estimation.

### Export
- BibTeX export exists for single citations but no bulk export.
- No OPML export for feeds/blogs.
- No data export (JSON dump of all user data).

### Social Features
- `follows` and `activity` tables exist but no API endpoints.
- `is_public` field on collections and activity but no public-facing views.
- No "friends who saved this" feature despite the Chrome extension comment referencing "social overlay."

### Search Refinement
- No faceted search (filter by date range, domain, reading status).
- No saved searches.
- No search history.

### Annotation Enrichment
- No automatic tagging/classification of ingested content.
- No summary generation on ingest (summary field exists but is never populated).
- No related item suggestions.
