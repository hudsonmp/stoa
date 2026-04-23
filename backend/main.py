import json
import os
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import (
    ingest,
    search,
    rag,
    citations,
    review,
    highlights,
    items,
    people,
    notes,
    classify,
    projects,
    mcp_projects,
    project_notes,
    project_highlights,
    sync,
    ink,
)

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
app.include_router(projects.router, prefix="/projects", tags=["projects"])
app.include_router(mcp_projects.router, prefix="/mcp/projects", tags=["mcp-projects"])
app.include_router(project_notes.router, prefix="/project-notes", tags=["project-notes"])
app.include_router(project_highlights.router, prefix="/project-highlights", tags=["project-highlights"])
app.include_router(sync.router, prefix="/sync", tags=["sync"])
app.include_router(ink.router, prefix="/project-items", tags=["ink"])


@app.on_event("shutdown")
async def _shutdown_sync_engines():
    """Stop all folder-sync watchers before the process exits."""
    try:
        from services.folder_sync import shutdown_all
        shutdown_all()
    except Exception:
        pass


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
    # Project-scoped forks first — cascade-safe chain:
    "project_note_links",
    "project_note_embeddings",
    "project_notes",
    "project_highlights",
    "folder_items",     # must precede folders and items
    "folders",          # must precede projects
    "projects",         # projects.user_id scoped
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


def _get_overleaf_git_token() -> Optional[str]:
    """Git Bridge token from projects.json."""
    try:
        with open(OVERLEAF_CONFIG_PATH) as f:
            config = json.load(f)
        return next(
            (p["gitToken"] for p in config.get("projects", {}).values() if p.get("gitToken")),
            None,
        )
    except (FileNotFoundError, json.JSONDecodeError):
        return None


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
    """Push a writing to Overleaf as a new project — zero config required.

    Uses Overleaf's publisher "Open in Overleaf" feature (snip_uri):
      1. Clone the template project (has fonts, .cls, preamble).
      2. Replace main.tex body with pandoc-converted writing.
      3. Zip the entire project (including fonts/assets).
      4. Upload the zip to Supabase Storage with a 1-hour signed URL.
      5. Return an Overleaf import URL that creates a new project from
         the zip — user clicks and lands in a fresh, fully-compiled
         project.

    Why this approach:
      - No pool of pre-created projects to manage.
      - No session cookies or API keys beyond the existing git token.
      - No manual Overleaf UI work. Each push creates a new project
        automatically via Overleaf's snip_uri import.
      - Template fonts and styling are preserved because the zip
        includes all project files.
    """
    import subprocess, tempfile, re, zipfile, uuid
    from urllib.parse import quote
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

    # Build %% comment block from Stoa notes
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
    # 1. Clone template project (has fonts, .cls, etc.)
    # ------------------------------------------------------------------
    git_token = _get_overleaf_git_token()
    if not git_token:
        return JSONResponse({"error": "No Overleaf git token configured"}, status_code=500)

    with tempfile.TemporaryDirectory() as tmpdir:
        template_path = os.path.join(tmpdir, "template")
        clone = subprocess.run(
            ["git", "clone", f"https://git:{git_token}@git.overleaf.com/{OVERLEAF_TEMPLATE_PROJECT_ID}", template_path],
            capture_output=True, text=True, timeout=30,
        )
        if clone.returncode != 0:
            return JSONResponse(
                {"error": f"Git clone failed: {(clone.stderr or '').strip()}"},
                status_code=500,
            )

        # ------------------------------------------------------------------
        # 2. Replace main.tex body
        # ------------------------------------------------------------------
        main_tex_path = os.path.join(template_path, "main.tex")
        try:
            with open(main_tex_path) as f:
                template_tex = f.read()
        except FileNotFoundError:
            return JSONResponse({"error": "Template has no main.tex"}, status_code=500)

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

        # ------------------------------------------------------------------
        # 3. Zip the entire project (skip .git directory)
        # ------------------------------------------------------------------
        zip_path = os.path.join(tmpdir, "project.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(template_path):
                dirs[:] = [d for d in dirs if d != ".git"]
                for file in files:
                    abs_path = os.path.join(root, file)
                    arc_name = os.path.relpath(abs_path, template_path)
                    zf.write(abs_path, arc_name)

        # ------------------------------------------------------------------
        # 4. Upload to Supabase Storage + get signed URL
        # ------------------------------------------------------------------
        storage_key = f"{user_id}/overleaf-exports/{uuid.uuid4().hex}.zip"
        with open(zip_path, "rb") as f:
            zip_bytes = f.read()

        supabase.storage.from_("documents").upload(
            storage_key,
            zip_bytes,
            file_options={"content-type": "application/zip"},
        )

        signed = supabase.storage.from_("documents").create_signed_url(
            storage_key, expires_in=3600,
        )
        signed_url = signed.get("signedURL") or signed.get("signedUrl") or ""
        if not signed_url:
            return JSONResponse({"error": "Failed to create signed URL"}, status_code=500)

    # ------------------------------------------------------------------
    # 5. Build Overleaf import URL
    # ------------------------------------------------------------------
    safe_title = re.sub(r'[^a-zA-Z0-9 _-]', '', title)[:60].strip() or "Stoa Writing"
    overleaf_url = (
        f"https://www.overleaf.com/docs?snip_uri={quote(signed_url, safe='')}"
        f"&snip_name={quote(safe_title, safe='')}"
    )

    return {
        "success": True,
        "overleaf_url": overleaf_url,
        "filename": "main.tex",
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
