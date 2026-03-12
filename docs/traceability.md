# Stoa Traceability Matrix

**Version**: 1.0
**Date**: 2026-03-12

---

## 1. Requirements to Code to Tests

| Requirement | Code Files | Schema Tables | Tests |
|---|---|---|---|
| FR-ING-001 (URL Ingest) | `backend/routers/ingest.py:28-112`, `backend/services/extraction.py:11-65`, `backend/services/embedding.py:78-96` | items, chunks, person_items, tags, item_tags, collection_items, activity | None |
| FR-ING-002 (PDF Ingest) | `backend/routers/ingest.py:115-149`, `backend/services/extraction.py:68-84` | items, chunks | None |
| FR-ING-003 (arXiv Ingest) | `backend/routers/ingest.py:152-226`, `backend/services/extraction.py:87-122` | items, citations, people, person_items, chunks | None |
| FR-ING-004 (Metadata Extract) | `backend/routers/ingest.py:229-239` | None | None |
| FR-ING-005 (Duplicate Detection) | `backend/routers/ingest.py:37-47`, `supabase/migrations/003_schema_fixes.sql:8` | items (unique constraint) | None |
| FR-ING-006 (Tags on Ingest) | `backend/routers/ingest.py:77-86` | tags, item_tags | None |
| FR-ING-007 (Person Linking) | `backend/routers/ingest.py:69-75` | person_items | None |
| FR-ING-008 (Collection Linking) | `backend/routers/ingest.py:89-94` | collection_items | None |
| FR-ING-009 (Activity Logging) | `backend/routers/ingest.py:106-110` | activity | None |
| FR-SRC-001 (Hybrid Search) | `backend/services/rag_pipeline.py:60-80`, `backend/routers/search.py` | items, chunks | None |
| FR-SRC-002 (Vector Search) | `backend/services/rag_pipeline.py:12-29`, `supabase/migrations/003_schema_fixes.sql:76-110` | chunks (via RPC) | None |
| FR-SRC-003 (Full-Text Search) | `backend/services/rag_pipeline.py:32-57` | items | None |
| FR-SRC-004 (Type Filter) | `backend/routers/search.py:17`, `backend/services/rag_pipeline.py:75-80` | items, chunks (via RPC) | None |
| FR-SRC-005 (Tag Filter) | `backend/routers/search.py:18` | -- | None |
| FR-SRC-006 (Person Filter) | `backend/routers/search.py:19` | -- | None |
| FR-RAG-001 (RAG Query) | `backend/services/rag_pipeline.py:83-126`, `backend/routers/rag.py` | items, chunks | None |
| FR-RAG-002 (RAG Degradation) | `backend/services/rag_pipeline.py:101-106` | -- | None |
| FR-RAG-003 (Iterative RAG) | -- | -- | None |
| FR-HLT-001 (Create Highlight) | `backend/routers/highlights.py:25-52` | highlights, review_queue | None |
| FR-HLT-002 (Get by URL) | `backend/routers/highlights.py:55-82` | highlights, items | None |
| FR-HLT-003 (Get by Item) | `backend/routers/highlights.py:67-68` | highlights | None |
| FR-HLT-004 (Extension Highlight) | `chrome-extension/src/content/content.js:33-198`, `chrome-extension/src/content/highlights.css` | -- | None |
| FR-HLT-005 (Re-injection) | `chrome-extension/src/content/content.js:284-345` | -- | None |
| FR-CIT-001 (BibTeX Export) | `backend/routers/citations.py:13-69` | citations, items | None |
| FR-CIT-002 (BibTeX Import) | `backend/routers/citations.py:72-129` | items, citations | None |
| FR-CIT-003 (arXiv Auto-Populate) | `backend/routers/ingest.py:185-194`, `backend/services/extraction.py:87-122` | citations | None |
| FR-CIT-004 (DOI Import) | -- | -- | None |
| FR-PPL-001 (Add Person) | `mcp-server/server.py:232-261`, `webapp/src/app/people/page.tsx:35-51` | people | None |
| FR-PPL-002 (Person Detail) | `webapp/src/app/people/[id]/page.tsx` | people, person_items, notes | None |
| FR-PPL-003 (Person Connections) | `supabase/migrations/001_initial_schema.sql:53-60`, `mcp-server/server.py:344-418` | person_connections | None |
| FR-PPL-004 (Milieu Graph) | `mcp-server/server.py:344-371` | people, person_connections | None |
| FR-PPL-005 (Person Search) | `mcp-server/server.py:374-418` | people, person_items | None |
| FR-PPL-006 (Auto-Create Authors) | `backend/routers/ingest.py:197-219` | people, person_items | None |
| FR-PPL-007 (Graph Viz) | -- | -- | None |
| FR-COL-001 (Collection CRUD) | `webapp/src/app/collections/[id]/page.tsx` | collections, collection_items | None |
| FR-COL-002 (Item Ordering) | `webapp/src/app/collections/[id]/page.tsx:31-32` | collection_items.sort_order | None |
| FR-COL-003 (Public Sharing) | `supabase/migrations/001_initial_schema.sql:125,230` | collections.is_public | None |
| FR-TAG-001 (Tag CRUD) | `backend/routers/ingest.py:77-86`, `webapp/src/app/page.tsx:59-60` | tags, item_tags | None |
| FR-TAG-002 (Tag Filtering) | -- | -- | None |
| FR-SR-001 (Review Queue) | `backend/routers/review.py:19-36` | review_queue, highlights | None |
| FR-SR-002 (Review Response) | `backend/routers/review.py:39-69`, `backend/services/spaced_rep.py` | review_queue | None |
| FR-SR-003 (Auto-Enqueue) | `backend/routers/highlights.py:45-50` | review_queue | None |
| FR-SR-004 (Review UI) | `webapp/src/app/review/page.tsx` | -- | None |
| FR-SOC-001 (Follows) | `supabase/migrations/001_initial_schema.sql:170-176` | follows | None |
| FR-SOC-002 (Activity Feed) | `webapp/src/components/ActivityFeed.tsx`, `webapp/src/app/profile/[username]/page.tsx` | activity | None |
| FR-SOC-003 (Public Profiles) | `webapp/src/app/profile/[username]/page.tsx` | activity | None |
| FR-SOC-004 (Social Overlay) | `chrome-extension/src/content/highlights.css:64-77` | -- | None |
| FR-TAB-001 (Save Tab Group) | `chrome-extension/src/background/service-worker.js:96-154` | tab_groups (not used) | None |
| FR-TAB-002 (Restore Tab Group) | `chrome-extension/src/background/service-worker.js:156-170` | tab_groups (not used) | None |
| FR-TAB-003 (Scroll Persistence) | `chrome-extension/src/content/content.js:347-391` | items.scroll_position (not used) | None |
| FR-MCP-001 (search_library) | `mcp-server/server.py:33-63` | -- | None |
| FR-MCP-002 (get_highlights) | `mcp-server/server.py:66-131` | highlights, items, people, tags, item_tags, person_items | None |
| FR-MCP-003 (get_notes) | `mcp-server/server.py:134-165` | notes, people | None |
| FR-MCP-004 (add_item) | `mcp-server/server.py:168-196` | -- | None |
| FR-MCP-005 (add_citation) | `mcp-server/server.py:199-229` | -- | None |
| FR-MCP-006 (add_person) | `mcp-server/server.py:232-261` | people | None |
| FR-MCP-007 (rag_query) | `mcp-server/server.py:264-281` | -- | None |
| FR-MCP-008 (get_reading_list) | `mcp-server/server.py:284-322` | collections, collection_items, items | None |
| FR-MCP-009 (get_review_queue) | `mcp-server/server.py:325-341` | review_queue, highlights | None |
| FR-MCP-010 (get_milieu_graph) | `mcp-server/server.py:344-371` | people, person_connections | None |
| FR-MCP-011 (get_person) | `mcp-server/server.py:374-418` | people, person_items, person_connections, items | None |
| FR-EXT-001 (Popup Save) | `chrome-extension/src/popup/popup.js`, `chrome-extension/src/popup/popup.html` | -- | None |
| FR-EXT-002 (Shortcuts) | `chrome-extension/manifest.json:33-47`, `chrome-extension/src/background/service-worker.js:173-192` | -- | None |
| FR-EXT-003 (Context Menu) | `chrome-extension/src/background/service-worker.js:195-225` | -- | None |
| FR-EXT-004 (Type Detection) | `chrome-extension/src/content/content.js:394-399` | -- | None |
| FR-WEB-001 (Library Home) | `webapp/src/app/page.tsx` | items, people, collections, tags | None |
| FR-WEB-002 (Bookshelf) | `webapp/src/components/Bookshelf.tsx` | items | None |
| FR-WEB-003 (Item Detail) | `webapp/src/app/item/[id]/page.tsx` | items, highlights, citations, notes | None |
| FR-WEB-004 (Search Page) | `webapp/src/app/search/page.tsx` | -- | None |
| FR-WEB-005 (Note Editor) | `webapp/src/components/NoteEditor.tsx` | notes (not persisted) | None |
| FR-WEB-006 (PWA) | `webapp/src/app/layout.tsx:18-23` | -- | None |
| FR-SEED-001 (Seed Data) | `backend/seed.py` | people, items, collections, tags | None |
| NFR-SEC-001 (Auth) | `backend/services/auth.py` | -- | `backend/tests/conftest.py` (fixtures only) |
| NFR-SEC-002 (RLS) | `supabase/migrations/001_initial_schema.sql:198-239` | All tables | None |
| NFR-SEC-003 (SSRF) | `backend/services/url_validator.py`, `backend/services/extraction.py:17-18` | -- | None |
| NFR-SEC-004 (CORS) | `backend/main.py:11-17` | -- | None |
| NFR-SEC-005 (Auth Scoping) | All router files | -- | None |
| NFR-SEC-006 (Service Key) | `backend/services/auth.py:10-16`, `mcp-server/server.py:25` | -- | None |
| NFR-PERF-001 (Embed Timeout) | `backend/services/embedding.py:65` | -- | None |
| NFR-PERF-002 (URL Timeout) | `backend/services/extraction.py:15` | -- | None |
| NFR-PERF-003 (HNSW Index) | `supabase/migrations/003_schema_fixes.sql:3-5` | chunks | None |
| NFR-PERF-004 (Chunking) | `backend/services/embedding.py:10-49` | -- | None |
| NFR-REL-001 (Embed Failure) | `backend/services/embedding.py:58-63` | -- | None |
| NFR-REL-002 (Cascades) | `supabase/migrations/003_schema_fixes.sql:10-73` | All FK tables | None |
| NFR-REL-003 (Extension Errors) | `chrome-extension/src/content/content.js`, `chrome-extension/src/background/service-worker.js` | -- | None |
| DR-001 (Embedding Dims) | `backend/services/embedding.py:69-71`, `supabase/migrations/001_initial_schema.sql:154` | chunks.embedding | None |
| DR-002 (Item Types) | `supabase/migrations/001_initial_schema.sql:29` | items.type | None |
| DR-003 (Reading Status) | `supabase/migrations/001_initial_schema.sql:36` | items.reading_status | None |
| DR-004 (Activity Actions) | `supabase/migrations/001_initial_schema.sql:182` | activity.action | None |
| DR-005 (Person-Item Relations) | `supabase/migrations/001_initial_schema.sql:47-49` | person_items.relation | None |
| DR-006 (Tag Uniqueness) | `supabase/migrations/001_initial_schema.sql:111` | tags | None |
| DR-007 (URL Uniqueness) | `supabase/migrations/003_schema_fixes.sql:8` | items | None |

---

## 2. Untested Requirements

**Every requirement is untested.** The test infrastructure (`backend/tests/conftest.py`) provides fixtures (MockSupabaseClient, dev mode env, mock embeddings, mock HTTP) but no actual test files exist. Zero test coverage.

Priority test targets (highest risk if broken):
1. NFR-SEC-003 (SSRF Prevention) -- security-critical
2. NFR-SEC-001 (Authentication) -- security-critical
3. FR-SRC-001 (Hybrid Search) -- core functionality
4. FR-SR-002 (Review Response) -- algorithmic correctness of spaced rep
5. FR-ING-003 (arXiv Ingest) -- complex multi-step pipeline
6. FR-CIT-001 (BibTeX Export) -- string generation correctness
7. FR-ING-005 (Duplicate Detection) -- data integrity
8. NFR-REL-002 (Cascade Deletes) -- data integrity

---

## 3. Code Without Corresponding Requirements (Undocumented Features)

| Code Location | Description | Gap |
|---|---|---|
| `backend/main.py:27-29` | Health check endpoint GET /health | No requirement; trivial but documents an operational endpoint |
| `backend/services/auth.py:19-25` | `get_supabase_anon()` client | Created but never used anywhere; dead code |
| `chrome-extension/src/background/service-worker.js:40-51` | Local storage of highlights in service worker | Duplicates backend storage; unclear if local cache is ever used for re-injection (content script fetches from API) |
| `backend/seed.py` | Person upsert uses `on_conflict="user_id,name"` | No UNIQUE(user_id, name) constraint on people table; this upsert would fail |
| `webapp/src/lib/api.ts:17-26` | `ingestUrl` sends `user_id` in request body | Backend extracts user_id from auth header, not request body; this field is ignored |
| `webapp/src/lib/api.ts:28-32` | `ingestArxiv` sends user_id as query param | Backend extracts from auth header; query param is ignored |

---

## 4. Plan Requirements Without Implementation

| Plan Feature | Plan Section | Status |
|---|---|---|
| Iterative RAG (decompose/gap-check) | "POST /rag/query" description | Single-pass only |
| DOI-based paper import | "Citation Manager", MCP add_citation | DOI parameter accepted but not resolved |
| Tag filtering in search | "Filter: by person, tag, collection..." | Tags accepted on request but ignored |
| Person filtering in search | "Filter: by person..." | person_id accepted but ignored |
| Collection CRUD (create/edit/delete) | "Create/edit collections (drag to reorder)" | Read-only; no create/edit UI |
| Drag-to-reorder collections | "Create/edit collections (drag to reorder)" | sort_order exists but no reorder UI |
| d3-force graph visualization | "Intellectual graph visualization (optional, d3-force)" | Not implemented |
| Follow system API + UI | "Social Feed: Follow system" | Schema only |
| Activity feed filtered by follows | "Activity stream from followed users" | No follow-filtered feed |
| Social overlay in Chrome extension | "Social overlay: Badge showing friends..." | CSS stub only |
| Tab group save to Supabase | "Save tab group" | Local storage only; API stub |
| Tab group restore UI | "Restore tab group" | Function exists but no UI trigger |
| Scroll position sync to Supabase | "Scroll position tracking" | Local chrome.storage only |
| Person connection CRUD UI | "Connections to other people" | Read via MCP; no create/edit |
| Public collection share links | "Public share links" | is_public flag but no share URL |
| PDF viewer with highlights | "PDF viewer (react-pdf) with highlights" | Not implemented |
| Reader view (clean extracted content) | "Clean reader (extracted content)" | Shows raw extracted_text; no reader formatting |
| Related items (semantic similarity) | "Related items (semantic similarity)" | Not implemented |
| "People connected to this item" on item view | "People connected to this item" | Not shown on item detail page |
| Quick-add person from Chrome extension | "Save author button when viewing blog/profile" | Not implemented |
| Supabase auth (magic link) in webapp | "Supabase auth (magic link)" | No auth flow; RLS with anon key |
| PWA service worker | "PWA-capable for mobile" | manifest reference but no SW |
| Responsive/mobile layout | "Responsive/PWA for mobile" | No responsive testing |
| Note persistence to database | "Notes editor (Tiptap with markdown)" | Editor renders but notes not saved |
| Item-to-item citation graph | "Item -> cites -> Item (paper citation graph)" | No schema or code for item-item citations |
| Person -> recommended -> Item | "Person -> recommended -> Item" | Relation type in schema but no UI/flow to create |
| Highlight -> synthesized_into -> Note | "Highlight -> synthesized_into -> Note" | No schema or code |
| Item -> related_to -> Item (semantic) | "Item -> related_to -> Item" | No schema or code |

---

## 5. Schema Tables to Code Coverage

| Table | Backend Read | Backend Write | Webapp Read | MCP Read | MCP Write |
|---|---|---|---|---|---|
| people | ingest.py (arXiv) | ingest.py (arXiv) | page.tsx, people/ | server.py (get_person, get_milieu_graph, get_highlights, get_notes) | server.py (add_person) |
| items | search, rag, ingest, citations, highlights | ingest | page.tsx, item/, collections/ | server.py (get_reading_list, get_person) | -- (via API) |
| person_items | -- | ingest.py | people/[id] | server.py (get_person) | -- |
| person_connections | -- | -- | -- | server.py (get_milieu_graph, get_person) | -- |
| citations | citations.py | ingest.py (arXiv), citations.py (import) | item/[id] | -- | -- (via API) |
| highlights | highlights.py | highlights.py | item/[id] | server.py (get_highlights) | -- |
| notes | -- | -- | item/[id], people/[id] | server.py (get_notes) | -- |
| tags | ingest.py (write) | ingest.py | page.tsx | server.py (get_highlights) | -- |
| item_tags | -- | ingest.py | -- | server.py (get_highlights) | -- |
| collections | -- | -- | page.tsx, collections/[id] | server.py (get_reading_list) | -- |
| collection_items | -- | ingest.py | collections/[id] | server.py (get_reading_list) | -- |
| tab_groups | -- | -- | -- | -- | -- |
| chunks | rag_pipeline.py (via RPC) | ingest.py | -- | -- | -- |
| review_queue | review.py | highlights.py (auto-enqueue), review.py (update) | review/ (via API) | server.py (get_review_queue) | -- |
| follows | -- | -- | -- | -- | -- |
| activity | -- | ingest.py (save only) | profile/[username] | -- | -- |

**Tables with no application-level writes**: person_connections, notes, tab_groups, follows. These exist in schema but have no insert/update paths.

**Tables with no reads or writes**: tab_groups (schema exists, chrome extension uses chrome.storage.local instead).
