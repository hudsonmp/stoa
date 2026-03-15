"""RAG query endpoint."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from services.auth import get_user_id
from services.rag_pipeline import rag_query as do_rag_query

router = APIRouter()


class RAGRequest(BaseModel):
    question: str


@router.post("/query")
async def query(req: RAGRequest, request: Request):
    """Full RAG: retrieve + synthesize answer from the user's knowledge base."""
    user_id = await get_user_id(request)
    result = await do_rag_query(req.question, user_id)
    return result
