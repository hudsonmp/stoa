"""Iterative RAG pipeline: decompose → retrieve → gap check → synthesize."""

import os
from typing import Optional

import anthropic

from services.auth import get_supabase_service
from services.embedding import embed_texts


async def vector_search(query: str, user_id: str, n: int = 10, type_filter: Optional[str] = None) -> list[dict]:
    """Search chunks by embedding similarity."""
    embeddings = await embed_texts([query])
    query_embedding = embeddings[0]

    supabase = get_supabase_service()

    params = {
        "query_embedding": query_embedding,
        "match_threshold": 0.5,
        "match_count": n,
        "filter_user_id": user_id,
    }
    if type_filter:
        params["filter_type"] = type_filter

    result = supabase.rpc("match_chunks", params).execute()
    return result.data or []


def _escape_ilike(value: str) -> str:
    """Escape ILIKE special characters so user input is treated literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def full_text_search(query: str, user_id: str, n: int = 10, type_filter: Optional[str] = None) -> list[dict]:
    """Full-text search on items. Uses separate queries to avoid filter injection."""
    supabase = get_supabase_service()
    escaped = _escape_ilike(query)

    def build_query():
        q = (
            supabase.table("items")
            .select("id, title, url, type, extracted_text, domain")
            .eq("user_id", user_id)
        )
        if type_filter:
            q = q.eq("type", type_filter)
        return q

    title_results = build_query().ilike("title", f"%{escaped}%").limit(n).execute()
    text_results = build_query().ilike("extracted_text", f"%{escaped}%").limit(n).execute()

    # Merge and deduplicate
    seen = set()
    results = []
    for item in (title_results.data or []) + (text_results.data or []):
        if item["id"] not in seen:
            seen.add(item["id"])
            results.append(item)

    return results[:n]


def reciprocal_rank_fusion(results_lists: list[list[dict]], k: int = 60) -> list[dict]:
    """Combine multiple ranked lists using RRF.

    Normalizes to item_id so vector search (chunk-level) and full-text search
    (item-level) results are properly deduplicated.
    """
    scores: dict[str, float] = {}
    docs: dict[str, dict] = {}

    for results in results_lists:
        for rank, doc in enumerate(results):
            # Normalize: vector results have item_id, full-text results have id
            doc_id = doc.get("item_id") or doc.get("id", str(rank))
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + rank + 1)
            if doc_id not in docs:
                docs[doc_id] = doc

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [docs[doc_id] for doc_id in sorted_ids]


async def hybrid_search(query: str, user_id: str, n: int = 10, type_filter: Optional[str] = None) -> list[dict]:
    """Hybrid search combining vector and full-text, fused with RRF."""
    vector_results = await vector_search(query, user_id, n=n * 2, type_filter=type_filter)
    text_results = await full_text_search(query, user_id, n=n * 2, type_filter=type_filter)
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
