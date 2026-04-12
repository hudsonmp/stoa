import json
import os
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import ingest, search, rag, citations, review, highlights, items, people, notes, classify, social

app = FastAPI(title="Stoa API", version="0.1.0")

# Build CORS origins list: always include local dev + chrome extension
_cors_origins = ["*"]  # Allow all origins — content scripts run in page context
# Add production frontend URL from env (e.g. https://stoa.vercel.app)
_frontend_url = os.getenv("FRONTEND_URL")
if _frontend_url:
    _cors_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router, prefix="/ingest", tags=["ingest"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(rag.router, prefix="/rag", tags=["rag"])
app.include_router(citations.router, prefix="/citations", tags=["citations"])
app.include_router(review.router, prefix="/review", tags=["review"])
app.include_router(highlights.router, prefix="/highlights", tags=["highlights"])
app.include_router(items.router, prefix="/items", tags=["items"])
app.include_router(people.router, prefix="/people", tags=["people"])
app.include_router(notes.router, prefix="/notes", tags=["notes"])
app.include_router(classify.router, prefix="/classify", tags=["classify"])
app.include_router(social.router, prefix="/social", tags=["social"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Test session harness — create/teardown isolated test data
# ---------------------------------------------------------------------------
_test_sessions: dict[str, str] = {}  # session_id -> ISO timestamp

TEST_USER_ID = "5f067d11-b2b8-4efe-84c7-5ac9c5602c9a"

# Tables in FK-safe deletion order
_CLEANUP_TABLES = [
    "collection_items",
    "person_items",
    "highlights",
    "notes",
    "items",
    "people",
]


@app.post("/test/start-session")
async def test_start_session(request: Request):
    """Record a test session start timestamp. All records created after this
    point (for the test user) can be cleaned up via /test/end-session."""
    import uuid
    from datetime import datetime, timezone
    from services.auth import get_supabase_service

    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    _test_sessions[session_id] = now
    return {"session_id": session_id, "started_at": now}


@app.post("/test/end-session")
async def test_end_session(request: Request):
    """Delete all records created after the session start for the test user,
    then remove the session."""
    from fastapi import HTTPException
    from services.auth import get_supabase_service

    body = await request.json()
    session_id = body.get("session_id")
    if not session_id or session_id not in _test_sessions:
        raise HTTPException(status_code=400, detail="Invalid or unknown session_id")

    started_at = _test_sessions.pop(session_id)
    supabase = get_supabase_service()
    deleted: dict[str, int] = {}

    for table in _CLEANUP_TABLES:
        resp = (
            supabase.table(table)
            .delete()
            .gt("created_at", started_at)
            .eq("user_id", TEST_USER_ID)
            .execute()
        )
        deleted[table] = len(resp.data) if resp.data else 0

    return {"session_id": session_id, "started_at": started_at, "deleted": deleted}


_PANDOC_BIN = os.environ.get("PANDOC_BIN", "pandoc")


def _html_to_latex(html_content: str) -> str:
    """HTML → LaTeX via pandoc.

    Replaces the previous hand-rolled regex soup, which processed <li>
    before <p> and so mangled tiptap's <ul><li><p>...</p></li></ul>
    output, dropping bold/italic inside list items and producing
    malformed \\item blocks. Pandoc handles nested lists, tiptap's
    paragraph-wrapped list items, bold-in-italic, code blocks, tables,
    headings beyond h3, and links — every format the user cares about.

    Falls back to stripping HTML tags if pandoc isn't available or
    fails, so a pandoc outage doesn't block the whole push.
    """
    import re
    import subprocess

    if not html_content or not html_content.strip():
        return ""

    try:
        result = subprocess.run(
            [_PANDOC_BIN, "--from", "html", "--to", "latex", "--wrap=preserve"],
            input=html_content,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        import logging as _logging
        _logging.getLogger(__name__).warning("pandoc unavailable: %s", e)
        return re.sub(r"<[^>]+>", "", html_content)

    if result.returncode != 0:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "pandoc HTML→LaTeX failed (code %d): %s",
            result.returncode, (result.stderr or "").strip(),
        )
        return re.sub(r"<[^>]+>", "", html_content)

    return result.stdout


@app.get("/writings/{note_id}/export-tex")
async def export_writing_as_tex(note_id: str, request: Request):
    """Export a writing note as LaTeX."""
    from fastapi.responses import Response
    from services.auth import get_user_id, get_supabase_service
    from datetime import datetime

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    note_res = supabase.table("notes").select("*").eq("id", note_id).eq("user_id", user_id).single().execute()
    if not note_res.data:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Note not found")

    note = note_res.data
    title = note.get("title") or "Untitled"
    text = _html_to_latex(note.get("content") or "")
    date_str = datetime.now().strftime("%B %Y")

    tex = f"""\\documentclass[twocolumn]{{article}}
\\usepackage{{graphicx}}
\\usepackage{{hyperref}}
\\usepackage[compact]{{titlesec}}
\\titlespacing*{{\\subsection}}{{0pt}}{{0.5em plus 0.2em minus 0.1em}}{{0.3em}}
\\begin{{document}}

\\begin{{titlepage}}
    \\centering
    {{\\large Draft\\par}}
    \\vspace{{2cm}}
    {{\\huge\\bfseries {title}\\par}}
    \\vspace{{2cm}}
    {{\\Large Hudson Mitchell-Pullman\\par}}
    \\vspace{{2cm}}
    {{\\large {date_str}\\par}}
\\end{{titlepage}}

{text}

\\end{{document}}
"""
    return Response(content=tex, media_type="application/x-tex", headers={
        "Content-Disposition": f'attachment; filename="{title.replace(" ", "_")}.tex"',
        "Access-Control-Allow-Origin": "*",
    })


OVERLEAF_CONFIG_PATH = os.path.expanduser("~/mcp-servers/OverleafMCP/projects.json")
OVERLEAF_TEMPLATE_PROJECT_ID = "69bf8cd0622169b4534b4a21"


def _load_overleaf_config() -> dict:
    with open(OVERLEAF_CONFIG_PATH) as f:
        return json.load(f)


def _save_overleaf_config(config: dict) -> None:
    """Write projects.json atomically — rename is POSIX-atomic on the same
    filesystem so a crash mid-write can't leave a partially-serialized file."""
    tmp_path = OVERLEAF_CONFIG_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(config, f, indent=2)
    os.replace(tmp_path, OVERLEAF_CONFIG_PATH)


def _get_overleaf_git_token(config: dict) -> Optional[str]:
    """Git Bridge token. Historically stored per-project in projects.json;
    all projects use the same token, so any non-null entry works."""
    pool_token = (config.get("draft_pool") or {}).get("git_token")
    if pool_token:
        return pool_token
    return next(
        (p["gitToken"] for p in config.get("projects", {}).values() if p.get("gitToken")),
        None,
    )


def _claim_pool_project(config: dict) -> Optional[str]:
    """Pop one project ID from draft_pool.available and append to used.
    Returns the ID, or None if the pool is empty. Caller is responsible
    for persisting the mutated config via _save_overleaf_config."""
    pool = config.setdefault("draft_pool", {})
    available = pool.setdefault("available", [])
    used = pool.setdefault("used", [])
    if not available:
        return None
    project_id = available.pop(0)
    used.append(project_id)
    return project_id


def _ensure_ulem_package(tex: str) -> str:
    """Pandoc emits \\ul{} for HTML <u>. That command is only defined by
    the ulem or soul packages. If the template doesn't load one, compile
    fails on any underlined text. Inject \\usepackage{ulem} before
    \\begin{document} as a defensive no-op when already present."""
    if "\\usepackage{ulem}" in tex or "\\usepackage[normalem]{ulem}" in tex:
        return tex
    return tex.replace(
        "\\begin{document}",
        "\\usepackage[normalem]{ulem}\n\\begin{document}",
        1,
    )


@app.post("/writings/{note_id}/push-to-overleaf")
async def push_writing_to_overleaf(note_id: str, request: Request):
    """Push a writing as its OWN Overleaf project — one writing, one project.

    Why per-writing projects instead of a shared drafts project:
      Overleaf's web UI decides which file to open on project load via
      its own "most recently opened" heuristic, independent of git
      state. Pushing a new file to a shared project and then navigating
      to that project's URL lands the user on whichever file THEY
      touched most recently, not the one we just pushed. The only
      robust fix is to stop sharing a project.

    How the pool works:
      Overleaf Git Bridge can clone/push EXISTING projects but not
      create new ones — that endpoint requires a browser session
      cookie we don't have. Workaround: Hudson pre-creates a pool of
      empty projects in the Overleaf UI (copies of the template), adds
      their IDs to projects.json under draft_pool.available. Each push
      pops one, pushes the writing into it, moves the ID to
      draft_pool.used. When the pool runs low, the endpoint returns a
      503 telling Hudson to refill.

    What each push does:
      1. Load projects.json, pop an available project ID.
      2. Git-clone that project (already a template copy, has fonts +
         preamble).
      3. Read main.tex, substitute title/date/body placeholders with
         the pandoc-converted writing body.
      4. Inject \\usepackage{ulem} if missing so pandoc's \\ul{} doesn't
         break compilation.
      5. Commit + push.
      6. Return the URL to the new per-writing project.
    """
    import subprocess, tempfile, re
    from fastapi.responses import JSONResponse
    from services.auth import get_user_id, get_supabase_service
    from datetime import datetime

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    note_res = supabase.table("notes").select("*").eq("id", note_id).eq("user_id", user_id).single().execute()
    if not note_res.data:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Note not found")

    note = note_res.data
    title = note.get("title") or "Untitled"
    body_latex = _html_to_latex(note.get("content") or "")
    date_str = datetime.now().strftime("%B %d, %Y")

    # Build %% comment block from Stoa notes (raw text, unwrapped, for reader reference)
    stoa_lines = [
        f"%% {'=' * 50}",
        f"%% Stoa Writing: {title}",
        f"%% Exported: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"%% Note ID: {note_id}",
        f"%% {'=' * 50}",
    ]
    raw_text = re.sub(
        r'<[^>]+>',
        '',
        (note.get("content") or "").replace("<p>", "").replace("</p>", "\n").replace("<br>", "\n"),
    ).strip()
    for line in raw_text.split("\n"):
        stripped = line.strip()
        if stripped:
            stoa_lines.append(f"%% {stripped}")
    stoa_lines.append(f"%% {'=' * 50}")
    stoa_comment_block = "\n".join(stoa_lines)

    # ------------------------------------------------------------------
    # Claim a pool project
    # ------------------------------------------------------------------
    config = _load_overleaf_config()
    git_token = _get_overleaf_git_token(config)
    if not git_token:
        return JSONResponse({"error": "No Overleaf git token configured"}, status_code=500)

    project_id = _claim_pool_project(config)
    if project_id is None:
        return JSONResponse(
            {
                "error": "Overleaf draft pool is empty",
                "how_to_refill": (
                    "Copy the template project "
                    f"(https://www.overleaf.com/project/{OVERLEAF_TEMPLATE_PROJECT_ID}) "
                    "in the Overleaf UI — one copy per expected writing, 10–20 at a time. "
                    "For each copy, open Menu → Sync → Git and copy the project ID from the URL. "
                    "Append each ID to draft_pool.available in "
                    f"{OVERLEAF_CONFIG_PATH}."
                ),
            },
            status_code=503,
        )

    # Persist the claim BEFORE we try to clone/push. If the clone fails the
    # project is still marked used — that's intentional (the user can
    # manually reclaim it). Safer than leaving a claim un-persisted and
    # racing a concurrent push into the same project.
    try:
        _save_overleaf_config(config)
    except OSError as e:
        return JSONResponse({"error": f"Failed to persist pool state: {e}"}, status_code=500)

    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = os.path.join(tmpdir, "writing")

        clone = subprocess.run(
            ["git", "clone", f"https://git:{git_token}@git.overleaf.com/{project_id}", project_path],
            capture_output=True, text=True, timeout=30,
        )
        if clone.returncode != 0:
            return JSONResponse(
                {"error": f"Git clone failed: {(clone.stderr or '').strip()}"},
                status_code=500,
            )

        # Load main.tex from the cloned project (it's a copy of the
        # template, so placeholders are present).
        main_tex_path = os.path.join(project_path, "main.tex")
        try:
            with open(main_tex_path) as f:
                template_tex = f.read()
        except FileNotFoundError:
            return JSONResponse(
                {"error": f"Pool project {project_id} has no main.tex — is it a template copy?"},
                status_code=500,
            )

        filled = template_tex.replace(
            "\\newcommand{\\soptitle}{TITLE}",
            f"\\newcommand{{\\soptitle}}{{{title}}}",
        ).replace(
            "\\newcommand{\\yourdate}{DATE}",
            f"\\newcommand{{\\yourdate}}{{{date_str}}}",
        ).replace(
            "\\end{document}",
            f"\n{stoa_comment_block}\n\n{body_latex}\n\n\\end{{document}}",
        )
        filled = _ensure_ulem_package(filled)

        with open(main_tex_path, "w") as f:
            f.write(filled)

        git_env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Stoa", "GIT_AUTHOR_EMAIL": "stoa@stoa.app",
            "GIT_COMMITTER_NAME": "Stoa", "GIT_COMMITTER_EMAIL": "stoa@stoa.app",
        }
        subprocess.run(["git", "-C", project_path, "add", "main.tex"], capture_output=True)
        subprocess.run(
            ["git", "-C", project_path, "commit", "-m", f"Stoa push: {title}"],
            capture_output=True, text=True, env=git_env,
        )
        push_result = subprocess.run(
            ["git", "-C", project_path, "push"],
            capture_output=True, text=True, timeout=30,
        )
        if push_result.returncode != 0:
            return JSONResponse(
                {"error": f"Git push failed: {(push_result.stderr or '').strip()}"},
                status_code=500,
            )

    overleaf_url = f"https://www.overleaf.com/project/{project_id}"
    pool_remaining = len(config.get("draft_pool", {}).get("available", []))
    return {
        "success": True,
        "overleaf_url": overleaf_url,
        "project_id": project_id,
        "filename": "main.tex",
        "pool_remaining": pool_remaining,
        "pool_warning": (
            "Pool running low — refill soon" if pool_remaining <= 3 else None
        ),
    }


@app.get("/proxy/pdf")
async def proxy_pdf(url: str):
    """Proxy external PDFs to avoid CORS issues in the browser PDF viewer."""
    import httpx
    from fastapi.responses import Response

    # Only allow PDF URLs from known domains
    allowed = ["arxiv.org", "openreview.net", "aclanthology.org", "dl.acm.org",
               "proceedings.mlr.press", "papers.nips.cc"]
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""
    if not any(host.endswith(d) for d in allowed) and not url.endswith(".pdf"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="URL not allowed for proxying")

    async with httpx.AsyncClient(verify=False, timeout=60, follow_redirects=True) as client:
        resp = await client.get(url)
        return Response(
            content=resp.content,
            media_type="application/pdf",
            headers={"Cache-Control": "public, max-age=3600"},
        )
