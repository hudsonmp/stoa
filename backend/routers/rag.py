"""RAG query endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from services.rag_pipeline import rag_query as do_rag_query

router = APIRouter()


class RAGRequest(BaseModel):
    question: str
    user_id: str


@router.post("/query")
async def query(req: RAGRequest):
    """Full RAG: retrieve + synthesize answer from the user's knowledge base."""
    result = await do_rag_query(req.question, req.user_id)
    return result
