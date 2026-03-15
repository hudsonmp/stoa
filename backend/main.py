from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import ingest, search, rag, citations, review, items

app = FastAPI(title="Stoa API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "chrome-extension://*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router, prefix="/ingest", tags=["ingest"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(rag.router, prefix="/rag", tags=["rag"])
app.include_router(citations.router, prefix="/citations", tags=["citations"])
app.include_router(review.router, prefix="/review", tags=["review"])
app.include_router(items.router, prefix="/items", tags=["items"])


@app.get("/health")
async def health():
    return {"status": "ok"}
