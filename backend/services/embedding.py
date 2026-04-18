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


#
# Embedding output-dimension policy
# ──────────────────────────────────
# The database pins two target dimensions:
#     chunks.embedding          vector(1536)   (item-level passage embeddings)
#     note_embeddings.embedding vector(768)    (note-level embeddings)
#
# Historically we used Gemini `text-embedding-004` which returned 768 dims,
# but Google retired that model (returns 404). The current Gemini model
# `gemini-embedding-001` defaults to 3072 dims but supports Matryoshka
# truncation via `outputDimensionality`, so we explicitly ask for the dim
# the target table expects. Call sites therefore pass `target_dim` to pick
# the right payload. Legacy `embed_texts(texts)` defaults to 768 so
# note-embedding call sites stay unchanged.
#

CHUNK_DIM = 1536       # chunks table vector size
NOTE_DIM = 768         # note_embeddings table vector size


async def embed_texts(texts: list[str], target_dim: int = NOTE_DIM) -> list[list[float]]:
    """Generate embeddings matching the caller's target dimension.

    Gemini path (preferred): uses `gemini-embedding-001` with
    `outputDimensionality=target_dim` so the return dim matches the
    destination column without migration.

    OpenAI fallback: uses `text-embedding-3-small` (1536) and truncates
    for 768 callers (OpenAI recommends slicing + renorm for Matryoshka).
    """
    google_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if not google_key and not openai_key:
        raise ValueError("No embedding API key set. Set GOOGLE_API_KEY or OPENAI_API_KEY.")

    all_embeddings: list[list[float]] = []
    async with httpx.AsyncClient(verify=False, timeout=60) as client:
        if google_key:
            # gemini-embedding-001 with Matryoshka-style outputDimensionality
            for text in texts:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={google_key}",
                    json={
                        "model": "models/gemini-embedding-001",
                        "content": {"parts": [{"text": text[:2048]}]},
                        "outputDimensionality": target_dim,
                    },
                )
                if resp.status_code == 200:
                    vec = resp.json()["embedding"]["values"]
                    if len(vec) != target_dim:
                        # Defensive — Gemini normally honours outputDimensionality.
                        vec = vec[:target_dim]
                    all_embeddings.append(vec)
                else:
                    raise RuntimeError(
                        f"Gemini embedding error: {resp.status_code} {resp.text[:200]}"
                    )
        else:
            # OpenAI text-embedding-3-small returns 1536; for NOTE_DIM callers
            # we truncate + renormalize (Matryoshka-compatible).
            import math
            BATCH_SIZE = 100
            for batch_start in range(0, len(texts), BATCH_SIZE):
                batch = texts[batch_start:batch_start + BATCH_SIZE]
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={
                        "model": "text-embedding-3-small",
                        "input": batch,
                        "dimensions": target_dim,
                    },
                )
                if resp.status_code != 200:
                    raise RuntimeError(f"OpenAI embedding error: {resp.status_code}")
                data = resp.json()
                for item in data["data"]:
                    v = item["embedding"]
                    if len(v) != target_dim:
                        v = v[:target_dim]
                        norm = math.sqrt(sum(x * x for x in v)) or 1.0
                        v = [x / norm for x in v]
                    all_embeddings.append(v)
    return all_embeddings


async def chunk_and_embed(text: str, item_id: str, metadata: Optional[dict] = None) -> list[dict]:
    """Chunk text and generate 1536-dim embeddings (chunks table schema)."""
    chunks = chunk_text(text)
    if not chunks:
        return []

    embeddings = await embed_texts(chunks, target_dim=CHUNK_DIM)

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
