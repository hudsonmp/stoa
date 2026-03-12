"""Search endpoint: hybrid vector + full-text with RRF fusion."""

import os
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from services.rag_pipeline import hybrid_search

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    user_id: str
    type: Optional[str] = None
    tags: list[str] = []
    person_id: Optional[str] = None
    limit: int = 20


@router.post("")
async def search(req: SearchRequest):
    """Hybrid search across the user's library."""
    results = await hybrid_search(
        req.query, req.user_id, n=req.limit, type_filter=req.type
    )
    return {"results": results, "count": len(results)}
