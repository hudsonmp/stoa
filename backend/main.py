import os

from fastapi import FastAPI
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
