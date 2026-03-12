# Stoa Requirements Gap Analysis

**Version**: 1.0
**Date**: 2026-03-12

---

## 1. Plan Features Missing from Code

### Critical Gaps (Must-have per plan, not implemented)

**GAP-001: Webapp Authentication**
- **Plan**: "Supabase auth (magic link)" in Build Order step 4
- **Code**: `webapp/src/lib/supabase.ts` creates a client with anon key but no auth flow. Pages query Supabase directly without `auth.getUser()`. The search page and review page pass empty string as user_id. The add-person flow in `webapp/src/app/people/page.tsx:39` calls `supabase.auth.getUser()` but there is no login page, no session management, no auth state provider.
- **Impact**: Webapp is non-functional for multi-user scenarios. All Supabase queries return nothing due to RLS (unless RLS is disabled or a service key is used client-side, which would be a security violation). Only works if RLS is bypassed during development.
- **Resolution**: Implement Supabase auth provider wrapping the app, magic link login page, session persistence, and pass auth token to all API calls.

**GAP-002: Note Persistence**
- **Plan**: "Notes editor (Tiptap with markdown support)" in Reading/Item View
- **Code**: `NoteEditor.tsx` renders and fires `onChange`, but neither `item/[id]/page.tsx` nor `people/[id]/page.tsx` persist the note to the database. `setNoteContent` updates local state only. No Supabase insert/update call exists. There is no backend endpoint for notes at all (no `routers/notes.py`).
- **Impact**: Notes are lost on page refresh.
- **Resolution**: Add a notes router to the backend, or write directly to Supabase from the webapp with auto-save/debounce.

**GAP-003: Search Tag and Person Filtering**
- **Plan**: "Filter: by person, tag, collection, reading status, date range" in Library main view
- **Code**: `SearchRequest` in `backend/routers/search.py` accepts `tags` and `person_id` fields but never passes them to `hybrid_search()`. The `hybrid_search` function signature accepts `type_filter` but nothing for tags or persons.
- **Impact**: MCP tool `search_library` sends tags that are silently ignored. Users cannot filter search results by author or tag.
- **Resolution**: Implement tag and person filtering in `hybrid_search` by joining through `item_tags`/`person_items` tables.

### Significant Gaps (Should-have per plan)

**GAP-004: DOI Resolution**
- **Plan**: "Add paper: paste arXiv ID / DOI / URL -> auto-fetch metadata + PDF"
- **Code**: MCP `add_citation` accepts `doi` parameter. If only `doi` is provided, it returns `{"error": "Provide arxiv_id, doi, or bibtex"}` with no resolution logic. No CrossRef/DOI.org API integration exists.
- **Resolution**: Add DOI resolution via CrossRef API (`https://api.crossref.org/works/{doi}`).

**GAP-005: Tab Group Backend Persistence**
- **Plan**: "Save tab group" stored in `tab_groups` Supabase table
- **Code**: `service-worker.js:148-153` has a console.log stub instead of an API call. Tab data goes to `chrome.storage.local` only. The `tab_groups` table exists but is never read or written by any code.
- **Resolution**: Add a `/tab-groups` backend endpoint and call it from the service worker.

**GAP-006: Collection Create/Edit/Delete**
- **Plan**: "Create/edit collections (drag to reorder)"
- **Code**: Collections are read-only in the webapp. Only `backend/seed.py` creates them. No create/edit/delete modal or API endpoint exists.
- **Resolution**: Add CRUD UI (modal) and either backend endpoints or direct Supabase writes from webapp.

**GAP-007: Follow System**
- **Plan**: "Follow system" and "Activity stream from followed users"
- **Code**: `follows` table exists with RLS but zero application code reads or writes it. No follow button, no follower count, no followed-user feed filtering.
- **Resolution**: Add follow/unfollow API endpoints, follow button on public profiles, and filtered activity feed.

**GAP-008: Person Connection CRUD**
- **Plan**: Person-Person relationships are first-class ("who mentors whom, who cites whom, influenced_by")
- **Code**: `person_connections` table exists. MCP reads connections via `get_milieu_graph` and `get_person`. But no create/update/delete path exists -- no backend endpoint, no webapp UI, no MCP write tool.
- **Resolution**: Add connection CRUD (backend endpoint + webapp UI on person detail page).

**GAP-009: Scroll Position Sync to Backend**
- **Plan**: Items have `scroll_position jsonb` field for `{x, y, selector, progress}`
- **Code**: Chrome extension tracks scroll to `chrome.storage.local` but never syncs to the items table. Webapp `ItemCard.tsx` reads `item.scroll_position?.progress` for the progress bar, but this is always null.
- **Resolution**: Sync scroll position to the backend items table on save (not on every scroll event).

**GAP-010: MCP add_item Person/Collection Resolution**
- **Plan**: MCP add_item accepts person name and collection name
- **Code**: `add_item` sends `person_ids: []` regardless of the `person` parameter. `collection` parameter is accepted but never resolved to a collection_id.
- **Resolution**: Resolve person name to person_id via people table lookup. Resolve collection name to collection_id via collections table lookup.

### Optional Gaps (Could-have per plan)

**GAP-011: Intellectual Graph Visualization**
- **Plan**: "Intellectual graph visualization (optional, d3-force)"
- **Code**: Not implemented.

**GAP-012: PDF Viewer with Highlights**
- **Plan**: "PDF viewer (react-pdf) with highlight support"
- **Code**: Not implemented. PDFs are stored but only extracted text is displayed.

**GAP-013: Related Items (Semantic Similarity)**
- **Plan**: "Related items (semantic similarity)" on item detail page
- **Code**: Not implemented. Would require a vector similarity query across the user's items.

**GAP-014: Social Overlay in Chrome Extension**
- **Plan**: "Social overlay: Badge showing friends who saved this page + their highlights (Supabase Realtime)"
- **Code**: CSS for `.stoa-social-badge` exists but no JS logic to query or render.

**GAP-015: PWA Service Worker**
- **Plan**: "PWA-capable for mobile (manifest.json, service worker, installable)"
- **Code**: Layout references `/manifest.json` and sets `appleWebApp` metadata, but no `manifest.json` or service worker file exists in the webapp public directory.

**GAP-016: Item-to-Item Citation Graph**
- **Plan**: "Item -> cites -> Item (paper citation graph)"
- **Code**: No schema table or code for item-to-item citation links.

**GAP-017: Highlight-to-Note Synthesis**
- **Plan**: "Highlight -> synthesized_into -> Note"
- **Code**: No schema table or code for this relationship.

---

## 2. Schema Invariants Not Enforced in Application Code

**GAP-SCH-001: person_connections.relation has no CHECK constraint**
- Schema defines `relation text NOT NULL` with a comment listing "mentors, collaborates_with, cites, influenced_by" but no CHECK constraint.
- Application code could insert any string as a relation type.
- **Risk**: Inconsistent data, broken UI display.

**GAP-SCH-002: citations.item_id has no uniqueness constraint**
- Multiple citation records can exist for the same item_id.
- Application code assumes at most one citation per item (`result.data[0]` in citations export, `.limit(1)` in webapp).
- **Risk**: BibTeX export returns wrong citation if duplicates exist.

**GAP-SCH-003: review_queue has no unique constraint on (user_id, highlight_id)**
- Every highlight creation inserts a new review_queue entry. If a highlight is created twice (e.g., API retry), duplicate review entries are created.
- **Risk**: User sees the same highlight multiple times in review queue.

**GAP-SCH-004: people table has no UNIQUE(user_id, name) constraint**
- `backend/seed.py:73-76` uses `upsert(on_conflict="user_id,name")` but this constraint does not exist.
- `backend/routers/ingest.py:198-205` matches authors by exact name but could create duplicates if names vary slightly.
- **Risk**: Seed script fails. Multiple Person records for the same person.

**GAP-SCH-005: chunks have no unique constraint on (item_id, chunk_index)**
- Re-ingesting the same URL (if the dedup check fails or is bypassed) would create duplicate chunks.
- **Risk**: Inflated search results, wasted storage.

**GAP-SCH-006: activity table -- only "save" action is ever written**
- CHECK constraint allows 'save', 'highlight', 'note', 'finish', 'recommend' but only the ingest router writes "save".
- Highlight creation does NOT log a "highlight" activity.
- Reading status change to "read" does NOT log a "finish" activity.
- Note creation (if implemented) does NOT log a "note" activity.
- **Risk**: Activity feed is incomplete; social features show only saves.

**GAP-SCH-007: items.scroll_position is never written**
- Column exists in schema but no backend code writes to it. Chrome extension stores scroll in chrome.storage.local.
- **Risk**: Webapp progress indicators based on scroll_position always show 0%.

---

## 3. Conflicting or Ambiguous Requirements

**CONFLICT-001: Auth header vs. request body user_id**
- Backend extracts user_id from Authorization header (JWT) or X-User-Id header (dev mode).
- Webapp API client (`webapp/src/lib/api.ts`) sends user_id in request bodies and query params.
- MCP server sends user_id in request bodies.
- Chrome extension sends user_id in request body (popup) or X-User-Id/Authorization header (content script).
- **Resolution needed**: Backend ignores body/query user_id and uses header only. Webapp and MCP clients should send auth headers, not user_id in bodies.

**CONFLICT-002: Chrome extension dual storage**
- Service worker stores highlights in `chrome.storage.local` (line 40-51).
- Content script fetches highlights from backend API (line 287-297).
- Content script also saves to backend API (line 266-278).
- The local storage cache in the service worker is written but never read for re-injection.
- **Ambiguity**: Is local storage a cache for offline use, or dead code?

**CONFLICT-003: Full-text search uses ILIKE, not PostgreSQL FTS**
- The `full_text_search` function uses `ILIKE` (case-insensitive pattern match) on title and extracted_text.
- Plan describes "hybrid full-text + semantic" implying PostgreSQL full-text search (tsvector/tsquery).
- ILIKE on large text columns without an index is slow.
- **Impact**: Performance degrades with scale. No ranking by text relevance (all ILIKE matches are equally ranked).
- **Resolution needed**: Implement proper PostgreSQL full-text search with GIN index.

**CONFLICT-004: MCP server bypasses backend auth**
- MCP server directly accesses Supabase with service key (`_supabase()`) for some tools (get_highlights, get_notes, add_person, etc.) but proxies through the backend API for others (search_library, add_item, rag_query, add_citation).
- Backend API endpoints require auth headers, but MCP proxy calls don't send them.
- **Impact**: MCP tools that proxy to the backend will fail with 401 (no auth header sent). Tools that access Supabase directly work but bypass any backend business logic.
- **Resolution needed**: MCP server should either always go through the backend (with auth) or always go direct to Supabase (consistently).

**CONFLICT-005: Ingest activity logging inconsistency**
- URL ingest logs activity with action="save" (line 106-110).
- PDF ingest does NOT log activity.
- arXiv ingest does NOT log activity.
- **Impact**: Activity feed misses PDF and arXiv saves.

**CONFLICT-006: Collection item sort_order always 0**
- When adding an item to a collection during ingest, `sort_order` is hardcoded to 0 (line 93).
- This means all items added to a collection have the same sort_order, making the ordering undefined.
- **Resolution**: Calculate sort_order as MAX(sort_order) + 1 for the collection.

---

## 4. Requirements Needing Clarification

**CLARIFY-001: What happens when the embedding API fails mid-ingest?**
- Current behavior: `chunk_and_embed` will raise an exception from `embed_texts`. The item has already been created in the database. No rollback occurs.
- Result: Item exists without chunks. Search will not find it via vector search, but full-text search on extracted_text works.
- **Need to decide**: Should ingest be transactional? Should chunks be retried later?

**CLARIFY-002: How are notes associated with items/people?**
- Notes table has optional item_id and person_id FKs.
- Webapp loads notes per item or per person but has no save mechanism.
- When notes are implemented, should a note be auto-linked to the item/person being viewed?
- Can a note be linked to both an item AND a person simultaneously?

**CLARIFY-003: How should the seed script handle the missing UNIQUE(user_id, name) on people?**
- The seed script calls upsert with `on_conflict="user_id,name"` but this constraint doesn't exist.
- Options: Add the constraint to the schema, or change the seed to use insert-if-not-exists logic.

**CLARIFY-004: What is the intended behavior for ILIKE SQL injection in full-text search?**
- `full_text_search` uses `.ilike("title", f"%{query}%")` and `.ilike("extracted_text", f"%{query}%")`.
- The supabase-py client parameterizes ILIKE values, so SQL injection is not a risk.
- However, ILIKE special characters (%, _) in user queries are not escaped, meaning a query containing "%" would match everything.
- **Need to decide**: Escape ILIKE special characters or switch to PostgreSQL FTS.

**CLARIFY-005: What should the MCP server user_id be?**
- MCP server reads `STOA_USER_ID` from environment.
- This is a single-user configuration -- the MCP server can only operate as one user.
- The backend API requires per-request auth, but MCP tools that proxy to the API don't send auth.
- **Need to decide**: How should MCP authenticate with the backend?

**CLARIFY-006: What is the retention policy for chunks when items are re-processed?**
- If an item's extracted_text is updated, old chunks remain and new chunks are added (no cleanup).
- CASCADE delete handles full item deletion, but partial re-processing creates duplicates.
- **Need to decide**: Should re-ingest delete existing chunks first?

---

## 5. Priority Matrix

### Blocking Issues (prevent core use)
1. GAP-001 (Webapp Auth) -- webapp is non-functional without auth
2. GAP-002 (Note Persistence) -- notes are lost
3. CONFLICT-004 (MCP Auth) -- MCP tools that proxy to backend fail
4. GAP-SCH-004 (People uniqueness) -- seed script fails

### High Impact (degrade key features)
5. GAP-003 (Search Filtering) -- tags/person filters silently ignored
6. GAP-SCH-006 (Activity Logging) -- activity feed is sparse
7. CONFLICT-001 (Auth header vs body) -- confusing and some calls may fail
8. CONFLICT-005 (Activity Inconsistency) -- missing saves in feed
9. GAP-009 (Scroll Sync) -- progress indicators always 0%

### Medium Impact (missing planned features)
10. GAP-004 (DOI) -- reduces paper import sources
11. GAP-005 (Tab Groups Backend) -- tab data lost on extension reinstall
12. GAP-006 (Collection CRUD) -- can't create reading lists from webapp
13. GAP-008 (Connection CRUD) -- can't build the milieu graph
14. GAP-010 (MCP Resolution) -- MCP person/collection params are ignored

### Zero Test Coverage
15. All 70+ requirements have zero test coverage
16. Test fixtures exist but no test files
17. Highest risk untested areas: SSRF prevention, auth, spaced rep algorithm, BibTeX generation
