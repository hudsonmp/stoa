"""Iterative RAG pipeline: decompose → retrieve → gap check → synthesize."""

import os
from typing import Optional

import anthropic
import httpx
from supabase import create_client

from services.embedding import embed_texts


def get_supabase():
    return create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY"),
    )


async def vector_search(query: str, user_id: str, n: int = 10, type_filter: Optional[str] = None) -> list[dict]:
    """Search chunks by embedding similarity."""
    embeddings = await embed_texts([query])
    query_embedding = embeddings[0]

    supabase = get_supabase()

    # Use Supabase RPC for vector similarity search
    result = supabase.rpc(
        "match_chunks",
        {
            "query_embedding": query_embedding,
            "match_threshold": 0.5,
            "match_count": n,
            "filter_user_id": user_id,
        },
    ).execute()

    return result.data or []


async def full_text_search(query: str, user_id: str, n: int = 10) -> list[dict]:
    """Full-text search on items."""
    supabase = get_supabase()
    result = (
        supabase.table("items")
        .select("id, title, url, type, extracted_text, domain")
        .eq("user_id", user_id)
        .or_(f"title.ilike.%{query}%,extracted_text.ilike.%{query}%")
        .limit(n)
        .execute()
    )
    return result.data or []


def reciprocal_rank_fusion(results_lists: list[list[dict]], k: int = 60) -> list[dict]:
    """Combine multiple ranked lists using RRF."""
    scores: dict[str, float] = {}
    docs: dict[str, dict] = {}

    for results in results_lists:
        for rank, doc in enumerate(results):
            doc_id = doc.get("id") or doc.get("item_id", str(rank))
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + rank + 1)
            docs[doc_id] = doc

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [docs[doc_id] for doc_id in sorted_ids]


async def hybrid_search(query: str, user_id: str, n: int = 10, type_filter: Optional[str] = None) -> list[dict]:
    """Hybrid search combining vector and full-text, fused with RRF."""
    vector_results = await vector_search(query, user_id, n=n * 2, type_filter=type_filter)
    text_results = await full_text_search(query, user_id, n=n * 2)
    fused = reciprocal_rank_fusion([vector_results, text_results])
    return fused[:n]


async def rag_query(question: str, user_id: str) -> dict:
    """Full RAG: retrieve relevant context, then synthesize an answer."""
    # Step 1: Retrieve
    results = await hybrid_search(question, user_id, n=8)

    # Step 2: Build context
    context_parts = []
    sources = []
    for r in results:
        text = r.get("chunk_text") or r.get("extracted_text", "")[:1000]
        title = r.get("title", "Unknown")
        url = r.get("url", "")
        context_parts.append(f"[{title}] {text}")
        sources.append({"title": title, "url": url, "id": r.get("id") or r.get("item_id")})

    context = "\n\n---\n\n".join(context_parts)

    # Step 3: Synthesize with Claude
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "answer": "No API key configured. Retrieved context:\n\n" + context[:2000],
            "sources": sources,
        }

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="You are a research assistant for a personal knowledge base called Stoa. "
               "Answer questions using ONLY the provided context from the user's saved items. "
               "Cite sources by title. If the context doesn't contain enough information, say so.",
        messages=[
            {
                "role": "user",
                "content": f"Context from my library:\n\n{context}\n\n---\n\nQuestion: {question}",
            }
        ],
    )

    return {
        "answer": response.content[0].text,
        "sources": sources,
    }
