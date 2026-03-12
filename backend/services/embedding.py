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

        # Hard split: if a single "sentence" exceeds chunk_size (e.g. code blocks),
        # break it into word-level chunks
        if sentence_len > chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_len = 0
            for i in range(0, sentence_len, chunk_size - overlap):
                chunk_words = words[i:i + chunk_size]
                chunks.append(" ".join(chunk_words))
            continue

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

    # Batch to avoid hitting OpenAI's per-request limits
    BATCH_SIZE = 100
    all_embeddings = []
    async with httpx.AsyncClient(timeout=60) as client:
      for batch_start in range(0, len(texts), BATCH_SIZE):
        batch = texts[batch_start:batch_start + BATCH_SIZE]
        resp = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
                "input": batch,
            },
        )
        if resp.status_code != 200:
            error_body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            error_msg = error_body.get("error", {}).get("message", f"HTTP {resp.status_code}")
            raise RuntimeError(f"OpenAI embedding API error: {error_msg}")
        data = resp.json()
        all_embeddings.extend([item["embedding"] for item in data["data"]])
    return all_embeddings


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
