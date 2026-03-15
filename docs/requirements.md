# Stoa Requirements Specification

**Version**: 1.0
**Derived from**: Source code analysis + plan (`wild-popping-stream.md`)
**Date**: 2026-03-12

---

## 1. Content Ingestion

### FR-ING-001 URL Ingestion
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL accept a URL, extract article content and metadata (title, author, domain, favicon), store the item, chunk the extracted text, generate embeddings, and store chunks in the `chunks` table.
- **Rationale**: Core content acquisition pipeline. All other features depend on items existing in the library.
- **Source**: `backend/routers/ingest.py:28-112`, plan "POST /ingest" section
- **Acceptance Criteria**:
  - Given a valid public URL, When POST /ingest is called, Then an item record is created with extracted_text populated, chunks are created with embeddings, and an activity record with action="save" is logged.
  - Given a URL that has already been saved by this user, When POST /ingest is called, Then the existing item is returned with `deduplicated: true` and no new chunks are created.
- **Current Status**: Implemented
- **Test**: `backend/tests/conftest.py` provides fixtures; no specific ingest test file found.

### FR-ING-002 PDF Ingestion
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL accept a PDF file upload, extract text via PyMuPDF, upload the PDF to Supabase Storage under `{user_id}/pdfs/{filename}`, create an item of type "paper", chunk and embed the extracted text.
- **Rationale**: Papers are a primary content type for the target user.
- **Source**: `backend/routers/ingest.py:115-149`, plan "POST /ingest/pdf"
- **Acceptance Criteria**:
  - Given a PDF file, When POST /ingest/pdf is called, Then the PDF is uploaded to storage, an item is created with page_count in metadata, and chunks are generated.
  - Given a PDF with metadata (title, author), When extracted, Then the item title falls back to PDF metadata before defaulting to "Untitled PDF".
- **Current Status**: Implemented
- **Test**: None

### FR-ING-003 arXiv Ingestion
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL accept an arXiv paper ID, fetch metadata from the arXiv API, download and extract the PDF, create an item, create a citation record, auto-create Person records for authors (if not existing), link authors to the item via `person_items`, and chunk/embed the text.
- **Rationale**: arXiv is a primary source for research papers in the target domain.
- **Source**: `backend/routers/ingest.py:152-226`, `backend/services/extraction.py:87-122`, plan "POST /ingest/arxiv/{id}"
- **Acceptance Criteria**:
  - Given arXiv ID "2301.00234", When POST /ingest/arxiv/2301.00234 is called, Then metadata is fetched, PDF is downloaded and stored, a citation record is created with authors/year/abstract/arxiv_id, Person records are created or matched by name, and person_items links are created with relation="authored".
  - Given an arXiv ID with authors already in the user's people table, When ingested, Then existing Person records are reused (matched by exact name + user_id).
- **Current Status**: Implemented
- **Test**: None

### FR-ING-004 Metadata Extraction
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL provide a lightweight metadata extraction endpoint that returns title, author, domain, and favicon_url for a URL without performing full ingestion.
- **Rationale**: Chrome extension popup needs quick metadata preview before full save.
- **Source**: `backend/routers/ingest.py:229-239`, plan "POST /extract/metadata"
- **Acceptance Criteria**:
  - Given a valid URL, When POST /ingest/metadata is called, Then title, author, domain, and favicon_url are returned without creating any database records.
- **Current Status**: Implemented
- **Test**: None

### FR-ING-005 Duplicate URL Detection
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL prevent duplicate items per user by checking for existing items with the same URL before creating a new one. A database constraint SHALL enforce uniqueness of (user_id, url).
- **Rationale**: Chrome extension may attempt to save the same page multiple times; highlight creation calls ingest as a prerequisite.
- **Source**: `backend/routers/ingest.py:37-47`, `supabase/migrations/003_schema_fixes.sql:8`
- **Acceptance Criteria**:
  - Given user U has already saved URL X, When POST /ingest is called with URL X, Then the existing item is returned and no new item/chunks are created.
  - At the database level, inserting a duplicate (user_id, url) pair SHALL raise a unique constraint violation.
- **Current Status**: Implemented (application-level check + DB constraint)
- **Test**: None

### FR-ING-006 Tag Association on Ingest
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL accept a list of tag names during URL ingestion, create tags if they do not exist (upsert on user_id+name), and create item_tags links.
- **Rationale**: Tags are applied at save time from the Chrome extension popup.
- **Source**: `backend/routers/ingest.py:77-86`
- **Acceptance Criteria**:
  - Given tags ["AI", "new-tag"] on an ingest request, When processed, Then both tags exist in the tags table for this user, and item_tags links are created.
- **Current Status**: Implemented
- **Test**: None

### FR-ING-007 Person Linking on Ingest
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL accept a list of person_ids during URL ingestion and create person_items links with relation="authored".
- **Rationale**: Allows associating content with known people at save time.
- **Source**: `backend/routers/ingest.py:69-75`
- **Acceptance Criteria**:
  - Given person_ids ["uuid-1"], When ingest completes, Then a person_items record exists linking person uuid-1 to the new item with relation "authored".
- **Current Status**: Implemented
- **Test**: None

### FR-ING-008 Collection Association on Ingest
- **Type**: FR
- **Priority**: Could
- **Description**: The system SHALL accept an optional collection_id during URL ingestion and add the item to that collection with sort_order=0.
- **Rationale**: Convenience feature for adding directly to a reading list.
- **Source**: `backend/routers/ingest.py:89-94`
- **Acceptance Criteria**:
  - Given a collection_id, When ingest completes, Then a collection_items record exists with sort_order=0.
- **Current Status**: Implemented (sort_order always 0 -- does not append to end)
- **Test**: None

### FR-ING-009 Activity Logging on Save
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL create an activity record with action="save" when an item is ingested via URL.
- **Rationale**: Activity feed and social features depend on activity records.
- **Source**: `backend/routers/ingest.py:106-110`
- **Acceptance Criteria**:
  - When an item is successfully ingested, Then an activity record exists with user_id, action="save", and item_id.
- **Current Status**: Implemented for URL ingest only (NOT for PDF or arXiv ingest)
- **Test**: None

---

## 2. Search

### FR-SRC-001 Hybrid Search
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL provide hybrid search combining vector similarity search (via pgvector `match_chunks` RPC) and full-text search (via ILIKE on title and extracted_text), fused using Reciprocal Rank Fusion (RRF, k=60).
- **Rationale**: Hybrid search provides better recall than either method alone.
- **Source**: `backend/services/rag_pipeline.py:12-80`, `backend/routers/search.py`, `supabase/migrations/003_schema_fixes.sql:76-110`
- **Acceptance Criteria**:
  - Given a query "context engineering", When POST /search is called, Then results from both vector and full-text search are combined via RRF and returned as a ranked list.
  - Results SHALL be scoped to the authenticated user's items.
- **Current Status**: Implemented
- **Test**: None

### FR-SRC-002 Vector Similarity Search
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL embed the query text, call the `match_chunks` RPC with a cosine similarity threshold of 0.5, and return matching chunks with similarity scores.
- **Rationale**: Semantic search enables finding conceptually related content.
- **Source**: `backend/services/rag_pipeline.py:12-29`, `supabase/migrations/003_schema_fixes.sql:76-110`
- **Acceptance Criteria**:
  - Given a query, When vector_search is called, Then only chunks belonging to the user's items are returned, and all results have similarity > 0.5.
  - The match_chunks function SHALL support optional type filtering.
- **Current Status**: Implemented
- **Test**: None

### FR-SRC-003 Full-Text Search
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL search items by ILIKE pattern matching on both title and extracted_text fields, merge results, and deduplicate by item ID.
- **Rationale**: Keyword search catches exact terms that semantic search may miss.
- **Source**: `backend/services/rag_pipeline.py:32-57`
- **Acceptance Criteria**:
  - Given query "Karlsson", When full_text_search is called, Then items with "Karlsson" in title OR extracted_text are returned, deduplicated.
- **Current Status**: Implemented (using ILIKE, not PostgreSQL full-text search/tsvector)
- **Test**: None

### FR-SRC-004 Search Type Filtering
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL support filtering search results by content type (book, blog, paper, podcast, page, tweet, video).
- **Rationale**: Users need to search within specific content types.
- **Source**: `backend/routers/search.py:14-19`, `backend/services/rag_pipeline.py:75-80`
- **Acceptance Criteria**:
  - Given type="paper", When search is called, Then only items of type "paper" appear in results.
- **Current Status**: Implemented (type filter passed through to both vector and full-text search)
- **Test**: None

### FR-SRC-005 Search Tag Filtering
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support filtering search results by tags.
- **Rationale**: Plan specifies tag filtering in MCP search tool.
- **Source**: `backend/routers/search.py:18` (tags field exists on SearchRequest), plan MCP tools section
- **Acceptance Criteria**:
  - Given tags=["HCI"], When search is called, Then only items with the "HCI" tag appear in results.
- **Current Status**: **Not Implemented** -- tags parameter is accepted but never passed to `hybrid_search` and never used in filtering logic.
- **Test**: None

### FR-SRC-006 Search Person Filtering
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support filtering search results by person_id.
- **Rationale**: Plan specifies person filtering in MCP search tool.
- **Source**: `backend/routers/search.py:19` (person_id field exists on SearchRequest), plan MCP tools section
- **Acceptance Criteria**:
  - Given person_id="uuid-1", When search is called, Then only items linked to that person appear.
- **Current Status**: **Not Implemented** -- person_id parameter is accepted but never passed to `hybrid_search`.
- **Test**: None

---

## 3. RAG Query Pipeline

### FR-RAG-001 RAG Query
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL accept a natural language question, retrieve relevant context via hybrid search (top 8 results), construct a prompt with the context, call Claude (claude-sonnet-4-20250514) to synthesize an answer, and return the answer with source citations.
- **Rationale**: RAG over the personal knowledge base is the core intelligence feature.
- **Source**: `backend/services/rag_pipeline.py:83-126`, `backend/routers/rag.py`
- **Acceptance Criteria**:
  - Given question "What has Henrik Karlsson written about social graphs?", When POST /rag/query is called, Then the system retrieves relevant chunks/items, sends them as context to Claude, and returns an answer with sources (title, url, id).
  - The system prompt SHALL instruct Claude to answer ONLY from provided context and cite sources by title.
- **Current Status**: Implemented (single-pass; iterative decompose/gap-check from plan is NOT implemented)
- **Test**: None

### FR-RAG-002 RAG Graceful Degradation
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL return raw retrieved context when ANTHROPIC_API_KEY is not configured, instead of failing.
- **Rationale**: Enables testing and development without API key.
- **Source**: `backend/services/rag_pipeline.py:101-106`
- **Acceptance Criteria**:
  - Given no ANTHROPIC_API_KEY, When RAG query is called, Then the answer field contains truncated raw context (first 2000 chars) and sources are still returned.
- **Current Status**: Implemented
- **Test**: None

### FR-RAG-003 Iterative RAG (Decompose, Gap Check)
- **Type**: FR
- **Priority**: Could
- **Description**: The system MAY implement iterative RAG with query decomposition and gap checking as described in the plan.
- **Rationale**: Plan specifies "iterative RAG (decompose -> retrieve -> gap check -> synthesize)".
- **Source**: Plan "POST /rag/query" description, `backend/services/rag_pipeline.py` docstring
- **Acceptance Criteria**:
  - The RAG pipeline decomposes complex queries into sub-queries, retrieves for each, identifies gaps, and performs additional retrieval rounds.
- **Current Status**: **Not Implemented** -- current implementation is single-pass retrieve + synthesize.
- **Test**: None

---

## 4. Highlight Management

### FR-HLT-001 Create Highlight
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL create a highlight record with item_id, text, optional context, css_selector, start/end offsets, color (default "yellow"), and optional note. Upon creation, a review_queue entry SHALL be automatically created with next_review_at = now + 24 hours.
- **Rationale**: Highlights are the primary annotation mechanism and feed into spaced repetition.
- **Source**: `backend/routers/highlights.py:25-52`
- **Acceptance Criteria**:
  - Given valid highlight data, When POST /highlights is called, Then a highlight record is created AND a review_queue entry is created with next_review_at approximately 24h in the future, difficulty=0.3, repetitions=0.
- **Current Status**: Implemented
- **Test**: None

### FR-HLT-002 Retrieve Highlights by URL
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL retrieve highlights for a given URL by first looking up the item by (user_id, url), then returning highlights for that item_id, ordered by created_at DESC, limited to 100.
- **Rationale**: Chrome extension needs this for highlight re-injection on page load.
- **Source**: `backend/routers/highlights.py:55-82`
- **Acceptance Criteria**:
  - Given a URL that has been saved, When GET /highlights?url=X is called, Then all highlights for that item are returned.
  - Given a URL that has NOT been saved, Then an empty highlights array is returned (not an error).
- **Current Status**: Implemented
- **Test**: None

### FR-HLT-003 Retrieve Highlights by Item ID
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL retrieve highlights filtered by item_id.
- **Rationale**: Webapp item detail page needs highlights for a specific item.
- **Source**: `backend/routers/highlights.py:67-68`
- **Acceptance Criteria**:
  - Given an item_id, When GET /highlights?item_id=X is called, Then only highlights for that item are returned.
- **Current Status**: Implemented
- **Test**: None

### FR-HLT-004 Chrome Extension Highlight Creation
- **Type**: FR
- **Priority**: Must
- **Description**: The Chrome extension content script SHALL provide a floating toolbar on text selection with color buttons (yellow, green, blue, pink, purple) and a "Note" button. Clicking a color SHALL wrap the selection in a `<span class="stoa-highlight stoa-highlight-{color}">`, extract context from the closest paragraph element, compute a CSS selector path, and persist the highlight both locally (chrome.storage) and to the backend API.
- **Rationale**: In-page highlighting is the primary content annotation UX.
- **Source**: `chrome-extension/src/content/content.js:33-198`, `chrome-extension/src/content/highlights.css`
- **Acceptance Criteria**:
  - Given text is selected on a page, When the user clicks a color button, Then the text is visually highlighted, a highlight record is saved to the backend, and the item is created/deduped via /ingest first.
  - The toolbar SHALL appear above the selection and disappear on mousedown outside it.
  - The Note button SHALL show an inline input (not a blocking prompt()).
  - Minimum selection length is 3 characters.
- **Current Status**: Implemented
- **Test**: None

### FR-HLT-005 Highlight Re-injection
- **Type**: FR
- **Priority**: Must
- **Description**: The Chrome extension SHALL re-inject saved highlights on page load by fetching highlights from the backend API by URL, locating the target text via CSS selector + text matching using a TreeWalker, and wrapping matched text in highlight spans.
- **Rationale**: Persistent highlights across page visits are a core feature.
- **Source**: `chrome-extension/src/content/content.js:284-345`
- **Acceptance Criteria**:
  - Given a page with previously saved highlights, When the page loads and the user is authenticated, Then saved highlights are visually re-applied.
  - Given a CSS selector that no longer matches (page changed), Then the highlight is silently skipped (no error).
- **Current Status**: Implemented
- **Test**: None

---

## 5. Citation Management

### FR-CIT-001 BibTeX Export
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL export a citation as BibTeX format. If stored bibtex exists, return it directly. Otherwise, generate BibTeX from structured fields (authors, year, title, venue, doi, arxiv_id). The cite key SHALL be `{last_name_of_first_author}{year}`.
- **Rationale**: Citation management for research papers.
- **Source**: `backend/routers/citations.py:13-69`
- **Acceptance Criteria**:
  - Given an item with a citation record, When GET /citations/{item_id}/bib is called, Then valid BibTeX is returned.
  - The system SHALL verify the item belongs to the authenticated user before returning.
  - If no citation exists for the item, return 404.
- **Current Status**: Implemented
- **Test**: None

### FR-CIT-002 BibTeX Import
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL accept raw BibTeX text, parse it via bibtexparser, create an item (type="paper") for each entry, and create a citation record with authors, year, venue, doi, and the original bibtex string.
- **Rationale**: Bulk import from existing reference managers.
- **Source**: `backend/routers/citations.py:72-129`
- **Acceptance Criteria**:
  - Given valid BibTeX with 3 entries, When POST /citations/import is called, Then 3 items and 3 citations are created, and the response includes imported count and item data.
  - If bibtexparser is not installed, return 500 with descriptive message.
- **Current Status**: Implemented
- **Test**: None

### FR-CIT-003 arXiv Metadata Auto-Population
- **Type**: FR
- **Priority**: Must
- **Description**: When ingesting an arXiv paper, the system SHALL automatically populate the citation record with authors, year, abstract, arxiv_id, and pdf_storage_path from the arXiv API response.
- **Rationale**: Eliminates manual metadata entry for arXiv papers.
- **Source**: `backend/routers/ingest.py:185-194`, `backend/services/extraction.py:87-122`
- **Acceptance Criteria**:
  - Given arXiv ID with known metadata, When ingested, Then citation.authors is a JSONB array of {name} objects, citation.year is extracted from the published date, citation.abstract contains the paper summary.
- **Current Status**: Implemented
- **Test**: None

### FR-CIT-004 DOI-Based Citation Import
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support importing papers by DOI.
- **Rationale**: Plan specifies "add paper: paste arXiv ID / DOI / URL" and MCP tool accepts DOI.
- **Source**: Plan "Citation Manager" section, `mcp-server/server.py:200-229`
- **Acceptance Criteria**:
  - Given a DOI, When add_citation(doi="10.1234/...") is called, Then the paper is fetched, metadata populated, and stored.
- **Current Status**: **Not Implemented** -- MCP `add_citation` accepts doi parameter but returns error "Provide arxiv_id, doi, or bibtex" when only doi is given (no DOI resolution logic).
- **Test**: None

---

## 6. People / Milieu Graph

### FR-PPL-001 Add Person
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL support creating Person records with name (required), bio, website_url, twitter_handle, avatar_url, affiliation, role, tags (array), and notes.
- **Rationale**: People are first-class entities in the milieu graph.
- **Source**: `supabase/migrations/001_initial_schema.sql:8-21`, `mcp-server/server.py:232-261`, `webapp/src/app/people/page.tsx:35-51`
- **Acceptance Criteria**:
  - Given valid person data, When inserted via webapp or MCP, Then a Person record is created with user_id set to the authenticated user.
- **Current Status**: Implemented (webapp + MCP; no dedicated backend API endpoint)
- **Test**: None

### FR-PPL-002 Person Detail View
- **Type**: FR
- **Priority**: Must
- **Description**: The webapp SHALL display a person detail page showing: avatar, name, affiliation, role badge, tags, website/twitter links, items linked to this person (via person_items), and notes about this person.
- **Rationale**: People are the primary organizational unit.
- **Source**: `webapp/src/app/people/[id]/page.tsx`
- **Acceptance Criteria**:
  - Given a person ID, When navigating to /people/{id}, Then the person's full profile is displayed with linked items grouped by relation type.
- **Current Status**: Implemented
- **Test**: None

### FR-PPL-003 Person-Person Connections
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support person_connections records linking two people with a relation type and notes.
- **Rationale**: Intellectual lineage tracking (who mentors whom, who cites whom).
- **Source**: `supabase/migrations/001_initial_schema.sql:53-60`, plan "Person -> connected_to -> Person"
- **Acceptance Criteria**:
  - Person connections can be created with from_person_id, to_person_id, relation, and notes.
  - Connections are scoped to a user_id.
- **Current Status**: Partially Implemented -- schema exists, MCP `get_milieu_graph` and `get_person` read connections, but no CRUD API endpoint or webapp UI exists for creating/editing connections.
- **Test**: None

### FR-PPL-004 Milieu Graph Query
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL provide a way to retrieve all people and their connections as a graph structure.
- **Rationale**: MCP tool and potential webapp graph visualization.
- **Source**: `mcp-server/server.py:344-371`
- **Acceptance Criteria**:
  - When get_milieu_graph is called, Then all people (with id, name, affiliation, role, tags, notes) and all connections (from, to, relation, notes) for the user are returned.
- **Current Status**: Implemented (MCP only)
- **Test**: None

### FR-PPL-005 Person Search by Name
- **Type**: FR
- **Priority**: Should
- **Description**: The MCP server SHALL support fuzzy name matching when looking up people (via ILIKE %name%).
- **Rationale**: Natural language queries about people need fuzzy matching.
- **Source**: `mcp-server/server.py:384-418`
- **Acceptance Criteria**:
  - Given name="Karl", When get_person("Karl") is called, Then "Henrik Karlsson" is returned (if in milieu).
- **Current Status**: Implemented (MCP only)
- **Test**: None

### FR-PPL-006 Auto-Create Authors on arXiv Ingest
- **Type**: FR
- **Priority**: Should
- **Description**: When ingesting an arXiv paper, the system SHALL check if each author exists in the user's people table (by exact name match). If not, create a new Person with role="researcher". Link all authors to the item with relation="authored".
- **Rationale**: Automatic population of the milieu from paper metadata.
- **Source**: `backend/routers/ingest.py:197-219`
- **Acceptance Criteria**:
  - Given a paper with authors ["Alice Smith", "Bob Jones"], When ingested, Then both authors exist as People and are linked to the item.
  - If "Alice Smith" already exists for this user, the existing record is reused.
- **Current Status**: Implemented
- **Test**: None

### FR-PPL-007 Intellectual Graph Visualization
- **Type**: FR
- **Priority**: Could
- **Description**: The webapp MAY provide a d3-force graph visualization of people and their connections.
- **Rationale**: Plan mentions "Intellectual graph visualization (optional, d3-force)".
- **Source**: Plan "People View" section
- **Acceptance Criteria**:
  - The webapp renders an interactive force-directed graph showing people as nodes and connections as edges.
- **Current Status**: **Not Implemented**
- **Test**: None

---

## 7. Collections and Tags

### FR-COL-001 Collection CRUD
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL support creating, reading, and displaying collections with name, description, is_public flag, and cover_image_url.
- **Rationale**: Curated reading lists are a core organizational feature.
- **Source**: `supabase/migrations/001_initial_schema.sql:120-136`, `webapp/src/app/collections/[id]/page.tsx`
- **Acceptance Criteria**:
  - Collections can be created and viewed.
  - Collection detail page shows items ordered by sort_order.
  - Public collections are readable by other users (RLS policy exists).
- **Current Status**: Partially Implemented -- read/display works, but no create/edit/delete UI in webapp (only seed script creates them).
- **Test**: None

### FR-COL-002 Collection Item Ordering
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support ordered items within collections via sort_order, with drag-to-reorder in the webapp.
- **Rationale**: Plan specifies "Create/edit collections (drag to reorder)".
- **Source**: Plan "Collections" section, `supabase/migrations/001_initial_schema.sql:131-136`
- **Acceptance Criteria**:
  - Items in a collection are displayed in sort_order.
  - Users can drag items to reorder them, and sort_order is updated.
- **Current Status**: Partially Implemented -- sort_order field exists, items are queried with order("sort_order"), but no reorder UI or API endpoint exists.
- **Test**: None

### FR-COL-003 Public Collection Sharing
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support marking collections as public and providing shareable links.
- **Rationale**: Plan specifies "Public share links" for collections.
- **Source**: Plan "Collections" section, `supabase/migrations/001_initial_schema.sql:125`
- **Acceptance Criteria**:
  - When is_public=true, Then the collection is visible to unauthenticated users via a public URL.
  - The RLS policy for public collection reading is enforced.
- **Current Status**: Partially Implemented -- is_public field and RLS policy exist, webapp shows "Public" badge, but no share link generation or public access route.
- **Test**: None

### FR-TAG-001 Tag CRUD
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL support creating tags (unique per user by name), associating tags with items, and displaying tags in the sidebar.
- **Rationale**: Cross-cutting labels for content organization.
- **Source**: `supabase/migrations/001_initial_schema.sql:105-118`, `webapp/src/app/page.tsx`
- **Acceptance Criteria**:
  - Tags are unique per (user_id, name).
  - Tags appear in the webapp sidebar.
  - Tags can be created via the Chrome extension popup (#syntax) or ingest API.
- **Current Status**: Implemented (create via ingest, display in sidebar, Chrome extension tag input)
- **Test**: None

### FR-TAG-002 Tag Filtering
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHOULD support filtering the library view by tag.
- **Rationale**: Tags in the sidebar should be clickable to filter items.
- **Source**: Plan "Filter: by person, tag, collection, reading status, date range"
- **Acceptance Criteria**:
  - Clicking a tag in the sidebar filters items to those with that tag.
- **Current Status**: **Not Implemented** -- tags display in sidebar but are not clickable filters.
- **Test**: None

---

## 8. Spaced Repetition

### FR-SR-001 Review Queue Retrieval
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL return highlights due for review (next_review_at <= now), joined with highlight data, ordered by next_review_at, limited to a configurable count.
- **Rationale**: Core spaced repetition feature.
- **Source**: `backend/routers/review.py:19-36`
- **Acceptance Criteria**:
  - Given highlights with next_review_at in the past, When POST /review/next is called, Then those highlights are returned with their text, context, and note.
  - Only highlights belonging to the authenticated user are returned.
- **Current Status**: Implemented
- **Test**: None

### FR-SR-002 Review Response Processing
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL accept a quality rating (0=forgot, 1=hard, 2=good, 3=easy) and update the review schedule using a modified spaced repetition algorithm with base intervals [1, 6, 24, 72, 168, 720, 2160] hours, difficulty adjustment, and interval scaling by inverse difficulty.
- **Rationale**: Adaptive scheduling ensures efficient review.
- **Source**: `backend/routers/review.py:39-69`, `backend/services/spaced_rep.py`
- **Acceptance Criteria**:
  - Quality=0 (forgot): repetitions reset to 0, difficulty increases by 0.2, interval = 1 hour.
  - Quality=1 (hard): repetitions+1, difficulty increases by 0.1.
  - Quality=2 (good): repetitions+1, difficulty unchanged.
  - Quality=3 (easy): repetitions+1, difficulty decreases by 0.1.
  - Difficulty is clamped to [0.0, 1.0].
  - Interval = base_interval * (1.0 + (1.0 - difficulty)).
  - last_reviewed_at is updated to now.
- **Current Status**: Implemented
- **Test**: None

### FR-SR-003 Auto-Enqueue on Highlight Creation
- **Type**: FR
- **Priority**: Must
- **Description**: The system SHALL automatically enqueue every new highlight for spaced repetition review with initial next_review_at = now + 24 hours.
- **Rationale**: All highlights should enter the review pipeline by default.
- **Source**: `backend/routers/highlights.py:45-50`
- **Acceptance Criteria**:
  - When a highlight is created, Then a review_queue entry is created with next_review_at ~24h in the future.
- **Current Status**: Implemented
- **Test**: None

### FR-SR-004 Review UI
- **Type**: FR
- **Priority**: Must
- **Description**: The webapp SHALL provide a review queue page that shows highlight text, a "Reveal context" button, and four response buttons (Forgot/Hard/Good/Easy) with progress indicator.
- **Rationale**: Users need a UI to complete reviews.
- **Source**: `webapp/src/app/review/page.tsx`
- **Acceptance Criteria**:
  - The review page loads due highlights.
  - Context is hidden until "Reveal context" is clicked.
  - After responding, the next highlight is shown or the queue is refreshed.
  - Progress bar shows current position in the queue.
- **Current Status**: Implemented
- **Test**: None

---

## 9. Social Features

### FR-SOC-001 Follow System
- **Type**: FR
- **Priority**: Could
- **Description**: The system MAY support follows between Stoa users via the `follows` table.
- **Rationale**: Social layer for shared intellectual discovery.
- **Source**: `supabase/migrations/001_initial_schema.sql:170-176`, plan "Social Feed" section
- **Acceptance Criteria**:
  - Users can follow other users.
  - The follows table prevents self-follows and duplicate follows (composite PK).
- **Current Status**: Partially Implemented -- schema exists with RLS, but no API endpoint or webapp UI for following.
- **Test**: None

### FR-SOC-002 Activity Feed
- **Type**: FR
- **Priority**: Could
- **Description**: The system MAY provide an activity feed showing public actions (save, highlight, note, finish, recommend) from followed users.
- **Rationale**: Social discovery of what peers are reading.
- **Source**: `supabase/migrations/001_initial_schema.sql:178-187`, `webapp/src/components/ActivityFeed.tsx`
- **Acceptance Criteria**:
  - Activity feed displays actions with icons, labels, item titles, and timestamps.
  - Only public activities (is_public=true) are shown to other users.
- **Current Status**: Partially Implemented -- ActivityFeed component exists, public profile page renders it, but no follow-filtered feed or API endpoint.
- **Test**: None

### FR-SOC-003 Public Profiles
- **Type**: FR
- **Priority**: Could
- **Description**: The system MAY provide public user profiles showing public activity.
- **Rationale**: Plan specifies public profiles for social layer.
- **Source**: `webapp/src/app/profile/[username]/page.tsx`, plan "Public profiles"
- **Acceptance Criteria**:
  - /profile/{username} shows public activity for that user.
- **Current Status**: Partially Implemented -- page exists but loads ALL public activity (not filtered by username/user_id), no user profile data (name, avatar) is loaded.
- **Test**: None

### FR-SOC-004 Social Overlay in Chrome Extension
- **Type**: FR
- **Priority**: Could
- **Description**: The Chrome extension MAY show a badge indicating friends who saved the same page plus their highlights.
- **Rationale**: Plan specifies "Social overlay (badge showing friends who saved this page + their highlights)".
- **Source**: Plan "Chrome Extension" feature table, `chrome-extension/src/content/highlights.css:64-77`
- **Acceptance Criteria**:
  - A badge appears on pages saved by followed users showing count and their highlights.
- **Current Status**: **Not Implemented** -- CSS for the badge exists but no JavaScript logic.
- **Test**: None

---

## 10. Tab Group Management

### FR-TAB-001 Save Tab Group
- **Type**: FR
- **Priority**: Should
- **Description**: The Chrome extension SHALL save the current tab group (or all tabs in window if no group) with URL, title, favicon, and group color/name. Data is stored in chrome.storage.local.
- **Rationale**: Tab groups represent research sessions worth preserving.
- **Source**: `chrome-extension/src/background/service-worker.js:96-154`
- **Acceptance Criteria**:
  - Given tabs in a Chrome tab group, When "Save Tab Group" is clicked, Then tab data is stored locally with the group name and color.
  - Given no tab group, When saved, Then all window tabs are stored as "Saved Tabs".
- **Current Status**: Partially Implemented -- saves to chrome.storage.local but does NOT persist to the backend API/Supabase tab_groups table. The API call in lines 148-153 is a console.log stub.
- **Test**: None

### FR-TAB-002 Restore Tab Group
- **Type**: FR
- **Priority**: Should
- **Description**: The Chrome extension SHALL restore a saved tab group by opening all tabs and creating a Chrome tab group with the saved name and color.
- **Rationale**: Complementary to save; allows returning to a research session.
- **Source**: `chrome-extension/src/background/service-worker.js:156-170`
- **Acceptance Criteria**:
  - Given saved tab group data, When restoreTabGroup is called, Then all tabs are opened and grouped with the original name and color.
- **Current Status**: Partially Implemented -- function exists but no UI triggers it; no list of saved tab groups is exposed to the user.
- **Test**: None

### FR-TAB-003 Scroll Position Persistence
- **Type**: FR
- **Priority**: Should
- **Description**: The Chrome extension SHALL track and restore scroll positions for visited pages, saving on visibilitychange, beforeunload, and debounced scroll events (2s).
- **Rationale**: Resume reading where you left off.
- **Source**: `chrome-extension/src/content/content.js:347-391`
- **Acceptance Criteria**:
  - When navigating away from a page, scroll position (x, y, progress%) is saved.
  - When returning to the page, scroll position is restored after a 500ms delay.
- **Current Status**: Implemented (chrome.storage.local only, not synced to Supabase items.scroll_position)
- **Test**: None

---

## 11. MCP Server Interface

### FR-MCP-001 search_library Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide a `search_library` tool that proxies to the backend /search endpoint with query, type, tags, and person filters.
- **Rationale**: Claude Code integration for searching the knowledge base.
- **Source**: `mcp-server/server.py:33-63`
- **Acceptance Criteria**:
  - Given a query, When search_library is called via MCP, Then results from hybrid search are returned.
- **Current Status**: Implemented (but person filter is not resolved to person_id, and tags are sent but not used by backend)
- **Test**: None

### FR-MCP-002 get_highlights Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide a `get_highlights` tool with optional filtering by item_id, person name, or tag. Accesses Supabase directly.
- **Rationale**: Retrieve annotated passages via Claude Code.
- **Source**: `mcp-server/server.py:66-131`
- **Acceptance Criteria**:
  - Highlights can be filtered by item_id, by person name (fuzzy), or by tag name.
  - Results include joined item data (title, url, type).
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-003 get_notes Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide a `get_notes` tool with optional filtering by item_id or person name.
- **Rationale**: Retrieve personal notes via Claude Code.
- **Source**: `mcp-server/server.py:134-165`
- **Acceptance Criteria**:
  - Notes are filtered by item_id or person_id (resolved from name via ILIKE).
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-004 add_item Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide an `add_item` tool that proxies to /ingest.
- **Rationale**: Save content via Claude Code.
- **Source**: `mcp-server/server.py:168-196`
- **Acceptance Criteria**:
  - Given a URL, When add_item is called, Then the item is ingested and returned.
- **Current Status**: Implemented (but person name is accepted but never resolved to person_id; collection name is accepted but not resolved to collection_id)
- **Test**: None

### FR-MCP-005 add_citation Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide an `add_citation` tool accepting arxiv_id, doi, or bibtex.
- **Rationale**: Add research papers via Claude Code.
- **Source**: `mcp-server/server.py:199-229`
- **Acceptance Criteria**:
  - Given an arxiv_id, the paper is ingested via /ingest/arxiv.
  - Given bibtex, papers are imported via /citations/import.
  - Given only doi, an appropriate error or resolution occurs.
- **Current Status**: Partially Implemented (arxiv_id and bibtex work; doi returns error)
- **Test**: None

### FR-MCP-006 add_person Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide an `add_person` tool that inserts a Person record directly into Supabase.
- **Rationale**: Add people to milieu via Claude Code.
- **Source**: `mcp-server/server.py:232-261`
- **Acceptance Criteria**:
  - Given person data, When add_person is called, Then a Person record is created.
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-007 rag_query Tool
- **Type**: FR
- **Priority**: Must
- **Description**: The MCP server SHALL provide a `rag_query` tool that proxies to /rag/query.
- **Rationale**: Ask questions over the knowledge base via Claude Code.
- **Source**: `mcp-server/server.py:264-281`
- **Acceptance Criteria**:
  - Given a question, the RAG pipeline is invoked and the answer + sources returned.
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-008 get_reading_list Tool
- **Type**: FR
- **Priority**: Should
- **Description**: The MCP server SHALL provide a `get_reading_list` tool returning items in a named collection or all to_read items.
- **Rationale**: Retrieve reading lists via Claude Code.
- **Source**: `mcp-server/server.py:284-322`
- **Acceptance Criteria**:
  - Given collection="Friday Evening Reading", Then items in that collection are returned ordered by sort_order.
  - Given no collection, Then all to_read items are returned (most recent first, limit 20).
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-009 get_review_queue Tool
- **Type**: FR
- **Priority**: Should
- **Description**: The MCP server SHALL provide a `get_review_queue` tool returning due review items with highlight text, context, and note.
- **Rationale**: Check review status via Claude Code.
- **Source**: `mcp-server/server.py:325-341`
- **Acceptance Criteria**:
  - Returns up to 10 review items where next_review_at <= now.
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-010 get_milieu_graph Tool
- **Type**: FR
- **Priority**: Should
- **Description**: The MCP server SHALL provide a `get_milieu_graph` tool returning all people and connections.
- **Source**: `mcp-server/server.py:344-371`
- **Current Status**: Implemented
- **Test**: None

### FR-MCP-011 get_person Tool
- **Type**: FR
- **Priority**: Should
- **Description**: The MCP server SHALL provide a `get_person` tool returning person details, their items (with relations), and connections to other people.
- **Source**: `mcp-server/server.py:374-418`
- **Current Status**: Implemented
- **Test**: None

---

## 12. Chrome Extension General

### FR-EXT-001 Page Save via Popup
- **Type**: FR
- **Priority**: Must
- **Description**: The Chrome extension popup SHALL allow saving the current page with content type selection and tag input. The save button triggers /ingest via the service worker.
- **Rationale**: Primary save mechanism.
- **Source**: `chrome-extension/src/popup/popup.js`, `chrome-extension/src/popup/popup.html`
- **Acceptance Criteria**:
  - User opens popup, selects type, optionally adds tags, clicks "Save Page".
  - On success, status shows "Saved to Stoa" and a local flag is set.
- **Current Status**: Implemented
- **Test**: None

### FR-EXT-002 Keyboard Shortcuts
- **Type**: FR
- **Priority**: Should
- **Description**: The Chrome extension SHALL support keyboard shortcuts: Cmd+Shift+S to save page, Cmd+Shift+G to save tab group.
- **Rationale**: Power user efficiency.
- **Source**: `chrome-extension/manifest.json:34-47`, `chrome-extension/src/background/service-worker.js:173-192`
- **Acceptance Criteria**:
  - Cmd+Shift+S saves the active tab's URL via handleSavePage.
  - Cmd+Shift+G calls saveCurrentTabGroup.
- **Current Status**: Implemented
- **Test**: None

### FR-EXT-003 Context Menu Integration
- **Type**: FR
- **Priority**: Should
- **Description**: The Chrome extension SHALL add context menu items "Save to Stoa" (on page) and "Save link to Stoa" (on links).
- **Rationale**: Right-click save for convenience.
- **Source**: `chrome-extension/src/background/service-worker.js:195-225`
- **Acceptance Criteria**:
  - Right-clicking on a page shows "Save to Stoa" option.
  - Right-clicking on a link shows "Save link to Stoa" option.
  - Both trigger handleSavePage with the appropriate URL.
- **Current Status**: Implemented
- **Test**: None

### FR-EXT-004 Content Type Auto-Detection
- **Type**: FR
- **Priority**: Could
- **Description**: The content script SHALL guess content type from hostname (arxiv.org -> paper, youtube.com -> video, twitter.com/x.com -> tweet, default -> blog).
- **Rationale**: Reduces manual type selection.
- **Source**: `chrome-extension/src/content/content.js:394-399`
- **Acceptance Criteria**:
  - Saving from arxiv.org auto-sets type to "paper".
  - Default type is "blog".
- **Current Status**: Implemented (used when highlight creates implicit ingest; popup still requires manual selection)
- **Test**: None

---

## 13. Webapp General

### FR-WEB-001 Library Home Page
- **Type**: FR
- **Priority**: Must
- **Description**: The webapp SHALL display a library home page with: left sidebar (people, collections, tags with section toggles), top content type tabs (All/Books/Blogs/Papers/Podcasts), bookshelf for books, item list for other types, and local search filtering.
- **Rationale**: Primary interface for browsing the knowledge base.
- **Source**: `webapp/src/app/page.tsx`
- **Acceptance Criteria**:
  - Sidebar shows people, collections, and tags sections.
  - Content tabs filter items by type.
  - Bookshelf renders for book-type items.
  - Local search filters by title and domain.
- **Current Status**: Implemented
- **Test**: None

### FR-WEB-002 3D Bookshelf Component
- **Type**: FR
- **Priority**: Should
- **Description**: The webapp SHALL render books with 3D CSS transforms (spine rotateY -60 when selected, cover at 30 degrees), paper texture via SVG feTurbulence filter, horizontal scrolling with arrow navigation, and spring-based animations via Framer Motion.
- **Rationale**: Visual differentiation and aesthetic appeal.
- **Source**: `webapp/src/components/Bookshelf.tsx`, plan "Bookshelf Component (ported from Adam Maj)"
- **Acceptance Criteria**:
  - Books render as vertical spines.
  - Clicking a book opens it (spine rotates, cover is revealed).
  - Scroll arrows appear when content overflows.
  - Paper texture filter is applied.
- **Current Status**: Implemented
- **Test**: None

### FR-WEB-003 Item Detail Page
- **Type**: FR
- **Priority**: Must
- **Description**: The webapp SHALL provide an item detail page with: title, domain, date, external link, reading status toggles (to_read/reading/read), citation info (if paper), tabs for Content/Highlights/Notes.
- **Rationale**: Read and annotate saved content.
- **Source**: `webapp/src/app/item/[id]/page.tsx`
- **Acceptance Criteria**:
  - Extracted text is displayed in the Content tab.
  - Highlights are displayed in the Highlights tab (via HighlightPanel).
  - Notes tab provides a Tiptap editor.
  - Reading status can be toggled.
  - Citation info (authors, year, venue, abstract, BibTeX copy) is shown for papers.
- **Current Status**: Implemented
- **Test**: None

### FR-WEB-004 Search Page
- **Type**: FR
- **Priority**: Must
- **Description**: The webapp SHALL provide a search page with two modes: hybrid search and RAG query, with results displayed as cards and RAG answers with source citations.
- **Rationale**: Primary discovery interface.
- **Source**: `webapp/src/app/search/page.tsx`
- **Acceptance Criteria**:
  - Users can toggle between Search and Ask (RAG) modes.
  - Search mode shows item results.
  - RAG mode shows synthesized answer with sources.
- **Current Status**: Implemented (but user_id is hardcoded as "" -- auth not wired)
- **Test**: None

### FR-WEB-005 Note Editor
- **Type**: FR
- **Priority**: Must
- **Description**: The webapp SHALL provide a rich text note editor using Tiptap with markdown support (bold, italic, heading, bullet list, code block, blockquote).
- **Rationale**: Freeform thinking and synthesis.
- **Source**: `webapp/src/components/NoteEditor.tsx`
- **Acceptance Criteria**:
  - Editor renders with a toolbar (Bold, Italic, H2, List, Code, Quote).
  - Content is output as HTML.
- **Current Status**: Partially Implemented -- editor renders and fires onChange, but notes are not persisted to the database (no save action wired).
- **Test**: None

### FR-WEB-006 PWA Capability
- **Type**: FR
- **Priority**: Should
- **Description**: The webapp SHOULD be installable as a Progressive Web App with manifest.json, service worker, and mobile-responsive layout.
- **Rationale**: Plan specifies "PWA-capable for mobile use".
- **Source**: `webapp/src/app/layout.tsx:18-23` (manifest reference, appleWebApp config), plan "Polish + Ship" section
- **Acceptance Criteria**:
  - manifest.json exists and is referenced.
  - The app is installable on mobile devices.
  - Layout is responsive.
- **Current Status**: Partially Implemented -- metadata references manifest.json and appleWebApp, but no service worker registration or manifest.json file was found in the webapp public directory.
- **Test**: None

---

## 14. Seed Data

### FR-SEED-001 Milieu Data Seeding
- **Type**: FR
- **Priority**: Should
- **Description**: The system SHALL provide a seed script that populates the database with predefined people (18 entries), items (10 blog URLs), collections (3 lists), and tags (11 tags) from Hudson's milieu.
- **Rationale**: Bootstrap the system with real data for immediate utility.
- **Source**: `backend/seed.py`
- **Acceptance Criteria**:
  - Running the seed script with a valid STOA_USER_ID creates all people, items, collections, and tags.
  - People and tags use upsert to be idempotent.
  - Items use upsert on (user_id, url).
  - Collections use insert (not idempotent -- will create duplicates on re-run).
- **Current Status**: Implemented (with idempotency issue on collections)
- **Test**: None

---

## 15. Non-Functional Requirements: Security

### NFR-SEC-001 Authentication via Supabase JWT
- **Type**: NFR
- **Priority**: Must
- **Description**: The backend SHALL authenticate requests by validating the Supabase JWT from the Authorization header via `supabase.auth.get_user(token)`. In dev mode (STOA_DEV_MODE env var set), it SHALL accept X-User-Id header instead.
- **Rationale**: Multi-tenant security. Dev mode for local development.
- **Source**: `backend/services/auth.py`
- **Acceptance Criteria**:
  - Missing/invalid Authorization header returns 401.
  - Valid JWT extracts user_id from the token.
  - STOA_DEV_MODE + X-User-Id header bypasses JWT validation.
- **Current Status**: Implemented
- **Test**: `backend/tests/conftest.py` provides dev_mode_env and no_dev_mode_env fixtures.

### NFR-SEC-002 Row-Level Security
- **Type**: NFR
- **Priority**: Must
- **Description**: All tables SHALL have Row Level Security enabled with policies ensuring users can only read/write their own data, except: public collections are readable by anyone, public activity is readable by anyone.
- **Rationale**: Multi-tenant data isolation at the database level.
- **Source**: `supabase/migrations/001_initial_schema.sql:198-239`
- **Acceptance Criteria**:
  - RLS is enabled on all 15 tables.
  - Policies use auth.uid() = user_id pattern.
  - person_items, citations, item_tags, collection_items, chunks use EXISTS subquery to verify ownership through parent tables.
  - Public read policies exist for collections (is_public=true) and activity (is_public=true).
- **Current Status**: Implemented
- **Test**: None

### NFR-SEC-003 SSRF Prevention
- **Type**: NFR
- **Priority**: Must
- **Description**: The URL validator SHALL reject URLs with: non-http(s) schemes, missing hostname, known metadata endpoints (localhost, 169.254.169.254, metadata.google.internal), and hostnames resolving to private/loopback/link-local IP addresses. Post-redirect validation SHALL re-check the final URL after following redirects.
- **Rationale**: Prevent server-side request forgery attacks via the ingest pipeline.
- **Source**: `backend/services/url_validator.py`, `backend/services/extraction.py:17-18`
- **Acceptance Criteria**:
  - URL "file:///etc/passwd" is rejected (scheme check).
  - URL "http://localhost/admin" is rejected (blocked host).
  - URL "http://169.254.169.254/latest/meta-data" is rejected (blocked host).
  - URL resolving to 192.168.x.x is rejected (private IP).
  - URL that redirects to a private IP is rejected (post-redirect check).
- **Current Status**: Implemented
- **Test**: None

### NFR-SEC-004 CORS Configuration
- **Type**: NFR
- **Priority**: Must
- **Description**: The backend SHALL restrict CORS to localhost:3000 (webapp) and chrome-extension://* origins.
- **Rationale**: Prevent unauthorized cross-origin access.
- **Source**: `backend/main.py:11-17`
- **Acceptance Criteria**:
  - Requests from allowed origins succeed.
  - Requests from other origins are rejected.
  - Note: `chrome-extension://*` is a wildcard -- any Chrome extension can make requests.
- **Current Status**: Implemented (needs production origin update for deployment)
- **Test**: None

### NFR-SEC-005 Authorization Scoping
- **Type**: NFR
- **Priority**: Must
- **Description**: All backend endpoints SHALL scope queries to the authenticated user_id to prevent cross-user data access.
- **Rationale**: Defense in depth beyond RLS.
- **Source**: All router files use `get_user_id(request)` and filter by user_id.
- **Acceptance Criteria**:
  - No endpoint returns data belonging to a different user.
  - The review/respond endpoint verifies `.eq("user_id", user_id)` before updating.
  - BibTeX export verifies item ownership before returning.
- **Current Status**: Implemented
- **Test**: None

### NFR-SEC-006 Service Key Exposure Risk
- **Type**: NFR
- **Priority**: Must
- **Description**: The backend SHALL use a service role key to bypass RLS for server-side operations. This key MUST NOT be exposed to clients.
- **Rationale**: Service key has unrestricted access; exposure would compromise all data.
- **Source**: `backend/services/auth.py:10-16`, `mcp-server/server.py:25`
- **Acceptance Criteria**:
  - SUPABASE_SERVICE_KEY is only used server-side (backend, MCP server).
  - It is never sent to the webapp or Chrome extension.
- **Current Status**: Implemented (key loaded from env vars)
- **Test**: None

---

## 16. Non-Functional Requirements: Performance

### NFR-PERF-001 Embedding Generation Timeout
- **Type**: NFR
- **Priority**: Should
- **Description**: Embedding API calls SHALL have a timeout of 60 seconds.
- **Rationale**: Prevent indefinite hangs on OpenAI API calls.
- **Source**: `backend/services/embedding.py:65`
- **Acceptance Criteria**:
  - If the OpenAI embeddings API does not respond within 60 seconds, the request fails with a timeout error.
- **Current Status**: Implemented
- **Test**: None

### NFR-PERF-002 URL Fetch Timeout
- **Type**: NFR
- **Priority**: Should
- **Description**: URL fetching for content extraction SHALL have a timeout of 30 seconds.
- **Rationale**: Prevent long-running requests from blocking the server.
- **Source**: `backend/services/extraction.py:15`
- **Acceptance Criteria**:
  - URL fetch times out after 30 seconds.
- **Current Status**: Implemented
- **Test**: None

### NFR-PERF-003 HNSW Index for Vector Search
- **Type**: NFR
- **Priority**: Should
- **Description**: The chunks table embedding index SHALL use HNSW (not IVFFlat) for better recall at low row counts.
- **Rationale**: IVFFlat requires training data; HNSW works well at any scale.
- **Source**: `supabase/migrations/003_schema_fixes.sql:3-5`
- **Acceptance Criteria**:
  - The chunks_embedding_idx uses HNSW with vector_cosine_ops.
- **Current Status**: Implemented
- **Test**: None

### NFR-PERF-004 Chunking Parameters
- **Type**: NFR
- **Priority**: Should
- **Description**: Text chunking SHALL use 512-word chunks with 64-word overlap, split at sentence boundaries.
- **Rationale**: Balance between context length and retrieval granularity.
- **Source**: `backend/services/embedding.py:10-49`
- **Acceptance Criteria**:
  - Chunks are approximately 512 words, overlapping by approximately 64 words.
  - Splits occur at sentence boundaries (after . ! ?).
- **Current Status**: Implemented
- **Test**: None

---

## 17. Non-Functional Requirements: Reliability

### NFR-REL-001 Graceful Embedding Failure
- **Type**: NFR
- **Priority**: Must
- **Description**: The system SHALL raise a clear ValueError when OPENAI_API_KEY is not set, rather than silently producing zero vectors.
- **Rationale**: Zero vectors would produce meaningless search results.
- **Source**: `backend/services/embedding.py:58-63`
- **Acceptance Criteria**:
  - Without OPENAI_API_KEY, embed_texts raises ValueError with a descriptive message.
- **Current Status**: Implemented
- **Test**: None

### NFR-REL-002 Cascade Deletes
- **Type**: NFR
- **Priority**: Must
- **Description**: Deleting a parent record SHALL cascade to dependent records as specified: person deletion cascades to person_items and person_connections, item deletion cascades to person_items/citations/highlights/item_tags/collection_items/chunks/activity, highlight deletion cascades to review_queue and activity, collection deletion cascades to collection_items, tag deletion cascades to item_tags. Notes use SET NULL for item_id and person_id.
- **Rationale**: Prevent orphaned records.
- **Source**: `supabase/migrations/003_schema_fixes.sql:10-73`
- **Acceptance Criteria**:
  - Deleting an item removes all associated chunks, highlights, citations, person_items, item_tags, collection_items, and activity records.
  - Deleting a person removes person_items and person_connections referencing that person.
  - Deleting a note's associated item or person sets the FK to NULL.
- **Current Status**: Implemented
- **Test**: None

### NFR-REL-003 Chrome Extension Error Handling
- **Type**: NFR
- **Priority**: Should
- **Description**: The Chrome extension SHALL handle API failures gracefully without breaking page functionality. Failed highlight saves, scroll tracking, and page saves SHALL be caught and logged.
- **Rationale**: Extension runs on all pages and must not interfere with browsing.
- **Source**: `chrome-extension/src/content/content.js` (try/catch blocks throughout), `chrome-extension/src/background/service-worker.js`
- **Acceptance Criteria**:
  - If the backend is unreachable, highlights still work visually (CSS applied) but are not persisted.
  - Console errors are logged but no user-visible errors occur.
- **Current Status**: Implemented
- **Test**: None

---

## 18. Data Requirements

### DR-001 Embedding Dimensions
- **Type**: DR
- **Priority**: Must
- **Description**: Embeddings SHALL be stored as vector(1536), matching the output of text-embedding-3-small. The match_chunks RPC SHALL accept vector(1536) input.
- **Rationale**: Dimensional mismatch would cause search failures.
- **Source**: `supabase/migrations/001_initial_schema.sql:154`, `backend/services/embedding.py:69-71`
- **Acceptance Criteria**:
  - All stored embeddings have exactly 1536 dimensions.
  - The embedding model (configurable via EMBEDDING_MODEL env var, default text-embedding-3-small) produces 1536-dimensional vectors.
- **Current Status**: Implemented
- **Test**: None

### DR-002 Valid Item Types
- **Type**: DR
- **Priority**: Must
- **Description**: The items.type column SHALL only accept values: 'book', 'blog', 'paper', 'podcast', 'page', 'tweet', 'video' (enforced by CHECK constraint).
- **Rationale**: Data integrity for type-based filtering.
- **Source**: `supabase/migrations/001_initial_schema.sql:29`
- **Acceptance Criteria**:
  - Inserting an item with type="unknown" fails with a constraint violation.
- **Current Status**: Implemented
- **Test**: None

### DR-003 Valid Reading Statuses
- **Type**: DR
- **Priority**: Must
- **Description**: The items.reading_status column SHALL only accept: 'to_read', 'reading', 'read' (enforced by CHECK constraint, default 'to_read').
- **Rationale**: Consistent state machine for reading progress.
- **Source**: `supabase/migrations/001_initial_schema.sql:36`
- **Acceptance Criteria**:
  - Status transitions are constrained to the three valid values.
- **Current Status**: Implemented
- **Test**: None

### DR-004 Valid Activity Actions
- **Type**: DR
- **Priority**: Must
- **Description**: The activity.action column SHALL only accept: 'save', 'highlight', 'note', 'finish', 'recommend' (enforced by CHECK constraint).
- **Rationale**: Fixed set of trackable actions.
- **Source**: `supabase/migrations/001_initial_schema.sql:182`
- **Acceptance Criteria**:
  - Only valid actions can be inserted.
- **Current Status**: Implemented
- **Test**: None

### DR-005 Valid Person-Item Relations
- **Type**: DR
- **Priority**: Must
- **Description**: The person_items.relation column SHALL only accept: 'authored', 'recommended', 'mentioned_in', 'about' (enforced by CHECK constraint). The combination (person_id, item_id, relation) SHALL be unique.
- **Rationale**: Well-defined relationships between people and content.
- **Source**: `supabase/migrations/001_initial_schema.sql:47-49`
- **Acceptance Criteria**:
  - Duplicate (person, item, relation) tuples are rejected.
  - Invalid relation values are rejected.
- **Current Status**: Implemented
- **Test**: None

### DR-006 Tag Uniqueness per User
- **Type**: DR
- **Priority**: Must
- **Description**: The combination (user_id, name) SHALL be unique in the tags table.
- **Rationale**: Prevent duplicate tags per user.
- **Source**: `supabase/migrations/001_initial_schema.sql:111`
- **Acceptance Criteria**:
  - Creating two tags with the same name for the same user fails or upserts.
- **Current Status**: Implemented
- **Test**: None

### DR-007 URL Uniqueness per User
- **Type**: DR
- **Priority**: Must
- **Description**: The combination (user_id, url) SHALL be unique in the items table.
- **Rationale**: Prevent duplicate URLs in a user's library.
- **Source**: `supabase/migrations/003_schema_fixes.sql:8`
- **Acceptance Criteria**:
  - Inserting a duplicate (user_id, url) pair raises a constraint violation.
- **Current Status**: Implemented
- **Test**: None
