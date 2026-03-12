"""Chunking and embedding service using Anthropic's API for embeddings."""

import os
import re
from typing import Optional

import httpx


CHUNK_SIZE = 512
CHUNK_OVERLAP = 64


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks by sentence boundaries."""
    if not text:
        return []

    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = []
    current_len = 0

    for sentence in sentences:
        words = sentence.split()
        sentence_len = len(words)

        if current_len + sentence_len > chunk_size and current_chunk:
            chunks.append(" ".join(current_chunk))
            # Keep overlap
            overlap_words = []
            overlap_count = 0
            for s in reversed(current_chunk):
                s_words = s.split()
                if overlap_count + len(s_words) > overlap:
                    break
                overlap_words.insert(0, s)
                overlap_count += len(s_words)
            current_chunk = overlap_words
            current_len = overlap_count

        current_chunk.append(sentence)
        current_len += sentence_len

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings using OpenAI-compatible API.

    Uses text-embedding-3-small via OpenAI API (cheaper, fast, 1536 dims).
    Falls back to returning zero vectors if no API key is configured.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY not set. Embeddings require an API key. "
            "Set OPENAI_API_KEY in your environment to generate embeddings."
        )

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
                "input": texts,
            },
        )
        data = resp.json()
        return [item["embedding"] for item in data["data"]]


async def chunk_and_embed(text: str, item_id: str, metadata: Optional[dict] = None) -> list[dict]:
    """Chunk text and generate embeddings. Returns list of chunk records."""
    chunks = chunk_text(text)
    if not chunks:
        return []

    embeddings = await embed_texts(chunks)

    records = []
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        records.append({
            "item_id": item_id,
            "chunk_index": i,
            "chunk_text": chunk,
            "embedding": embedding,
            "metadata": metadata or {},
        })

    return records
