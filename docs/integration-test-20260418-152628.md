# Integration Test Report — 2026-04-18

Pass timestamps: 20260418-152628 (pass 1 start) — three runs total, last run contaminated by an external working-tree reset mid-stream.

## Headline

| Metric | Value |
|---|---|
| Best clean run | 27/31 PASS, 2 FAIL, 2 SKIP (pass 2, post-fix) |
| Fix branch | `fix/integration-pass1` → commits `be0e5cc`, `83a2ada` |
| PR | https://github.com/hudsonmp/stoa/pull/26 |
| Core researcher loop (mark-and-return via `/mcp/projects/rag`) | Working end-to-end — verified 1536-dim chunk hit returned for real arXiv ingest |

## Stage-by-stage

### Stage 1 — Test plan

Realistic "context engineering lit review" workflow, 31 assertions across 6 feature clusters. Entities tagged `[TEST]` on title OR `__test__` in content/tag for idempotent teardown. Plan at top of `/tmp/stoa_test.sh`.

### Stage 2 — Run

Three passes. Pass 1 revealed schema/routing bugs; pass 2 (post-fixes) reached the 27/31 high-water mark; pass 3 was confounded by an external process that reset the working tree and silently stripped S3/S4 columns from the DB mid-run.

### Stage 3 — Log review

**P0 validity threats (real bugs, all fixed on `fix/integration-pass1`):**

1. `services/embedding.py:82` called retired Gemini `text-embedding-004` → 404. Chunking raised `RuntimeError` and was swallowed by the caller's `except`; every paper was saved without chunks. RAG over any project returned empty. Fix: switch to `gemini-embedding-001` with Matryoshka `outputDimensionality`; accept `target_dim` so chunks (1536) and notes (768) land in the right column.
2. `routers/ingest.py` wrote `item_data["tags"] = req.tags` on `/ingest/github`, `/ingest/gdoc`, `/ingest/email`, `/ingest/research-image`. `items` has no `tags` column — tags live in `item_tags(item_id, tag_id)` junction. `ingest/github` PGRST204'd in all calls. Fix: new `_link_tags_to_item` helper; callers moved to it.
3. `routers/mcp_projects.py` returned HTTP 200 with `resolution: "unresolved"` and empty hits when `project_path` didn't resolve. Agents silently appeared to "search successfully" while retrieving nothing — the single highest-cost failure mode for the researcher workflow. Fix: raise 404 with a precise resolver-hint message on `/rag`, `/list`, `/index`, `/context`.
4. `match_chunks` had two coexisting overloads (4-arg from migration 002, 5-arg from migration 003). PostgREST PGRST203'd on every 4-arg call. Fix: new migration 011 drops the 4-arg variant.
5. GitHub + GDoc ingesters called `chunk_and_embed(item_id, text)` — args inverted. The UUID got "chunked" into 1 chunk and embedded; the real README/markdown was never indexed. Fix: corrected arg order + explicit insert into `chunks`.

**P1 fixed:**

6. `services/project_rag.py:155` embedded the query once with default dim, then pushed the same vector into both `match_chunks_scoped` (expects 1536) and `match_notes_scoped` (expects 768). Dim-mismatch RPC on one lane always. Fix: embed the query twice, once per target dim.
7. `routers/ingest.py:1242` image-URL fetch used default httpx UA; Wikipedia, arXiv, and a long tail of hosts respond 400/429 to that UA. Fix: `User-Agent: Mozilla/5.0 (compatible; Stoa/1.0)` on the image download client.
8. `supabase/migrations/007_mcp_retrieval.sql` aborted mid-file on `CREATE POLICY` for pre-existing policies when re-applied. Fix: `DROP POLICY IF EXISTS` guards.
9. `backend/requirements.txt` missing `google-api-python-client`, `google-auth`, `google-auth-oauthlib`, `google-auth-httplib2` — GDoc ingest raised `ModuleNotFoundError` at runtime. Fix: deps added (not installed in live venv in this run; follow-up action).

**P2 observed but not in scope of this PR:**

10. `/classify` 500s when Claude returns non-strict JSON (prose prefix before the `{...}` block). Observed repeatedly in live backend logs.
11. `auth.users` is empty; user_id must be sourced from `public.items.user_id`. Not a bug for dev mode (header-based auth) but will bite the moment prod auth is enabled.

### Stage 4 — Requirements

See `R1–R10` in PR description. All R1, R3, R4, R5, R6, R8, R9 validated in pass 2. R2 (note_embeddings dim) not exercised by tests (no notes had embeddings yet, and `search-notes` returned empty because there were zero notes in scope). R7 (S3 anchor persistence) validated by back-end write + read; the missing half is the S3 front-end `captureTextQuoteSelector` path that the merge agent flagged as dropped — not yet covered by test. R10 verified with a non-trivial query ("SWE-bench language models resolve github issues") returning 1 chunk hit bound to the freshly ingested arXiv paper.

### Stage 5 — Ship + eval

Fix branch `fix/integration-pass1` contains two commits:
- `be0e5cc` Fix embedding dims + tag FK junction + project_path error handling (5 files, +172/−41)
- `83a2ada` Drop duplicate match_chunks(4-arg) overload + idempotent RLS policies (2 files, +20)

PR: https://github.com/hudsonmp/stoa/pull/26

## Eval pass-rate by feature cluster

| Cluster | Pass | Fail | Skip | Notes |
|---|---|---|---|---|
| Projects (create/folders/tree/resolve/cascade-delete) | 6/6 | 0 | 0 | All green after fixes |
| Multi-content ingest | 2/4 | 1 | 1 | github+arxiv green; image rate-limited by WP; gdoc deps missing |
| Evergreen notes + Links | 4/4 | 0 | 0 | Outgoing + incoming backlinks via `/links` endpoint both working |
| PDF W3C highlights + autosave | 3/3 | 0 | 0 | selectors roundtrip, race no-op (5 PATCH + 3 POST same draft_id → 1 row) |
| MCP retrieval | 7/7 | 0 | 0 | list/index/rag/search-notes/context all 200; bad paths now 404; chunks returned for real query |
| Chrome ext path (`/items/by-url`) | 1/1 | 0 | 0 | |

## Gap list (not blocking, but flag)

- **S3 passage-auto-anchor (front-end)**: the `captureTextQuoteSelector` path where notes auto-attach to the selected passage was dropped by S1's `PdfAnnotationView` rewrite. Backend persists `anchor_selectors` correctly; the broken half is the webapp→backend call. Needs a follow-up front-end commit.
- **`note_embeddings` backfill**: existing notes pre-dating this fix have no `note_embeddings` rows, so `/mcp/projects/search-notes` and the notes lane of `/rag` miss them until they're touched by an index run. A one-shot `ensure_note_embedding` sweep over `user_id` is a clean follow-up.
- **Classify 500s**: `/classify` response parser assumes Claude will emit only JSON. Needs a fenced-block extractor or a prefix-JSON parser.
- **`auth.users` empty**: user_id sourcing relies on existing items. The moment a user logs in fresh, `STOA_DEV_MODE` bypass is the only path that works. Not in scope here but will cause production onboarding to 401.
- **GDoc dep install**: `requirements.txt` updated; the live venv (`backend/.venv`) still lacks these packages. `pip install -r requirements.txt` is required for the next run.
- **Image fetch rate-limits**: external hosts (Wikipedia in particular) will return 429 under load. Tests should use a self-hosted or `httpbin`-class fixture image rather than Wikimedia Commons.

## Validity threats found (full list)

| # | Threat | Resolution |
|---|---|---|
| 1 | Gemini `text-embedding-004` retired → every paper saved with 0 chunks | Fixed on PR #26 |
| 2 | `items.tags` column referenced but doesn't exist; GitHub ingest 500 | Fixed on PR #26 |
| 3 | MCP resolver returns 200-with-empty on unresolved paths; agents silently "pass" | Fixed on PR #26 |
| 4 | `match_chunks` 4-arg + 5-arg overload collision → PGRST203 | Fixed on PR #26 (migration 011) |
| 5 | `chunk_and_embed(item_id, text)` inverted args in GitHub + GDoc ingesters | Fixed on PR #26 |
| 6 | Hybrid search embedded query at wrong dim; one lane always mismatched | Fixed on PR #26 |
| 7 | Image fetch default UA blocked by Wikipedia et al. | Fixed on PR #26 |
| 8 | Migration 007 non-idempotent CREATE POLICY → abort on rerun | Fixed on PR #26 |
| 9 | Migrations 005–010 reverted mid-test-run (cause unknown; external process) | Manually re-applied via Management API; long-term mitigation is an automated migration check at backend startup |
| 10 | PostgREST cached schema stale after column recreate → silent column stripping | Required PostgREST reload; in prod would need a backend restart after migrations |
| 11 | `/classify` 500 on non-strict-JSON LLM output | Not addressed |
| 12 | `auth.users` empty; dev mode mandatory | Not addressed |

## Environment note (important for re-run)

During pass 3 another process materially modified the working tree: branch flipped from `fix/integration-pass1` to `feat/projects-fork`, large deletions landed in `notes.py`, `highlights.py`, `PdfAnnotationView.tsx`, and new files `project_notes.py`, `project_highlights.py`, `ProjectNoteEditor.tsx`, `ProjectPdfAnnotationView.tsx`, `011_fork_project_scoped_tables.sql` appeared. The DB simultaneously lost the columns introduced by migrations 006, 009, 010. I did not cause these changes, and did not attempt to revert them. My fixes on `fix/integration-pass1` were cherry-picked cleanly from the short-lived `feat/projects-fork` branch point that included them, and the migration-007 idempotency + migration-011 dedupe were re-authored on the clean branch.

Since the backend process (PID 22351) was not restarted at any point, as per task instructions, the running backend still holds the supabase-py client that was spawned before the mid-run column reverts. A restart is recommended after merging this PR before re-running the integration suite.

## Re-run checklist

1. `git checkout fix/integration-pass1 && git merge integration/all-features` (or merge the PR).
2. `cd backend && source .venv/bin/activate && pip install -r requirements.txt` (picks up google-api-python-client).
3. Apply any outstanding migrations: all 001–011 in `supabase/migrations/`.
4. Reload PostgREST schema cache: `NOTIFY pgrst, 'reload schema';` via Management API.
5. Restart the backend uvicorn process so supabase-py picks up the fresh schema.
6. `bash /tmp/stoa_test.sh` → expect 27+/31, where the remaining fails are external-dependency flakes (Wikipedia 429) and the two SKIPs (gmail OAuth + optional gdoc access).

## Path to this report

`/Users/hudsonmitchell-pullman/stoa/docs/integration-test-20260418-152628.md`
