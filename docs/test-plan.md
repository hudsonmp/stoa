# Stoa Test Plan

## Scope

This test plan covers the Stoa personal knowledge base system: FastAPI backend (6 routers, 5 services), Chrome extension (Manifest V3), MCP server (FastMCP), Next.js webapp, and Supabase schema (16 tables + 1 RPC function + pgvector HNSW index).

References:
- `testing-guidance.md` -- exploratory test charters and attack patterns
- `requirements-guidance.md` -- requirements register with testability criteria
- Bach, J. (2003). *Heuristic Test Strategy Model*. -- Risk-based prioritization framework.
- Es, S. et al. (2023). *RAGAS: Automated Evaluation of RAG*. arXiv:2309.15217. -- RAG evaluation metrics.
- Whittaker, J. A. (2002). *How to Break Software*. -- Attack-based testing approach.

---

## 1. Risk-Based Prioritization

Components ranked by (probability of defect) x (impact of defect):

| Priority | Component | Risk Rationale |
|----------|-----------|----------------|
| **P0** | `services/auth.py` | Single point of access control. Dev mode bypass, service key bypasses RLS. Every auth bug = total data exposure. |
| **P0** | `services/url_validator.py` | SSRF prevention. TOCTOU race, incomplete IP format coverage. Exploitable = access to internal network. |
| **P0** | `routers/ingest.py` | Highest attack surface: accepts URLs, files, arXiv IDs. No input size limits. Race condition on dedup. |
| **P1** | `services/rag_pipeline.py` | Core feature. Prompt injection via stored content, no token budget, context overflow. |
| **P1** | `mcp-server/server.py` | Broken integration (user_id in body not headers). Service key direct DB access. ilike injection. |
| **P1** | `content.js` | Runs on all pages. innerHTML without sanitization. CSS selector injection from server. |
| **P2** | `services/embedding.py` | Chunking edge cases (empty text, single sentence). No batch size limit for embedding API. |
| **P2** | `routers/citations.py` | BibTeX parsing from untrusted input. Empty author array crash. |
| **P2** | `routers/review.py` | Quality value out of range. Missing 404 on not-found. Race on concurrent responses. |
| **P2** | `services/spaced_rep.py` | Pure function, low risk. Boundary value testing at difficulty 0/1, high repetition counts. |
| **P3** | `routers/highlights.py` | Standard CRUD. Low complexity. |
| **P3** | `routers/search.py` | Thin wrapper over rag_pipeline. Covered transitively. |
| **P3** | `service-worker.js`, `popup.js` | Limited attack surface (internal Chrome APIs). Missing auth headers on fetch. |
| **P3** | Schema migrations | Structural. Tested via constraint verification, not runtime tests. |

---

## 2. Unit Test Strategy

### What to Unit Test

Unit tests target pure functions and isolated logic with deterministic behavior:

| Module | Functions to Unit Test | Mock Strategy |
|--------|----------------------|---------------|
| `services/spaced_rep.py` | `next_review()` | **No mocks needed** -- pure function. Test all quality values (0-3), boundary difficulty (0.0, 1.0), high repetition counts (0, 1, 6, 7, 100). |
| `services/embedding.py` | `chunk_text()` | **No mocks needed** -- pure function. Test empty string, single sentence, text shorter than chunk_size, text exactly at chunk_size, very long text, text with no sentence boundaries. |
| `services/url_validator.py` | `validate_url()` | **Mock `socket.getaddrinfo`** to control DNS resolution. Test all IP bypass patterns: decimal, octal, IPv6, `@` in URL, scheme validation, blocked hosts. |
| `services/extraction.py` | `extract_from_pdf()` | **No mocks needed** -- operates on bytes. Use fixture PDFs (valid, corrupted, empty, huge metadata). |
| `services/extraction.py` | `fetch_arxiv_metadata()` | **Mock `httpx.AsyncClient`** -- return fixture XML. Test malformed XML, missing fields, unicode authors. |
| `services/rag_pipeline.py` | `reciprocal_rank_fusion()` | **No mocks needed** -- pure function. Test empty lists, single list, lists with overlapping/disjoint results, tie-breaking. |
| `services/auth.py` | `get_user_id()` | **Mock `Request` object and `supabase.auth.get_user`**. Test all auth paths: valid JWT, invalid JWT, expired JWT, dev mode with/without X-User-Id, dev mode disabled. |

### What NOT to Unit Test

- Supabase client calls (these are integration tests)
- FastAPI route handlers directly (test via HTTP client in integration tests)
- Chrome extension JS (requires browser environment -- use Playwright or manual testing)
- Next.js webapp pages (covered by E2E tests)

### Test Framework

```
backend/
  tests/
    unit/
      test_spaced_rep.py       # Pure function tests
      test_chunking.py         # chunk_text() edge cases
      test_url_validator.py    # SSRF prevention
      test_rrf.py              # reciprocal_rank_fusion()
      test_auth.py             # Auth path coverage
      test_extraction.py       # PDF extraction, arXiv XML parsing
    integration/
      test_ingest_api.py       # Full ingest flow with mocked external services
      test_search_api.py       # Search endpoints
      test_rag_api.py          # RAG query with mocked Claude
      test_citations_api.py    # BibTeX import/export
      test_highlights_api.py   # Highlight CRUD + review queue
      test_review_api.py       # Spaced rep endpoints
    fixtures/
      valid.pdf                # Small valid PDF
      corrupted.pdf            # Invalid PDF bytes
      arxiv_response.xml       # Sample arXiv API response
      sample.bib               # Valid BibTeX
    conftest.py                # Shared fixtures: test client, mock Supabase, mock auth
```

### Mock Strategy for Integration Tests

The key architectural decision: the backend uses `get_supabase_service()` (service role key) for all DB operations, bypassing RLS. Integration tests must:

1. **Mock the Supabase client** -- do not hit a real Supabase instance in CI. Use `unittest.mock.patch` on `services.auth.get_supabase_service` to return a mock client that tracks calls.
2. **Mock `get_user_id`** -- inject a known user_id for test isolation.
3. **Mock `embed_texts`** -- return deterministic fake embeddings (list of 1536 floats) to avoid OpenAI API calls.
4. **Mock `httpx.AsyncClient`** for URL fetching -- return fixture HTML/PDF bytes.
5. **Mock `anthropic.Anthropic`** for RAG synthesis -- return canned responses.

Use `fastapi.testclient.TestClient` (sync) or `httpx.AsyncClient` with `app` transport for async tests.

---

## 3. Coverage Targets

| Component | Target | Rationale |
|-----------|--------|-----------|
| `services/auth.py` | **95% branch** | Auth logic must cover every path. The dev mode branch, JWT validation, error handling. |
| `services/url_validator.py` | **95% branch** | Security-critical. Every IP format, every scheme, DNS resolution failure. |
| `services/spaced_rep.py` | **100% branch** | Pure function, small. Every quality value, every boundary. |
| `services/embedding.py` | **90% line** | `chunk_text` full coverage. `embed_texts` covered by mock verification. |
| `services/extraction.py` | **80% line** | PDF extraction paths, arXiv parsing. URL extraction has httpx dependency. |
| `services/rag_pipeline.py` | **85% line** | All search functions, RRF, RAG synthesis flow. LLM call is mocked. |
| `routers/*` | **80% line** | All happy paths + key error paths (auth failure, not found, invalid input). |
| `mcp-server/server.py` | **70% line** | Focus on tools that make API calls and direct DB queries. Mock both. |
| **Overall backend** | **85% line** | Floor, not ceiling. |

Chrome extension and webapp are excluded from automated coverage targets -- they require browser-based testing.

---

## 4. Integration Test Strategy

### Cross-Component Test Scenarios

| Scenario | Components | What to Verify |
|----------|-----------|---------------|
| **Ingest-to-search** | ingest -> embedding -> chunks -> search | Item ingested with chunks appears in both vector and full-text search results |
| **Ingest-to-RAG** | ingest -> embedding -> chunks -> rag_pipeline -> Claude | RAG query references the ingested content in its answer |
| **Highlight-to-review** | highlights -> review_queue -> spaced_rep | Creating a highlight auto-enqueues it; responding updates schedule correctly |
| **ArXiv-to-citation** | ingest/arxiv -> extraction -> citations -> BibTeX export | arXiv paper ingested has valid citation; BibTeX export round-trips |
| **Auth boundary** | auth -> any router | Verify 401 on missing/invalid/expired tokens across all endpoints |
| **Dedup guard** | ingest (same URL twice) | Second ingest returns existing item without creating new chunks |

### Database Constraint Tests

Run directly against a test database (or use Supabase local dev via Docker):

| Constraint | Test |
|-----------|------|
| `items_user_url_unique` | Insert two items with same (user_id, url) -- expect unique violation |
| `person_items UNIQUE(person_id, item_id, relation)` | Insert duplicate -- expect violation |
| `items.type CHECK` | Insert item with type="invalid" -- expect check violation |
| `items.reading_status CHECK` | Insert with status="unknown" -- expect check violation |
| `activity.action CHECK` | Insert with action="invalid" -- expect check violation |
| ON DELETE CASCADE | Delete an item -- verify chunks, highlights, review_queue, citations, person_items, activity are all deleted |
| ON DELETE SET NULL | Delete an item -- verify notes.item_id is set to null (not deleted) |

---

## 5. RAG Evaluation Methodology

Measuring search quality without production data requires a synthetic evaluation pipeline.

### Evaluation Set Construction

1. **Seed the database** with 100-200 items across diverse types (blog, paper, book, podcast) using `seed.py` or a dedicated fixture script.
2. **Construct 50 evaluation queries** manually, each with:
   - `query`: natural language question
   - `expected_item_ids`: list of item IDs that should be retrieved
   - `expected_answer_contains`: key phrases the RAG answer should include
   - `expected_answer_excludes`: phrases that would indicate hallucination

### Metrics (per RAGAS framework)

| Metric | How to Compute | Target | Notes |
|--------|---------------|--------|-------|
| **Context Precision** | For each query, compute precision@k: what fraction of top-k retrieved chunks are from expected items | >= 0.7 | Penalizes irrelevant chunks ranked highly |
| **Context Recall** | For each query, what fraction of expected items appear in the retrieval results | >= 0.8 | Penalizes missed relevant content |
| **Faithfulness** | Extract claims from RAG answer, verify each is supported by retrieved context | >= 0.85 | Use an LLM-as-judge to classify claims as supported/unsupported |
| **Noise Sensitivity** | Inject 30% irrelevant chunks, measure proportion of incorrect claims | <= 0.15 | Tests robustness to retrieval noise |
| **Answer Relevancy** | Score how well the answer addresses the original query (LLM-as-judge) | >= 0.8 | Distinct from faithfulness: an answer can be faithful but irrelevant |

### Evaluation Script Structure

```python
# backend/tests/evaluation/eval_rag.py

async def evaluate_rag_pipeline(eval_set: list[EvalCase]) -> dict:
    """Run RAGAS-style evaluation on the RAG pipeline.

    Each EvalCase has: query, expected_item_ids, reference_answer.

    Returns aggregate metrics: {
        "context_precision": float,
        "context_recall": float,
        "faithfulness": float,
        "noise_sensitivity": float,
        "answer_relevancy": float,
        "latency_p50_ms": float,
        "latency_p95_ms": float,
    }
    """
```

### Retrieval-Only Evaluation (no LLM needed)

For rapid iteration on search quality, evaluate retrieval independently:

1. Run `hybrid_search(query, user_id)` for each eval query
2. Compute precision@5, precision@10, recall@10, MRR (Mean Reciprocal Rank)
3. Compare vector-only vs. full-text-only vs. hybrid to validate that RRF fusion improves over either alone
4. Ablate `match_threshold` (currently 0.5) -- plot precision/recall tradeoff from 0.3 to 0.8

### Embedding Quality Sanity Checks

Without production data, verify embedding quality with synthetic tests:

- Embed two semantically similar sentences -- cosine similarity should be > 0.8
- Embed two unrelated sentences -- cosine similarity should be < 0.4
- Embed a query and its source chunk -- similarity should be > 0.7
- Verify that `chunk_text` chunking preserves semantic coherence (don't split mid-sentence in practice)

---

## 6. Security Test Plan

Derived from OWASP WSTG and the REST Security Cheat Sheet.

| Test ID | OWASP Ref | Target | Test Description |
|---------|-----------|--------|-----------------|
| ST-01 | WSTG-SESS-10 | `auth.py` | JWT with `"alg": "none"` is rejected |
| ST-02 | WSTG-SESS-10 | `auth.py` | Expired JWT is rejected |
| ST-03 | WSTG-ATHN-04 | `auth.py` | Dev mode X-User-Id is rejected when STOA_DEV_MODE unset |
| ST-04 | WSTG-ATHZ-04 | All routers | IDOR: User A cannot access User B's items/highlights/notes |
| ST-05 | WSTG-INPV-19 | `url_validator.py` | SSRF via decimal IP (2130706433) |
| ST-06 | WSTG-INPV-19 | `url_validator.py` | SSRF via `@` in URL |
| ST-07 | WSTG-INPV-19 | `url_validator.py` | SSRF via redirect to private IP |
| ST-08 | WSTG-INPV-19 | `url_validator.py` | SSRF via `file://` scheme |
| ST-09 | WSTG-INPV-05 | `rag_pipeline.py` | SQL/PostgREST injection via search query |
| ST-10 | -- | `rag_pipeline.py` | Prompt injection via stored content |
| ST-11 | -- | `popup.js` | XSS via tag input innerHTML |
| ST-12 | -- | `content.js` | XSS via CSS selector from server |
| ST-13 | -- | `ingest.py` | Path traversal via arXiv ID |
| ST-14 | WSTG-ATHZ-02 | `mcp-server/server.py` | Service key direct DB access without user scoping |

---

## 7. Test Execution Strategy

### Phase 1: Foundation (Week 1)
- Set up test infrastructure: pytest, conftest.py with fixtures, mock Supabase client
- Unit tests for `spaced_rep.py`, `embedding.py:chunk_text`, `url_validator.py`, `rag_pipeline.py:reciprocal_rank_fusion`
- Unit tests for `auth.py` covering all auth paths
- Target: P0 components at target coverage

### Phase 2: Integration (Week 2)
- Integration tests for ingest pipeline (URL, PDF, arXiv)
- Integration tests for search and RAG query
- Auth boundary tests across all endpoints
- Database constraint verification tests
- Target: All FUN-* and SEC-* requirements have at least one test

### Phase 3: Security & Evaluation (Week 3)
- SSRF test suite (all bypass patterns from ST-05 through ST-08)
- IDOR test suite (ST-04)
- RAG evaluation pipeline with synthetic eval set
- Retrieval quality benchmarks (precision, recall, MRR)
- Target: All ST-* security tests pass, RAG metrics baselined

### Phase 4: Extension & MCP (Week 4)
- Fix MCP server -> API integration (INT-01) and write integration tests
- Chrome extension manual testing with Playwright or manual checklist
- Input validation enforcement (VAL-01 through VAL-06) with unit tests
- Target: Full traceability matrix populated

---

## 8. Open Questions

1. **RLS vs. application-level isolation**: The backend uses the service role key, making all RLS policies moot. Should we (a) switch to the anon key and rely on RLS, (b) keep the service key and verify application-level scoping in tests, or (c) both? Option (a) is more secure but requires passing the user's JWT to the Supabase client. Option (c) provides defense in depth.

2. **Embedding model lock-in**: If `EMBEDDING_MODEL` env var changes (e.g., from `text-embedding-3-small` to a future model), existing chunks become incomparable. The test plan should include a migration test, but the re-embedding mechanism doesn't exist yet.

3. **MCP server architecture**: The server currently makes HTTP calls to the FastAPI backend for some operations and direct Supabase calls for others. This dual-path architecture means some tools bypass all API-level validation. Should the MCP server exclusively use the API?

4. **Chrome extension auth flow**: The extension currently stores `stoa_user_id` in local storage and optionally `stoa_token`. There's no mechanism for obtaining a JWT from Supabase Auth in the extension. This needs design before testing.
