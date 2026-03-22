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
    """Generate embeddings using Google Gemini API (free tier).

    Uses text-embedding-004 (768 dims). Falls back to OpenAI if
    GOOGLE_API_KEY not set but OPENAI_API_KEY is.
    """
    google_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if not google_key and not openai_key:
        raise ValueError("No embedding API key set. Set GOOGLE_API_KEY or OPENAI_API_KEY.")

    all_embeddings = []
    async with httpx.AsyncClient(verify=False, timeout=60) as client:
        if google_key:
            # Google Gemini embedding API (free, 768 dims)
            for text in texts:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={google_key}",
                    json={
                        "model": "models/text-embedding-004",
                        "content": {"parts": [{"text": text[:2048]}]},
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    all_embeddings.append(data["embedding"]["values"])
                else:
                    raise RuntimeError(f"Gemini embedding error: {resp.status_code} {resp.text[:200]}")
        else:
            # Fallback: OpenAI
            BATCH_SIZE = 100
            for batch_start in range(0, len(texts), BATCH_SIZE):
                batch = texts[batch_start:batch_start + BATCH_SIZE]
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={"model": "text-embedding-3-small", "input": batch},
                )
                if resp.status_code != 200:
                    raise RuntimeError(f"OpenAI embedding error: {resp.status_code}")
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
