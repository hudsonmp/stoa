# Stoa Requirement Engineering Guidance

## Methodological Foundation

This document specifies how to derive, format, and trace requirements for Stoa. Requirements emerge from three sources: (1) design intent (README, architecture), (2) exploratory test results (`testing-guidance.md`), and (3) quality attribute analysis.

Key references:
- Binder, R. V. (2000). *Testing Object-Oriented Systems*. Addison-Wesley. -- Requirement-test bidirectional tracing.
- Gartner, M. (2012). *ATDD by Example*. Addison-Wesley. -- Acceptance tests as executable requirements.
- Robertson, S. & Robertson, J. (2012). *Mastering the Requirements Process*. Addison-Wesley. -- Volere template, fit criteria.
- IEEE 29148:2018. *Systems and Software Engineering -- Life Cycle Processes -- Requirements Engineering*.
- Es, S., James, J., Burtenshaw, B., & Espejel, R. (2023). *RAGAS: Automated Evaluation of Retrieval Augmented Generation*. arXiv:2309.15217.
- OWASP (2024). *Web Security Testing Guide* v4.2 + *REST Security Cheat Sheet*.

---

## Deriving Requirements from Exploratory Test Results

The feedback loop between testing and requirements follows this cycle:

```
Exploratory Test Session
        |
        v
Bug Report (with "Requirement Signal" field)
        |
        v
Gap Analysis: Does a requirement exist for this behavior?
        |
     +--+--+
     |     |
     v     v
   YES    NO
     |     |
     v     v
  Verify  Draft new requirement
  requirement    |
  covers case    v
     |     Validate against design intent
     v           |
  Update         v
  traceability   Assign ID, priority, testability criteria
  matrix         |
                 v
            Add to requirements register
```

### Translating Bug Signals to Requirements

Each bug report's "Requirement Signal" field should produce a requirement draft:

| Bug Signal | Requirement Pattern |
|-----------|-------------------|
| "Auth bypass possible via X" | SEC-nn: The system SHALL [enforce auth constraint] |
| "No validation on input Y" | VAL-nn: The system SHALL validate [input] against [criteria] |
| "Data inconsistency when Z" | DAT-nn: The system SHALL maintain [consistency invariant] |
| "Feature fails under condition W" | FUN-nn: The system SHALL [handle condition] by [behavior] |
| "Performance degrades at scale N" | QA-nn: The system SHALL [meet performance target] when [condition] |

---

## Requirement Specification Format

### Notation

Requirements use RFC 2119 keywords with strict interpretation:
- **SHALL**: Mandatory. System MUST satisfy this before deployment. Maps to a blocking test.
- **SHOULD**: Expected. Deviation requires documented justification. Maps to a non-blocking test.
- **MAY**: Optional. No test required but implementation should not violate.

### Requirement Template

```
[ID]: [Category]-[Sequential Number]
[Priority]: P0 (launch blocker) | P1 (pre-launch) | P2 (post-launch) | P3 (backlog)

[Statement]:
  The system SHALL/SHOULD/MAY [observable behavior]
  WHEN [precondition or trigger]
  SO THAT [rationale / quality attribute served].

[Testability Criteria]:
  GIVEN [test setup]
  WHEN [test action]
  THEN [verifiable outcome with concrete threshold or observable]

[Trace]:
  Design Source: [README section, architecture doc, or "derived from test"]
  Test Charter: [charter ID from testing-guidance.md]
  Bug Report: [BUG-id, if applicable]
  Test Case: [test file:function, when implemented]
```

### Requirement Categories

| Prefix | Category | Description |
|--------|----------|-------------|
| SEC | Security | Authentication, authorization, data isolation, SSRF prevention |
| FUN | Functional | Core features: ingest, search, highlight, review, citation |
| DAT | Data Integrity | Schema constraints, referential integrity, consistency invariants |
| QA | Quality Attribute | Performance, reliability, RAG quality metrics |
| VAL | Input Validation | Size limits, format constraints, sanitization |
| INT | Integration | Cross-component contracts (API <-> Extension, API <-> MCP) |

---

## Security Requirements (derived from OWASP WSTG + REST Security Cheat Sheet)

### SEC-01: JWT Authentication Enforcement
**P0**

The system SHALL validate Supabase JWT tokens on every API request WHEN the system is not in dev mode SO THAT unauthorized access is prevented.

Testability Criteria:
- GIVEN a request with no Authorization header and STOA_DEV_MODE unset, WHEN any protected endpoint is called, THEN the response status is 401
- GIVEN a request with an expired JWT, WHEN any protected endpoint is called, THEN the response status is 401
- GIVEN a request with `"alg": "none"` JWT, WHEN any protected endpoint is called, THEN the response status is 401

Trace: OWASP WSTG-SESS-10, Charter 1A

### SEC-02: Dev Mode Isolation
**P0**

The system SHALL prevent dev mode authentication bypass in production WHEN STOA_DEV_MODE is not explicitly set to a truthy value SO THAT the X-User-Id header cannot be used for authentication in production.

Testability Criteria:
- GIVEN STOA_DEV_MODE is unset or empty, WHEN a request includes X-User-Id header but no valid JWT, THEN the response status is 401
- GIVEN STOA_DEV_MODE=1, WHEN a request includes X-User-Id but also a valid JWT for a different user, THEN the JWT identity takes precedence

Trace: Charter 1A, `auth.py:33-38`

### SEC-03: Data Isolation via User Scoping
**P0**

The system SHALL enforce that every database query returning user data includes a `user_id` filter matching the authenticated user SO THAT no cross-user data leakage occurs.

Testability Criteria:
- GIVEN User A is authenticated, WHEN User A requests highlights/items/notes/collections, THEN only User A's data is returned
- GIVEN User A's item_id, WHEN User B requests `/citations/{item_id}/bib`, THEN the response is 404

Trace: OWASP WSTG-ATHZ-04 (IDOR), Charter 1A, Charter 5A

### SEC-04: SSRF Prevention
**P0**

The system SHALL reject URLs that resolve to private, loopback, or link-local IP addresses WHEN processing URL ingestion requests SO THAT server-side request forgery is prevented.

Testability Criteria:
- GIVEN a URL resolving to 127.0.0.1 (including decimal/octal encoding), WHEN `/ingest` is called, THEN the response is 400
- GIVEN a URL with scheme `file://`, WHEN `/ingest` is called, THEN the response is 400
- GIVEN a URL that redirects to a private IP, WHEN `/ingest` follows the redirect, THEN the redirect target is re-validated and rejected
- GIVEN a URL with `@` character (e.g., `https://google.com@169.254.169.254/`), WHEN hostname is parsed, THEN the actual resolved IP is checked, not the apparent domain

Trace: OWASP WSTG-INPV-19, Charter 1B, `url_validator.py`

### SEC-05: XSS Prevention in Chrome Extension
**P1**

The system SHALL sanitize all user-provided content before DOM insertion WHEN rendering highlights, tags, or injected UI elements SO THAT cross-site scripting is prevented.

Testability Criteria:
- GIVEN a tag name containing `<script>alert(1)</script>`, WHEN rendered in popup, THEN the script is not executed
- GIVEN a highlight CSS selector from the server containing malicious content, WHEN `document.querySelector` is called, THEN no code execution occurs
- GIVEN highlight text containing HTML tags, WHEN wrapped in a span via `surroundContents`, THEN the HTML is treated as text content

Trace: Charter 2A, `popup.js:121`, `content.js:302`

### SEC-06: Rate Limiting
**P1**

The system SHALL enforce rate limits on all endpoints SO THAT denial-of-service and brute-force attacks are mitigated.

Testability Criteria:
- GIVEN >100 requests/minute from a single IP to `/ingest`, THEN responses return 429 after the threshold
- GIVEN >50 requests/minute to `/rag/query` (which calls external APIs), THEN responses return 429

Trace: OWASP REST Security Cheat Sheet, Charter 1B

### SEC-07: Security Headers
**P1**

The system SHALL include security headers on all API responses SO THAT common browser-based attacks are mitigated.

Required headers:
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (when HTTPS)

Testability Criteria:
- GIVEN any API response, WHEN response headers are inspected, THEN all required headers are present

Trace: OWASP REST Security Cheat Sheet

---

## Functional Requirements

### FUN-01: URL Ingestion
**P0**

The system SHALL extract title, text content, and metadata from a provided URL, chunk the text, generate embeddings, and store all artifacts WHEN a valid URL is submitted to `/ingest` SO THAT the content is searchable and retrievable via RAG.

Testability Criteria:
- GIVEN a valid blog URL, WHEN `/ingest` is called, THEN an item record is created with non-empty title and extracted_text, AND at least one chunk record is created with a 1536-dimensional embedding vector
- GIVEN a URL that was previously ingested by the same user, WHEN `/ingest` is called again, THEN the existing item is returned with `deduplicated: true` and no new chunks are created

Trace: `ingest.py:28-112`, Charter 1B

### FUN-02: PDF Ingestion
**P0**

The system SHALL extract text from uploaded PDFs, store the PDF in Supabase Storage, chunk the text, and generate embeddings WHEN a PDF file is uploaded to `/ingest/pdf`.

Testability Criteria:
- GIVEN a valid PDF under 50MB, WHEN uploaded to `/ingest/pdf`, THEN an item with type "paper" is created, the PDF is stored at `{user_id}/pdfs/{filename}`, and chunks are generated
- GIVEN a corrupted PDF (invalid magic bytes), WHEN uploaded, THEN a 400 error is returned (not a 500)

Trace: `ingest.py:115-149`, Charter 1B

### FUN-03: Hybrid Search
**P0**

The system SHALL return relevant items using a combination of vector similarity search and full-text search, fused via Reciprocal Rank Fusion WHEN a search query is submitted.

Testability Criteria:
- GIVEN an item with title "Context Engineering for AI Systems" and a query "context engineering", THEN the item appears in the top 3 results
- GIVEN both vector and full-text results exist, WHEN results are fused, THEN items appearing in both lists are ranked higher than items appearing in only one

Trace: `rag_pipeline.py:60-80`, Charter 1C

### FUN-04: RAG Query
**P1**

The system SHALL retrieve relevant context from the user's library and synthesize an answer using Claude WHEN a natural language question is submitted to `/rag/query`.

Testability Criteria:
- GIVEN a question about content that exists in the user's library, WHEN `/rag/query` is called, THEN the response includes an answer AND a non-empty sources list with titles matching retrieved items
- GIVEN a question about content NOT in the user's library, THEN the answer states insufficient information

Trace: `rag_pipeline.py:83-126`, Charter 4A/4B

### FUN-05: Highlight Lifecycle
**P1**

The system SHALL save highlights with text, context, CSS selector, and color, AND automatically enqueue them for spaced repetition WHEN a highlight is created via the API.

Testability Criteria:
- GIVEN a valid highlight payload, WHEN `POST /highlights` is called, THEN a highlight record AND a review_queue record are created, with `next_review_at` approximately 24 hours in the future
- GIVEN a highlight for a specific item, WHEN `GET /highlights?item_id={id}` is called, THEN the highlight is returned

Trace: `highlights.py`, Charter 1E

### FUN-06: Spaced Repetition Scheduling
**P1**

The system SHALL schedule reviews using half-power law intervals that increase with successful reviews and decrease with difficulty WHEN a review response is submitted.

Testability Criteria:
- GIVEN a review with quality=0 (forgot), THEN difficulty increases by 0.2 (capped at 1.0) and repetitions reset to 0
- GIVEN a review with quality=3 (easy), THEN difficulty decreases by 0.1 (floored at 0.0) and the next interval is longer than the current
- GIVEN repetitions > 6, THEN the interval is capped at `BASE_INTERVALS[6]` (2160 hours) scaled by difficulty

Trace: `spaced_rep.py`, Charter 1E

### FUN-07: Citation Management
**P2**

The system SHALL generate valid BibTeX from citation metadata AND import BibTeX entries as items with linked citations WHEN citation endpoints are used.

Testability Criteria:
- GIVEN an item with a citation record, WHEN `/citations/{item_id}/bib` is called, THEN valid BibTeX is returned that parses without error
- GIVEN valid BibTeX with 5 entries, WHEN `/citations/import` is called, THEN 5 items and 5 citation records are created

Trace: `citations.py`, Charter 1D

---

## Data Integrity Requirements

### DAT-01: Referential Integrity on Deletion
**P0**

The system SHALL cascade-delete dependent records (chunks, highlights, review_queue entries, citations, person_items, activity) WHEN an item is deleted SO THAT no orphan records exist.

Testability Criteria:
- GIVEN an item with 10 chunks, 3 highlights, and 2 review_queue entries, WHEN the item is deleted, THEN all dependent records are also deleted

Trace: `003_schema_fixes.sql` (ON DELETE CASCADE), Charter 5A

### DAT-02: Cross-User Referential Integrity
**P1**

The system SHALL prevent creating `person_items` linking a person owned by User A to an item owned by User B SO THAT the data model is consistent within user boundaries.

Testability Criteria:
- GIVEN Person P (owned by User A) and Item I (owned by User B), WHEN a person_item record linking P to I is inserted, THEN the insert is rejected

Trace: Charter 5A -- `person_items` has no `user_id` column, constraint must be added or enforced at application level

### DAT-03: Duplicate Prevention
**P1**

The system SHALL prevent duplicate items for the same (user_id, url) pair AND prevent duplicate review_queue entries for the same (user_id, highlight_id) pair.

Testability Criteria:
- GIVEN a user who already has an item for URL X, WHEN `/ingest` is called with URL X, THEN the existing item is returned (not duplicated)
- GIVEN a highlight already in the review queue, WHEN a new review_queue entry is attempted for the same highlight, THEN only one entry exists

Trace: `003_schema_fixes.sql` (items_user_url_unique), Charter 5A -- review_queue lacks this constraint

### DAT-04: Embedding Consistency
**P2**

The system SHALL ensure that all chunks for a given item use the same embedding model and dimensionality SO THAT vector search results are comparable.

Testability Criteria:
- GIVEN an item re-ingested after an embedding model change, THEN old chunks are deleted and new chunks are generated with the current model

Trace: Charter 4A -- no mechanism currently exists for re-embedding

---

## Quality Attribute Requirements for RAG

These requirements follow the RAGAS evaluation framework (Es et al., 2023).

### QA-01: Retrieval Precision
**P1**

The system SHOULD achieve context precision >= 0.7 (RAGAS metric) on a curated evaluation set SO THAT retrieved chunks are relevant to the query.

Measurement method:
- Construct an evaluation set of 50 (query, expected_sources) pairs from seeded library content
- For each query, run `hybrid_search` and compute precision@k against expected sources
- Report mean context precision across the evaluation set

Trace: RAGAS framework, Charter 4A

### QA-02: Retrieval Recall
**P1**

The system SHOULD achieve context recall >= 0.8 (RAGAS metric) on a curated evaluation set SO THAT relevant content is not missed by retrieval.

Measurement method:
- Same evaluation set as QA-01
- For each query, verify that all expected sources appear in the top-k results
- Report mean context recall

Trace: RAGAS framework, Charter 4A

### QA-03: Answer Faithfulness
**P1**

The system SHOULD achieve faithfulness >= 0.85 (RAGAS metric) on RAG query responses SO THAT generated answers are grounded in retrieved context and do not hallucinate.

Measurement method:
- For each RAG response, extract factual claims
- Verify each claim is supported by the retrieved context
- Faithfulness = supported_claims / total_claims

Trace: RAGAS framework (arXiv:2309.15217), Charter 4B

### QA-04: Noise Sensitivity
**P2**

The system SHOULD achieve noise sensitivity <= 0.15 on RAG responses SO THAT irrelevant retrieved content does not corrupt answer quality.

Measurement method:
- Inject 30% irrelevant chunks into retrieval results
- Measure proportion of incorrect claims in the response
- Lower is better (0 = perfectly robust to noise)

Trace: RAGAS framework, Charter 4B

### QA-05: Search Latency
**P2**

The system SHALL return hybrid search results within 2 seconds (p95) for libraries with up to 10,000 items SO THAT the user experience remains interactive.

Testability Criteria:
- GIVEN a library with 10,000 items and 50,000 chunks, WHEN a search query is submitted, THEN results are returned within 2 seconds at p95

Trace: General quality attribute, Charter 4A

### QA-06: Ingest Latency
**P2**

The system SHALL complete URL ingestion (extract + chunk + embed + store) within 30 seconds (p95) for standard web pages SO THAT the save-from-browser flow feels responsive.

Testability Criteria:
- GIVEN a standard blog post (<50KB HTML), WHEN `/ingest` is called, THEN the response is returned within 30 seconds at p95

Trace: General quality attribute, Charter 1B

---

## Input Validation Requirements

### VAL-01: URL Length Limit
**P1**

The system SHALL reject URLs longer than 2048 characters WHEN processing ingestion requests SO THAT buffer overflow and resource exhaustion are prevented.

Testability Criteria:
- GIVEN a URL of 2049 characters, WHEN `/ingest` is called, THEN the response is 400

### VAL-02: PDF Size Limit
**P1**

The system SHALL reject PDFs larger than 100MB WHEN processing upload requests SO THAT memory exhaustion is prevented.

Testability Criteria:
- GIVEN a 101MB PDF, WHEN uploaded to `/ingest/pdf`, THEN the response is 413

### VAL-03: Query Length Limit
**P1**

The system SHALL reject search queries and RAG questions longer than 10,000 characters SO THAT embedding API abuse is prevented.

Testability Criteria:
- GIVEN a query of 10,001 characters, WHEN `/search` or `/rag/query` is called, THEN the response is 400

### VAL-04: Review Quality Range
**P1**

The system SHALL reject review quality values outside the range [0, 3] WHEN processing review responses SO THAT scheduling calculations remain valid.

Testability Criteria:
- GIVEN quality=4, WHEN `/review/respond` is called, THEN the response is 400 (not 200)
- GIVEN quality=-1, WHEN `/review/respond` is called, THEN the response is 400

### VAL-05: BibTeX Size Limit
**P2**

The system SHALL reject BibTeX import payloads larger than 1MB SO THAT parsing-based resource exhaustion is prevented.

### VAL-06: ArXiv ID Format Validation
**P2**

The system SHALL validate that arXiv IDs match the pattern `\d{4}\.\d{4,5}(v\d+)?` WHEN processing `/ingest/arxiv/{arxiv_id}` SO THAT path traversal via arxiv_id is prevented.

Testability Criteria:
- GIVEN `arxiv_id=../../etc/passwd`, WHEN `/ingest/arxiv/{arxiv_id}` is called, THEN the response is 400
- GIVEN `arxiv_id=2309.15217`, WHEN called, THEN processing proceeds normally

---

## Integration Requirements

### INT-01: MCP Server <-> API Authentication
**P0**

The MCP server SHALL authenticate to the FastAPI backend using either a valid JWT or the dev-mode X-User-Id header WHEN making API calls SO THAT the integration actually functions.

Current state: **BROKEN**. The MCP server sends `user_id` in JSON request bodies and query parameters, but the API extracts user_id from Authorization/X-User-Id headers. This means `search_library`, `add_item`, `add_citation`, and `rag_query` MCP tools will fail with 401 errors when calling the API.

Testability Criteria:
- GIVEN the MCP server is configured with a valid STOA_USER_ID, WHEN `search_library` is called, THEN the API receives proper authentication headers and returns results

Trace: Charter 3A, `server.py:51-63` vs `auth.py:28-54`

### INT-02: Chrome Extension <-> API Authentication
**P1**

The Chrome extension SHALL include proper authentication headers (JWT Bearer token or X-User-Id for dev mode) on all API requests SO THAT backend endpoints accept the requests.

Current state: Partially implemented. `content.js:226-234` includes auth headers, but `service-worker.js:83-88` sends raw data without auth headers. `popup.js:60-80` sends user_id in the message payload but the service worker doesn't add auth headers to the fetch.

Testability Criteria:
- GIVEN a configured extension with stoa_token set, WHEN saving a page, THEN the API request includes `Authorization: Bearer {token}`
- GIVEN a configured extension in dev mode, WHEN saving a highlight, THEN the API request includes `X-User-Id: {user_id}`

Trace: Charter 2A, `service-worker.js:83-88`

### INT-03: Webapp <-> API Authentication
**P1**

The webapp API client SHALL include authentication headers on all requests SO THAT the backend accepts the requests.

Current state: **NOT IMPLEMENTED**. `webapp/src/lib/api.ts` sends `user_id` in request bodies but includes no authentication headers.

Testability Criteria:
- GIVEN an authenticated webapp user, WHEN any API call is made, THEN the request includes a valid Authorization header

Trace: `api.ts:3-15`

---

## Requirement-Test Traceability Matrix

| Requirement | Test Charter(s) | Test Type | Status |
|-------------|-----------------|-----------|--------|
| SEC-01 | 1A | Unit + Integration | Not started |
| SEC-02 | 1A | Unit | Not started |
| SEC-03 | 1A, 5A | Integration | Not started |
| SEC-04 | 1B | Unit + Integration | Not started |
| SEC-05 | 2A | Manual + Unit | Not started |
| SEC-06 | 1B | Integration | Not started |
| SEC-07 | -- | Integration | Not started |
| FUN-01 | 1B | Integration | Not started |
| FUN-02 | 1B | Integration | Not started |
| FUN-03 | 1C, 4A | Unit + Integration | Not started |
| FUN-04 | 4A, 4B | Integration | Not started |
| FUN-05 | 1E | Unit + Integration | Not started |
| FUN-06 | 1E | Unit | Not started |
| FUN-07 | 1D | Unit + Integration | Not started |
| DAT-01 | 5A | Database | Not started |
| DAT-02 | 5A | Database + Integration | Not started |
| DAT-03 | 1B, 5A | Unit + Database | Not started |
| DAT-04 | 4A | Integration | Not started |
| QA-01 | 4A | Evaluation benchmark | Not started |
| QA-02 | 4A | Evaluation benchmark | Not started |
| QA-03 | 4B | Evaluation benchmark | Not started |
| QA-04 | 4B | Evaluation benchmark | Not started |
| QA-05 | 4A | Performance | Not started |
| QA-06 | 1B | Performance | Not started |
| VAL-01 | 1B | Unit | Not started |
| VAL-02 | 1B | Unit | Not started |
| VAL-03 | 1C | Unit | Not started |
| VAL-04 | 1E | Unit | Not started |
| VAL-05 | 1D | Unit | Not started |
| VAL-06 | 1B | Unit | Not started |
| INT-01 | 3A | Integration | Not started |
| INT-02 | 2A | Integration | Not started |
| INT-03 | -- | Integration | Not started |
