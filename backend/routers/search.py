"""Search endpoint: hybrid vector + full-text with RRF fusion."""

from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from services.auth import get_user_id
from services.rag_pipeline import hybrid_search

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    type: Optional[str] = None
    tags: list[str] = []
    person_id: Optional[str] = None
    limit: int = 20


@router.post("")
async def search(req: SearchRequest, request: Request):
    """Hybrid search across the user's library."""
    user_id = await get_user_id(request)
    results = await hybrid_search(
        req.query, user_id, n=req.limit, type_filter=req.type
    )
    return {"results": results, "count": len(results)}
