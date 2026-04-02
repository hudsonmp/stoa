import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import ingest, search, rag, citations, review, highlights, items, people, notes, classify

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


@app.get("/health")
async def health():
    return {"status": "ok"}


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
    """Push a writing note to Overleaf as a .tex file in the Active Research project.
    Stoa notes are embedded as %% LaTeX comments."""
    import subprocess, tempfile, os, json
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
    text = _html_to_latex(note.get("content") or "")
    date_str = datetime.now().strftime("%B %Y")

    # Get all notes for this writing (sidebar notes become %% comments)
    all_notes = supabase.table("notes").select("content, title, created_at").eq("user_id", user_id).execute()
    stoa_comments = []
    for n in (all_notes.data or []):
        if n.get("content") and n["content"] != note.get("content"):
            # Check if this note references our writing
            clean = n["content"].replace("<p>", "").replace("</p>", "").replace("<br>", "").strip()
            if clean and len(clean) > 5:
                pass  # Only include notes explicitly linked; skip for now

    # Build .tex with Stoa notes as %% comments
    stoa_header = f"%% Stoa Writing: {title}\n%% Exported: {datetime.now().isoformat()}\n%% Note ID: {note_id}\n"

    tex = f"""{stoa_header}\\documentclass[twocolumn]{{article}}
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

    # Load Overleaf config
    config_path = os.path.expanduser("~/mcp-servers/OverleafMCP/projects.json")
    with open(config_path) as f:
        config = json.load(f)

    # Use "active-research" project as the target
    project = config["projects"].get("active-research")
    if not project:
        return JSONResponse({"error": "No active-research project configured"}, status_code=500)

    project_id = project["projectId"]
    git_token = project["gitToken"]
    safe_filename = title.replace(" ", "_").replace("/", "-")[:40] + ".tex"

    with tempfile.TemporaryDirectory() as tmpdir:
        repo_path = os.path.join(tmpdir, "repo")
        # Clone
        result = subprocess.run(
            ["git", "clone", f"https://git:{git_token}@git.overleaf.com/{project_id}", repo_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return JSONResponse({"error": f"Git clone failed: {result.stderr}"}, status_code=500)

        # Write .tex file
        tex_path = os.path.join(repo_path, safe_filename)
        with open(tex_path, "w") as f:
            f.write(tex)

        # Git add, commit, push
        subprocess.run(["git", "-C", repo_path, "add", safe_filename], capture_output=True)
        subprocess.run(
            ["git", "-C", repo_path, "commit", "-m", f"Add {title} from Stoa"],
            capture_output=True, text=True,
            env={**os.environ, "GIT_AUTHOR_NAME": "Stoa", "GIT_AUTHOR_EMAIL": "stoa@hudsonmp.github.io",
                 "GIT_COMMITTER_NAME": "Stoa", "GIT_COMMITTER_EMAIL": "stoa@hudsonmp.github.io"}
        )
        push_result = subprocess.run(
            ["git", "-C", repo_path, "push"],
            capture_output=True, text=True, timeout=30
        )
        if push_result.returncode != 0:
            return JSONResponse({"error": f"Git push failed: {push_result.stderr}"}, status_code=500)

    overleaf_url = f"https://www.overleaf.com/project/{project_id}"
    return {"success": True, "overleaf_url": overleaf_url, "filename": safe_filename}


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
