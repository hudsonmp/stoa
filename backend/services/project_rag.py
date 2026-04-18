"""Project-scoped retrieval over items + notes.

Design notes
────────────
* Retrieval runs two passes fused with RRF (Cormack 2009): one over item
  chunks (`match_chunks`), one over note embeddings (`match_notes`). Fusion is
  preferable to simple concat because chunks and notes have very different
  similarity distributions — evergreen notes tend to score higher than
  sentence-level chunks because they were written as self-contained claims,
  so naive concat-then-sort merges drown paper passages under notes.

* Every hit returned carries enough provenance for the calling LLM to cite
  without another round trip:
      {kind: "chunk"|"note",
       item_id, chunk_index, chunk_text, page,
       note_id, title, evergreen, tags,
       anchor_selectors (W3C), url, item_type, item_domain,
       similarity}

* Chunk provenance includes `page` when extraction populated chunks.metadata
  with a page number. PDF extraction (feat/pdf-foundation) writes pages into
  metadata; web extraction leaves it null.
"""

from __future__ import annotations

import hashlib
from typing import Optional

from services.auth import get_supabase_service
from services.embedding import embed_texts
from services.rag_pipeline import reciprocal_rank_fusion


# ── vector / text lanes ──────────────────────────────────────────────────────


async def match_chunks_scoped(
    query_embedding: list[float],
    user_id: str,
    item_ids: list[str],
    match_count: int = 20,
    match_threshold: float = 0.3,
) -> list[dict]:
    """Semantic search on chunks restricted to a set of item_ids.

    match_chunks RPC filters by user_id only; we over-fetch then filter by
    item_ids locally. For project-scale corpora (≤ few hundred items) this is
    fine; if it grows we'll add filter_item_ids to the RPC.
    """
    if not item_ids:
        return []
    supabase = get_supabase_service()
    try:
        result = supabase.rpc("match_chunks", {
            "query_embedding": query_embedding,
            "match_threshold": match_threshold,
            "match_count": match_count * 3,
            "filter_user_id": user_id,
        }).execute()
    except Exception:
        return []
    allowed = set(item_ids)
    filtered = [r for r in (result.data or []) if r.get("item_id") in allowed]
    return filtered[:match_count]


async def match_notes_scoped(
    query_embedding: list[float],
    user_id: str,
    note_ids: list[str],
    match_count: int = 20,
    match_threshold: float = 0.3,
    evergreen_only: bool = False,
) -> list[dict]:
    """Semantic search on notes restricted to a set of note_ids."""
    if not note_ids and not evergreen_only:
        return []
    supabase = get_supabase_service()
    params = {
        "query_embedding": query_embedding,
        "match_threshold": match_threshold,
        "match_count": match_count * 2,
        "filter_user_id": user_id,
    }
    if note_ids:
        params["filter_note_ids"] = note_ids
    if evergreen_only:
        params["filter_evergreen"] = True
    try:
        result = supabase.rpc("match_notes", params).execute()
    except Exception:
        return []
    return (result.data or [])[:match_count]


async def notes_full_text_scoped(
    query: str, user_id: str, note_ids: Optional[list[str]] = None, limit: int = 10,
) -> list[dict]:
    """ILIKE fallback on note title + content — approximates BM25 without FTS."""
    if not query or len(query.strip()) < 2:
        return []
    supabase = get_supabase_service()
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"

    q_title = (
        supabase.table("notes")
        .select("id, title, content, evergreen, tags, item_id, updated_at")
        .eq("user_id", user_id)
        .ilike("title", pattern)
    )
    q_content = (
        supabase.table("notes")
        .select("id, title, content, evergreen, tags, item_id, updated_at")
        .eq("user_id", user_id)
        .ilike("content", pattern)
    )
    if note_ids is not None:
        if not note_ids:
            return []
        q_title = q_title.in_("id", note_ids)
        q_content = q_content.in_("id", note_ids)

    title_r = q_title.order("updated_at", desc=True).limit(limit).execute()
    content_r = q_content.order("updated_at", desc=True).limit(limit).execute()

    seen: set[str] = set()
    out: list[dict] = []
    for n in (title_r.data or []) + (content_r.data or []):
        if n["id"] in seen:
            continue
        seen.add(n["id"])
        out.append(n)
    return out[:limit]


# ── hybrid project query ─────────────────────────────────────────────────────


async def project_hybrid_search(
    query: str,
    user_id: str,
    item_ids: list[str],
    note_ids: list[str],
    k: int = 10,
) -> list[dict]:
    """Hybrid retrieval over a project scope. Returns unified hit dicts.

    Lanes: (a) chunk vector, (b) note vector, (c) note text. RRF fuses.
    """
    # Chunks are 1536-dim, notes are 768-dim — we must embed the query twice.
    from services.embedding import CHUNK_DIM, NOTE_DIM

    chunk_query_embedding: list[float] | None = None
    note_query_embedding: list[float] | None = None
    try:
        chunk_query_embedding = (await embed_texts([query], target_dim=CHUNK_DIM))[0]
    except Exception:
        chunk_query_embedding = None
    try:
        note_query_embedding = (await embed_texts([query], target_dim=NOTE_DIM))[0]
    except Exception:
        note_query_embedding = None

    chunk_hits_vec: list[dict] = []
    note_hits_vec: list[dict] = []
    if chunk_query_embedding is not None:
        chunk_hits_vec = await match_chunks_scoped(
            chunk_query_embedding, user_id, item_ids, match_count=k * 2
        )
    if note_query_embedding is not None:
        note_hits_vec = await match_notes_scoped(
            note_query_embedding, user_id, note_ids, match_count=k * 2
        )

    note_hits_text = await notes_full_text_scoped(query, user_id, note_ids, limit=k * 2)

    chunks = [_normalize_chunk(h) for h in chunk_hits_vec]
    notes_vec = [_normalize_note(h, source="vector") for h in note_hits_vec]
    notes_text = [_normalize_note(h, source="text") for h in note_hits_text]

    fused = reciprocal_rank_fusion([chunks, notes_vec, notes_text])
    trimmed = fused[:k]
    _enrich_hits_with_items(trimmed, user_id)
    return trimmed


def _normalize_chunk(hit: dict) -> dict:
    meta = hit.get("metadata") or {}
    return {
        "kind": "chunk",
        "id": hit.get("id") or hit.get("chunk_id"),
        "item_id": hit.get("item_id"),
        "chunk_index": hit.get("chunk_index"),
        "chunk_text": hit.get("chunk_text"),
        "page": meta.get("page"),
        "anchor_selectors": meta.get("selectors"),
        "similarity": hit.get("similarity"),
        "title": hit.get("title"),
        "url": hit.get("url"),
    }


def _normalize_note(hit: dict, source: str) -> dict:
    return {
        "kind": "note",
        "note_id": hit.get("note_id") or hit.get("id"),
        "item_id": hit.get("item_id"),
        "title": hit.get("title"),
        "content": hit.get("content"),
        "evergreen": hit.get("evergreen"),
        "tags": hit.get("tags"),
        "updated_at": hit.get("updated_at"),
        "similarity": hit.get("similarity"),
        "retrieval_source": source,
    }


def _enrich_hits_with_items(hits: list[dict], user_id: str) -> None:
    """Attach url/title/type to hits in-place, one round trip."""
    supabase = get_supabase_service()
    ids = list({h["item_id"] for h in hits if h.get("item_id")})
    if not ids:
        return
    items = (
        supabase.table("items")
        .select("id, title, url, type, domain")
        .eq("user_id", user_id)
        .in_("id", ids)
        .execute()
    )
    by_id = {i["id"]: i for i in (items.data or [])}
    for h in hits:
        iid = h.get("item_id")
        if not iid or iid not in by_id:
            continue
        it = by_id[iid]
        h.setdefault("title", it.get("title"))
        h.setdefault("url", it.get("url"))
        h["item_title"] = it.get("title")
        h["item_type"] = it.get("type")
        h["item_domain"] = it.get("domain")


# ── project content hash (for index cache invalidation) ──────────────────────


def project_content_hash(
    item_ids: list[str],
    note_ids: list[str],
    item_updates: dict[str, str],
    note_updates: dict[str, str],
) -> str:
    """Stable hash over project state. Changes iff any item/note was added,
    removed, or its updated_at moved.
    """
    items_part = "|".join(f"{iid}:{item_updates.get(iid, '')}" for iid in sorted(item_ids))
    notes_part = "|".join(f"{nid}:{note_updates.get(nid, '')}" for nid in sorted(note_ids))
    raw = f"items[{items_part}]notes[{notes_part}]"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── embedding write-through ──────────────────────────────────────────────────


async def ensure_item_chunks(item_id: str, user_id: str) -> int:
    """Embed an item's extracted_text into chunks if not yet chunked.

    Idempotent: if chunks already exist for the item, returns that count.
    Returns number of chunks now present.
    """
    supabase = get_supabase_service()
    existing_count = _chunk_count_for(supabase, item_id)
    if existing_count > 0:
        return existing_count

    item = (
        supabase.table("items")
        .select("id, extracted_text, user_id, metadata")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item.data or not item.data.get("extracted_text"):
        return 0

    from services.embedding import chunk_and_embed  # local import avoids cycles

    records = await chunk_and_embed(
        item.data["extracted_text"],
        item_id,
        metadata=(item.data.get("metadata") or {}),
    )
    if not records:
        return 0
    supabase.table("chunks").insert(records).execute()
    return len(records)


async def ensure_note_embedding(note_id: str, user_id: str) -> bool:
    """Ensure a note has an up-to-date embedding. Returns True if (re)embedded."""
    supabase = get_supabase_service()
    note = (
        supabase.table("notes")
        .select("id, content, title, user_id")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not note.data:
        return False
    text = ((note.data.get("title") or "") + "\n\n" + (note.data.get("content") or "")).strip()
    if not text:
        return False
    new_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    existing = (
        supabase.table("note_embeddings")
        .select("note_id, content_hash")
        .eq("note_id", note_id)
        .limit(1)
        .execute()
    )
    if existing.data and existing.data[0].get("content_hash") == new_hash:
        return False
    from services.embedding import NOTE_DIM
    try:
        vec = (await embed_texts([text[:8000]], target_dim=NOTE_DIM))[0]
    except Exception:
        return False
    row = {
        "note_id": note_id,
        "user_id": user_id,
        "embedding": vec,
        "content_hash": new_hash,
    }
    supabase.table("note_embeddings").upsert(row, on_conflict="note_id").execute()
    return True


def _chunk_count_for(supabase, item_id: str) -> int:
    r = supabase.table("chunks").select("id", count="exact").eq("item_id", item_id).execute()
    return r.count or 0
