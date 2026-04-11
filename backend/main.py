import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import ingest, search, rag, citations, review, highlights, items, people, notes, classify, social, public

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
app.include_router(public.router, prefix="/public", tags=["public"])


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


def _html_to_latex(html_content: str) -> str:
    """Convert HTML to basic LaTeX."""
    import re
    text = html_content
    text = re.sub(r'<h1[^>]*>(.*?)</h1>', r'\\section{\1}', text)
    text = re.sub(r'<h2[^>]*>(.*?)</h2>', r'\\subsection{\1}', text)
    text = re.sub(r'<h3[^>]*>(.*?)</h3>', r'\\subsubsection{\1}', text)
    text = re.sub(r'<strong>(.*?)</strong>', r'\\textbf{\1}', text)
    text = re.sub(r'<b>(.*?)</b>', r'\\textbf{\1}', text)
    text = re.sub(r'<em>(.*?)</em>', r'\\textit{\1}', text)
    text = re.sub(r'<i>(.*?)</i>', r'\\textit{\1}', text)
    text = re.sub(r'<blockquote[^>]*>(.*?)</blockquote>', r'\\begin{quote}\1\\end{quote}', text, flags=re.DOTALL)
    text = re.sub(r'<li>(.*?)</li>', r'\\item \1', text)
    text = re.sub(r'<ul[^>]*>', r'\\begin{itemize}', text)
    text = re.sub(r'</ul>', r'\\end{itemize}', text)
    text = re.sub(r'<ol[^>]*>', r'\\begin{enumerate}', text)
    text = re.sub(r'</ol>', r'\\end{enumerate}', text)
    text = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', r'\\href{\1}{\2}', text)
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<p[^>]*>(.*?)</p>', r'\1\n\n', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    text = text.strip()
    text = text.replace('&', '\\&').replace('%', '\\%')
    return text


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


@app.post("/writings/{note_id}/push-to-overleaf")
async def push_writing_to_overleaf(note_id: str, request: Request):
    """Push a writing as a .tex file to the Stoa Drafts project on Overleaf.

    Template preserved at 69bf8cd0622169b4534b4a21 (never modified).
    Drafts pushed to 69ce07fa6cda05ae5f8eae42 (has template fonts).
    Each writing = separate .tex file with the template preamble + Stoa notes as %% comments."""
    import subprocess, tempfile, os, json, re
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
    raw_text = re.sub(r'<[^>]+>', '', (note.get("content") or "").replace("<p>", "").replace("</p>", "\n").replace("<br>", "\n")).strip()
    for line in raw_text.split("\n"):
        stripped = line.strip()
        if stripped:
            stoa_lines.append(f"%% {stripped}")
    stoa_lines.append(f"%% {'=' * 50}")
    stoa_comment_block = "\n".join(stoa_lines)

    DRAFTS_PROJECT_ID = "69ce07fa6cda05ae5f8eae42"
    TEMPLATE_PROJECT_ID = "69bf8cd0622169b4534b4a21"

    config_path = os.path.expanduser("~/mcp-servers/OverleafMCP/projects.json")
    with open(config_path) as f:
        config = json.load(f)
    git_token = next((p["gitToken"] for p in config["projects"].values() if p.get("gitToken")), None)
    if not git_token:
        return JSONResponse({"error": "No Overleaf git token"}, status_code=500)

    with tempfile.TemporaryDirectory() as tmpdir:
        drafts_path = os.path.join(tmpdir, "drafts")
        template_path = os.path.join(tmpdir, "template")

        # Clone both projects
        r1 = subprocess.run(
            ["git", "clone", f"https://git:{git_token}@git.overleaf.com/{DRAFTS_PROJECT_ID}", drafts_path],
            capture_output=True, text=True, timeout=30
        )
        r2 = subprocess.run(
            ["git", "clone", f"https://git:{git_token}@git.overleaf.com/{TEMPLATE_PROJECT_ID}", template_path],
            capture_output=True, text=True, timeout=30
        )
        if r1.returncode != 0 or r2.returncode != 0:
            return JSONResponse({"error": "Git clone failed"}, status_code=500)

        # Read template main.tex
        with open(os.path.join(template_path, "main.tex")) as f:
            template_tex = f.read()

        # Fill in template: title, date, body, Stoa comments
        filled = template_tex.replace(
            "\\newcommand{\\soptitle}{TITLE}",
            f"\\newcommand{{\\soptitle}}{{{title}}}"
        ).replace(
            "\\newcommand{\\yourdate}{DATE}",
            f"\\newcommand{{\\yourdate}}{{{date_str}}}"
        ).replace(
            "\\end{document}",
            f"\n{stoa_comment_block}\n\n{body_latex}\n\n\\end{{document}}"
        )

        # Write as new .tex file in drafts project
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', title)[:50] + ".tex"
        tex_path = os.path.join(drafts_path, safe_name)
        with open(tex_path, "w") as f:
            f.write(filled)

        # Git add, commit, push
        git_env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Stoa", "GIT_AUTHOR_EMAIL": "stoa@stoa.app",
            "GIT_COMMITTER_NAME": "Stoa", "GIT_COMMITTER_EMAIL": "stoa@stoa.app",
        }
        subprocess.run(["git", "-C", drafts_path, "add", safe_name], capture_output=True)
        subprocess.run(
            ["git", "-C", drafts_path, "commit", "-m", f"Add: {title}"],
            capture_output=True, text=True, env=git_env
        )
        push_result = subprocess.run(
            ["git", "-C", drafts_path, "push"], capture_output=True, text=True, timeout=30
        )
        if push_result.returncode != 0:
            return JSONResponse({"error": f"Git push failed: {push_result.stderr}"}, status_code=500)

    overleaf_url = f"https://www.overleaf.com/project/{DRAFTS_PROJECT_ID}"
    return {"success": True, "overleaf_url": overleaf_url, "filename": safe_name}


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
