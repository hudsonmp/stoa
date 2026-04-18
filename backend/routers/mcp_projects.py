"""MCP retrieval endpoints — project-scoped RAG, indexing, context payload.

Namespace: /mcp/projects
These are distinct from the `/projects` router (CRUD for projects & folders).
Every endpoint here is additive and agent-facing.

Endpoints
─────────
  POST /mcp/projects/rag             — RAG over a project
  POST /mcp/projects/search-notes    — hybrid note search, optional project scope
  POST /mcp/projects/index           — (re)embed project contents
  GET  /mcp/projects/list            — folder tree + item/note summary
  POST /mcp/projects/context         — cache-friendly context payload (for
                                       agent system-prompt prefix)
  POST /mcp/projects/extract-refs    — DOI/arXiv refs extracted from a paper
  POST /mcp/projects/save            — ingest + attach an item
  POST /mcp/projects/annotate        — agent-sourced highlights + notes
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import os
import re
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.auth import get_supabase_service, get_user_id
from services.project_path import (
    normalize_path,
    resolve_project_path,
)
from services.project_rag import (
    ensure_item_chunks,
    ensure_note_embedding,
    match_notes_scoped,
    notes_full_text_scoped,
    project_content_hash,
    project_hybrid_search,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ── request models ──────────────────────────────────────────────────────────


class RAGOverProjectRequest(BaseModel):
    project_path: str
    query: str
    k: int = 10


class SearchNotesRequest(BaseModel):
    query: str
    evergreen_only: bool = False
    project_path: Optional[str] = None
    limit: int = 20


class IndexProjectRequest(BaseModel):
    project_path: str
    force: bool = False


class ExtractReferencesRequest(BaseModel):
    item_id: str
    max_refs: int = 40


class SaveToProjectRequest(BaseModel):
    project_path: str
    item_ref: str               # URL | arXiv ID | DOI
    folder_subpath: str = ""    # relative to project root


class AgentHighlight(BaseModel):
    text: str
    color: str = Field(default="yellow", pattern="^(yellow|green|blue|pink|purple)$")
    note: Optional[str] = None
    selectors: Optional[Any] = None   # W3C Web Annotation list


class AgentNote(BaseModel):
    content: str
    title: Optional[str] = None
    evergreen: bool = False
    tags: list[str] = []
    anchor_selectors: Optional[Any] = None
    mention_item_ids: list[str] = []
    mention_note_ids: list[str] = []
    mention_person_ids: list[str] = []


class AnnotateOnBehalfRequest(BaseModel):
    item_id: str
    agent_id: str              # e.g. "claude-code-lit-review-2026-04-18T12:00:00Z"
    highlights: list[AgentHighlight] = []
    notes: list[AgentNote] = []


class GetProjectContextRequest(BaseModel):
    project_path: str
    max_tokens: int = 100_000


# ── 1. rag_over_project ─────────────────────────────────────────────────────


@router.post("/rag")
async def rag_over_project(req: RAGOverProjectRequest, request: Request):
    user_id = await get_user_id(request)
    scope = await resolve_project_path(req.project_path, user_id)

    # Fail loudly when the path cannot be resolved: silently returning 200
    # with empty hits lets agents believe they searched successfully when
    # they never did. This is the core research-workflow failure mode.
    if scope["resolution"] == "unresolved":
        raise HTTPException(
            status_code=404,
            detail=(
                f"project_path {req.project_path!r} did not resolve — normalized to "
                f"{scope['path_key']!r}. Use `/projects/<slug>[/<folder>]` where "
                f"<slug> is the slugified project name."
            ),
        )

    hits = await project_hybrid_search(
        query=req.query,
        user_id=user_id,
        item_ids=scope["item_ids"],
        note_ids=scope["note_ids"],
        k=req.k,
    )
    return {
        "path_key": scope["path_key"],
        "resolution": scope["resolution"],
        "project_name": scope["project_name"],
        "k": req.k,
        "hits": hits,
        "scope": {
            "item_count": len(scope["item_ids"]),
            "note_count": len(scope["note_ids"]),
        },
    }


# ── 2. search_notes (hybrid, project-optional) ───────────────────────────────


@router.post("/search-notes")
async def search_notes_scoped_endpoint(req: SearchNotesRequest, request: Request):
    user_id = await get_user_id(request)

    note_ids: Optional[list[str]] = None
    if req.project_path:
        scope = await resolve_project_path(req.project_path, user_id)
        note_ids = scope["note_ids"]
        if not note_ids:
            return {"notes": [], "count": 0, "path_key": scope["path_key"]}

    text_hits = await notes_full_text_scoped(req.query, user_id, note_ids, limit=req.limit)

    try:
        from services.embedding import embed_texts, NOTE_DIM
        vec = (await embed_texts([req.query], target_dim=NOTE_DIM))[0]
        vec_hits = await match_notes_scoped(
            vec, user_id, note_ids or [], match_count=req.limit,
            evergreen_only=req.evergreen_only,
        )
    except Exception:
        vec_hits = []

    seen: set[str] = set()
    merged: list[dict] = []
    for source_name, arr in (("vector", vec_hits), ("text", text_hits)):
        for h in arr:
            nid = h.get("note_id") or h.get("id")
            if not nid or nid in seen:
                continue
            if req.evergreen_only and not h.get("evergreen"):
                continue
            seen.add(nid)
            merged.append({**h, "retrieval_source": source_name})

    enriched = _attach_note_links(merged, user_id)
    return {"notes": enriched[: req.limit], "count": len(enriched[: req.limit])}


def _attach_note_links(notes: list[dict], user_id: str) -> list[dict]:
    supabase = get_supabase_service()
    ids = [n.get("note_id") or n.get("id") for n in notes]
    ids = [i for i in ids if i]
    if not ids:
        return notes
    try:
        out_links = (
            supabase.table("note_links")
            .select("source_note_id, target_ref_type, target_ref_id")
            .in_("source_note_id", ids)
            .execute()
        )
        in_links = (
            supabase.table("note_links")
            .select("source_note_id, target_ref_type, target_ref_id")
            .in_("target_ref_id", ids)
            .eq("target_ref_type", "note")
            .execute()
        )
    except Exception:
        return notes
    out_by_src: dict[str, list] = {}
    in_by_tgt: dict[str, list] = {}
    for r in (out_links.data or []):
        out_by_src.setdefault(r["source_note_id"], []).append(r)
    for r in (in_links.data or []):
        in_by_tgt.setdefault(r["target_ref_id"], []).append(r)
    for n in notes:
        nid = n.get("note_id") or n.get("id")
        n["outgoing_links"] = out_by_src.get(nid, [])
        n["incoming_links"] = in_by_tgt.get(nid, [])
    return notes


# ── 3. index_project ────────────────────────────────────────────────────────


@router.post("/index")
async def index_project(req: IndexProjectRequest, request: Request):
    user_id = await get_user_id(request)
    scope = await resolve_project_path(req.project_path, user_id)
    if scope["resolution"] == "unresolved":
        raise HTTPException(
            status_code=404,
            detail=(
                f"project_path {req.project_path!r} did not resolve — normalized to "
                f"{scope['path_key']!r}. Use `/projects/<slug>[/<folder>]`."
            ),
        )
    supabase = get_supabase_service()

    # Gather updated_at for hash
    item_updates: dict[str, str] = {}
    if scope["item_ids"]:
        # Items don't have updated_at by default; fall back to created_at
        try:
            meta = (
                supabase.table("items")
                .select("id, created_at")
                .in_("id", scope["item_ids"])
                .execute()
            )
            item_updates = {i["id"]: i.get("created_at") or "" for i in (meta.data or [])}
        except Exception:
            item_updates = {iid: "" for iid in scope["item_ids"]}
    note_updates: dict[str, str] = {}
    if scope["note_ids"]:
        meta = (
            supabase.table("notes")
            .select("id, updated_at")
            .in_("id", scope["note_ids"])
            .execute()
        )
        note_updates = {n["id"]: n.get("updated_at") or "" for n in (meta.data or [])}

    content_hash = project_content_hash(
        scope["item_ids"], scope["note_ids"], item_updates, note_updates
    )

    existing = (
        supabase.table("project_indexes")
        .select("*")
        .eq("user_id", user_id)
        .eq("path_key", scope["path_key"])
        .limit(1)
        .execute()
    )
    existing_row = existing.data[0] if existing.data else None
    changed = (
        existing_row is None
        or existing_row.get("content_hash") != content_hash
        or req.force
    )

    total_chunk_count = 0
    new_chunks_added = 0
    notes_embedded = 0

    if changed:
        for iid in scope["item_ids"]:
            try:
                before = _chunk_count_for(supabase, iid)
                after = await ensure_item_chunks(iid, user_id)
                total_chunk_count += after
                if after > before:
                    new_chunks_added += (after - before)
            except Exception as exc:
                logger.warning("Chunking %s failed: %s", iid, exc)

        for nid in scope["note_ids"]:
            try:
                did = await ensure_note_embedding(nid, user_id)
                if did:
                    notes_embedded += 1
            except Exception as exc:
                logger.warning("Embedding note %s failed: %s", nid, exc)
    else:
        # Return previously-seen count without re-walking chunks
        total_chunk_count = existing_row.get("chunk_count", 0)

    row = {
        "user_id": user_id,
        "folder_id": scope.get("folder_id"),
        "collection_id": scope.get("collection_id"),
        "path_key": scope["path_key"],
        "content_hash": content_hash,
        "chunk_count": total_chunk_count,
        "item_count": len(scope["item_ids"]),
        "note_count": len(scope["note_ids"]),
        "last_indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase.table("project_indexes").upsert(row, on_conflict="user_id,path_key").execute()
    except Exception as exc:
        logger.warning("project_indexes upsert failed: %s", exc)

    return {
        "path_key": scope["path_key"],
        "resolution": scope["resolution"],
        "indexed_at": row["last_indexed_at"],
        "content_hash": content_hash,
        "changed_since_last": changed,
        "chunk_count": total_chunk_count,
        "new_chunks_added": new_chunks_added,
        "notes_embedded": notes_embedded,
        "item_count": row["item_count"],
        "note_count": row["note_count"],
    }


def _chunk_count_for(supabase, item_id: str) -> int:
    r = supabase.table("chunks").select("id", count="exact").eq("item_id", item_id).execute()
    return r.count or 0


# ── 4. list_project ─────────────────────────────────────────────────────────


@router.get("/list")
async def list_project(request: Request, project_path: str):
    user_id = await get_user_id(request)
    scope = await resolve_project_path(project_path, user_id)
    if scope["resolution"] == "unresolved":
        raise HTTPException(
            status_code=404,
            detail=(
                f"project_path {project_path!r} did not resolve — normalized to "
                f"{scope['path_key']!r}. Use `/projects/<slug>[/<folder>]`."
            ),
        )
    supabase = get_supabase_service()

    items: list[dict] = []
    if scope["item_ids"]:
        res = (
            supabase.table("items")
            .select("id, title, url, type, domain, reading_status, created_at, summary")
            .eq("user_id", user_id)
            .in_("id", scope["item_ids"])
            .order("created_at", desc=True)
            .execute()
        )
        items = res.data or []

    notes: list[dict] = []
    if scope["note_ids"]:
        res = (
            supabase.table("notes")
            .select("id, title, evergreen, tags, item_id, updated_at, created_at")
            .eq("user_id", user_id)
            .in_("id", scope["note_ids"])
            .order("updated_at", desc=True)
            .execute()
        )
        notes = res.data or []

    return {
        "path_key": scope["path_key"],
        "resolution": scope["resolution"],
        "project_name": scope["project_name"],
        "project_id": scope["project_id"],
        "folder_tree": scope["folder_tree"],
        "items": items,
        "notes": notes,
        "stats": {"items": len(items), "notes": len(notes)},
    }


# ── 5. get_project_context ──────────────────────────────────────────────────


_AVG_CHARS_PER_TOKEN = 4  # conservative english prose average


@router.post("/context")
async def get_project_context(req: GetProjectContextRequest, request: Request):
    """Return a compact, cache-friendly project representation.

    Intended to be placed verbatim as the first `system` content block with
    `cache_control: {type: "ephemeral"}` on the caller's Anthropic API call.
    The returned `context_version` is a hash over the project state; when the
    agent sees it change, it should invalidate its cached prefix.
    """
    user_id = await get_user_id(request)
    scope = await resolve_project_path(req.project_path, user_id)
    if scope["resolution"] == "unresolved":
        raise HTTPException(
            status_code=404,
            detail=(
                f"project_path {req.project_path!r} did not resolve — normalized to "
                f"{scope['path_key']!r}. Use `/projects/<slug>[/<folder>]`."
            ),
        )
    supabase = get_supabase_service()

    # Project description
    project_description = ""
    if scope["resolution"] == "folder" and scope["project_id"]:
        try:
            p = (
                supabase.table("projects")
                .select("description")
                .eq("id", scope["project_id"])
                .single()
                .execute()
            )
            project_description = (p.data or {}).get("description") or ""
        except Exception:
            project_description = ""
    elif scope["resolution"] == "collection" and scope["folder_tree"]:
        project_description = scope["folder_tree"][0].get("description", "")

    # Items + citations + top highlights
    items: list[dict] = []
    if scope["item_ids"]:
        items_res = (
            supabase.table("items")
            .select("id, title, url, type, domain, summary, created_at")
            .eq("user_id", user_id)
            .in_("id", scope["item_ids"])
            .order("created_at", desc=True)
            .execute()
        )
        items = items_res.data or []

    citations_by_item: dict[str, dict] = {}
    if items:
        cits = (
            supabase.table("citations")
            .select("item_id, authors, year, venue, abstract")
            .in_("item_id", [i["id"] for i in items])
            .execute()
        )
        citations_by_item = {c["item_id"]: c for c in (cits.data or [])}

    highlights_by_item: dict[str, list[dict]] = {}
    if items:
        hls = (
            supabase.table("highlights")
            .select("item_id, text, note, created_at")
            .eq("user_id", user_id)
            .in_("item_id", [i["id"] for i in items])
            .order("created_at", desc=True)
            .limit(500)
            .execute()
        )
        for h in (hls.data or []):
            highlights_by_item.setdefault(h["item_id"], []).append(h)

    # Notes: evergreen full content, marginalia as titles only
    notes_full: list[dict] = []
    notes_titles: list[dict] = []
    if scope["note_ids"]:
        nres = (
            supabase.table("notes")
            .select("id, title, content, evergreen, tags, item_id, updated_at")
            .eq("user_id", user_id)
            .in_("id", scope["note_ids"])
            .order("updated_at", desc=True)
            .execute()
        )
        for n in (nres.data or []):
            if n.get("evergreen"):
                notes_full.append(n)
            else:
                notes_titles.append({
                    "id": n["id"],
                    "title": n.get("title"),
                    "item_id": n.get("item_id"),
                    "updated_at": n.get("updated_at"),
                })

    # Context version = stable hash over state
    items_meta = {i["id"]: i.get("created_at") or "" for i in items}
    notes_meta_all = {n["id"]: n.get("updated_at") or "" for n in (notes_full + notes_titles)}
    version = project_content_hash(
        scope["item_ids"], scope["note_ids"], items_meta, notes_meta_all
    )

    # Budget: allow ≥4k chars always; otherwise scale to req.max_tokens
    budget_chars = max(4_000, req.max_tokens * _AVG_CHARS_PER_TOKEN)

    payload_items: list[dict] = []
    for it in items:
        cit = citations_by_item.get(it["id"], {})
        top_hls = [
            {"text": h["text"][:280], "note": (h.get("note") or "")[:160]}
            for h in highlights_by_item.get(it["id"], [])[:3]
        ]
        payload_items.append({
            "id": it["id"],
            "title": it.get("title"),
            "type": it.get("type"),
            "url": it.get("url"),
            "domain": it.get("domain"),
            "authors": [a.get("name") for a in (cit.get("authors") or [])],
            "year": cit.get("year"),
            "venue": cit.get("venue"),
            "abstract_oneline": (cit.get("abstract") or it.get("summary") or "")[:320],
            "top_highlights": top_hls,
        })

    payload_notes_full = [
        {
            "id": n["id"],
            "title": n.get("title"),
            "content": (n.get("content") or "")[:4000],
            "tags": n.get("tags"),
            "updated_at": n.get("updated_at"),
            "linked_item_id": n.get("item_id"),
        }
        for n in notes_full
    ]

    base = {
        "project_name": scope["project_name"] or scope["path_key"],
        "project_path": scope["path_key"],
        "project_description": project_description,
        "resolution": scope["resolution"],
        "context_version": version,
        "folder_tree": scope["folder_tree"],
        "stats": {
            "items": len(items),
            "notes_evergreen": len(notes_full),
            "notes_marginalia": len(notes_titles),
        },
        "evergreen_notes": payload_notes_full,
        "marginalia_note_titles": notes_titles,
        "outstanding_references": [],
        "items": payload_items,
    }

    while _estimated_chars(base) > budget_chars and base["items"]:
        base["items"] = base["items"][:-1]

    base["cache_guidance"] = (
        "Place this JSON blob as a system-prompt content block with "
        "cache_control={type:'ephemeral'} on your Anthropic API call. Invalidate "
        "your cache whenever context_version changes."
    )
    base["estimated_tokens"] = _estimated_chars(base) // _AVG_CHARS_PER_TOKEN
    return base


def _estimated_chars(obj) -> int:
    return len(json.dumps(obj, default=str, ensure_ascii=False))


# ── 6. extract_references ───────────────────────────────────────────────────


@router.post("/extract-refs")
async def extract_references(req: ExtractReferencesRequest, request: Request):
    """Extract citation references from a paper's extracted text, resolve them,
    and flag which aren't in the user's library yet.

    Strategy: regex-scan the item's extracted_text for DOI and arXiv patterns
    (same patterns as citation_resolver). For each match, call Semantic
    Scholar / CrossRef. Then cross-reference by DOI and arXiv ID against the
    user's `citations` table.
    """
    from services.citation_resolver import (
        ARXIV_PATTERN,
        DOI_PATTERN,
        resolve_via_crossref,
        resolve_via_semantic_scholar,
    )

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    item_res = (
        supabase.table("items")
        .select("id, title, url, extracted_text")
        .eq("id", req.item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")
    text = item_res.data.get("extracted_text") or ""

    # Skip first 500 chars to avoid the paper's own DOI/arXiv ID
    scan = text[500:] if len(text) > 500 else text
    dois = sorted({m.group(0).rstrip('.') for m in DOI_PATTERN.finditer(scan)})
    arxivs = sorted({m.group(1) for m in ARXIV_PATTERN.finditer(scan)})

    doi_list = dois[: req.max_refs]
    arxiv_list = arxivs[: req.max_refs]

    references: list[dict] = []
    for doi in doi_list:
        resolved = await resolve_via_crossref(doi)
        if resolved:
            references.append(_normalize_ref(resolved, doi=doi, arxiv_id=None))
    for arxiv_id in arxiv_list:
        resolved = await resolve_via_semantic_scholar(arxiv_id, id_type="ArXiv")
        if resolved:
            references.append(_normalize_ref(resolved, doi=resolved.get("doi"), arxiv_id=arxiv_id))

    # Dedup
    seen: set[tuple] = set()
    unique: list[dict] = []
    for r in references:
        key = (r.get("doi"), r.get("arxiv_id"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    # Cross-ref library
    existing_dois: set[str] = set()
    existing_arxivs: set[str] = set()
    if unique:
        try:
            cits = (
                supabase.table("citations")
                .select("doi, arxiv_id, item_id, items!inner(user_id)")
                .eq("items.user_id", user_id)
                .execute()
            )
            for c in (cits.data or []):
                if c.get("doi"):
                    existing_dois.add(c["doi"])
                if c.get("arxiv_id"):
                    existing_arxivs.add(c["arxiv_id"])
        except Exception:
            pass

    in_library: list[dict] = []
    save_candidates: list[dict] = []
    for r in unique:
        match = (r.get("doi") and r["doi"] in existing_dois) or \
                (r.get("arxiv_id") and r["arxiv_id"] in existing_arxivs)
        r["in_library"] = bool(match)
        (in_library if match else save_candidates).append(r)

    return {
        "item_id": req.item_id,
        "source_title": item_res.data.get("title"),
        "references": unique,
        "in_library": in_library,
        "save_candidates": save_candidates,
        "stats": {
            "total": len(unique),
            "dois_scanned": len(doi_list),
            "arxivs_scanned": len(arxiv_list),
            "already_saved": len(in_library),
            "new": len(save_candidates),
        },
    }


def _normalize_ref(resolved: dict, doi: Optional[str], arxiv_id: Optional[str]) -> dict:
    """Normalize the resolver's mixed-shape output into a uniform reference dict."""
    # resolved may or may not carry "title"; citation_resolver puts it in bibtex
    title = resolved.get("title")
    if not title and resolved.get("bibtex"):
        # parse "title = {…}" from the generated bibtex
        bib = resolved["bibtex"]
        if "title = {" in bib:
            title = bib.split("title = {", 1)[1].split("}", 1)[0]
    return {
        "title": title,
        "doi": doi or resolved.get("doi"),
        "arxiv_id": arxiv_id or resolved.get("arxiv_id"),
        "authors": [a.get("name") for a in (resolved.get("authors") or [])],
        "year": resolved.get("year"),
        "venue": resolved.get("venue"),
        "abstract": resolved.get("abstract"),
        "citation_count": resolved.get("citation_count"),
        "bibtex": resolved.get("bibtex"),
        "url": f"https://doi.org/{doi}" if doi else (
            f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None
        ),
    }


# ── 7. save_to_project ──────────────────────────────────────────────────────


ARXIV_ID_RE = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")


@router.post("/save")
async def save_to_project(req: SaveToProjectRequest, request: Request):
    """Ingest an item (URL | arXiv ID | DOI) and attach it to the project.

    Uses the existing `/ingest/*` routes for extraction so we don't duplicate
    logic. Attaches via folder_items when projects are live; falls back to
    collection_items when the path resolves to a collection.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    scope = await resolve_project_path(req.project_path, user_id)
    item_ref = (req.item_ref or "").strip()

    ingest_result: dict = {}
    async with httpx.AsyncClient(timeout=60) as client:
        headers = {"X-User-Id": user_id, "Content-Type": "application/json"}
        base = _internal_base()

        if ARXIV_ID_RE.fullmatch(item_ref):
            r = await client.post(f"{base}/ingest/arxiv/{item_ref}", headers=headers)
        elif item_ref.lower().startswith("doi:") or item_ref.lower().startswith("10."):
            doi = item_ref[4:] if item_ref.lower().startswith("doi:") else item_ref
            r = await client.post(
                f"{base}/ingest",
                json={"url": f"https://doi.org/{doi}", "type": "paper",
                      "tags": [], "person_ids": []},
                headers=headers,
            )
        elif item_ref.startswith(("http://", "https://")):
            r = await client.post(
                f"{base}/ingest",
                json={"url": item_ref,
                      "type": "paper" if "arxiv.org" in item_ref else "page",
                      "tags": [], "person_ids": []},
                headers=headers,
            )
        else:
            raise HTTPException(status_code=400,
                                detail="item_ref must be a URL, arXiv ID, or DOI")

        if r.status_code >= 400:
            return {"ingested": False, "error": r.text, "project_path": scope["path_key"]}
        ingest_result = r.json()

    item = ingest_result.get("item") or ingest_result.get("ingested_item") or {}
    if not item or "id" not in item:
        return {"ingested": False, "error": "ingest response missing item",
                "raw": ingest_result, "project_path": scope["path_key"]}

    item_id = item["id"]
    attached = {"folder_id": None, "collection_id": None,
                "subpath": req.folder_subpath or ""}

    if scope["resolution"] == "folder" and scope["folder_id"]:
        leaf_folder_id = scope["folder_id"]
        if req.folder_subpath:
            leaf_folder_id = _ensure_subfolders(
                supabase, scope["project_id"], scope["folder_id"], req.folder_subpath,
            )
        try:
            supabase.table("folder_items").upsert(
                {"folder_id": leaf_folder_id, "item_id": item_id, "sort_order": 0},
                on_conflict="folder_id,item_id",
            ).execute()
            attached["folder_id"] = leaf_folder_id
        except Exception as exc:
            logger.warning("folder_items upsert failed: %s", exc)

    elif scope["resolution"] == "collection" and scope["collection_id"]:
        try:
            supabase.table("collection_items").upsert(
                {"collection_id": scope["collection_id"], "item_id": item_id,
                 "sort_order": 0},
                on_conflict="collection_id,item_id",
            ).execute()
            attached["collection_id"] = scope["collection_id"]
        except Exception as exc:
            logger.warning("collection_items upsert failed: %s", exc)

    return {
        "ingested": True,
        "item": item,
        "project_path": scope["path_key"],
        "attached": attached,
        "resolution": scope["resolution"],
    }


def _internal_base() -> str:
    return os.getenv("STOA_INTERNAL_URL", "http://localhost:8000")


def _ensure_subfolders(
    supabase, project_id: str, parent_folder_id: str, subpath: str,
) -> str:
    """Walk subpath segments, create missing folders, return the leaf id."""
    current = parent_folder_id
    current_path = _folder_path_for(supabase, current)
    for seg in [s for s in subpath.split("/") if s]:
        existing = (
            supabase.table("folders")
            .select("id")
            .eq("project_id", project_id)
            .eq("parent_folder_id", current)
            .ilike("name", seg)
            .limit(1)
            .execute()
        )
        if existing.data:
            current = existing.data[0]["id"]
            current_path = _folder_path_for(supabase, current)
        else:
            # Match the slug convention used by the projects router
            from services.project_path import slugify
            new_path = (
                f"/{slugify(seg)}" if current_path == "/" else f"{current_path}/{slugify(seg)}"
            )
            new_folder = supabase.table("folders").insert({
                "project_id": project_id,
                "parent_folder_id": current,
                "name": seg,
                "path": new_path,
                "sort_order": 0,
            }).execute()
            current = new_folder.data[0]["id"]
            current_path = new_path
    return current


def _folder_path_for(supabase, folder_id: str) -> str:
    r = (
        supabase.table("folders")
        .select("path")
        .eq("id", folder_id)
        .single()
        .execute()
    )
    return (r.data or {}).get("path", "/")


# ── 8. annotate_on_behalf ───────────────────────────────────────────────────


@router.post("/annotate")
async def annotate_on_behalf(req: AnnotateOnBehalfRequest, request: Request):
    """Write agent-sourced highlights + notes to an item.

    Rows carry `agent_source = {agent_id, created_at}`. Selectors mirror W3C
    Web Annotation shape (same key as feat/pdf-foundation). @mentions create
    `note_links` rows.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Verify ownership
    item = (
        supabase.table("items")
        .select("id")
        .eq("id", req.item_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not item.data:
        raise HTTPException(status_code=404, detail="Item not found")

    agent_meta = {
        "agent_id": req.agent_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    created_highlights: list[dict] = []
    for h in req.highlights:
        row: dict[str, Any] = {
            "item_id": req.item_id,
            "user_id": user_id,
            "text": h.text,
            "color": h.color,
            "note": h.note,
            "agent_source": agent_meta,
        }
        if h.selectors is not None:
            row["selectors"] = h.selectors
        try:
            r = supabase.table("highlights").insert(row).execute()
            created_highlights.append(r.data[0] if r.data else {})
        except Exception as exc:
            logger.warning("agent highlight insert failed (%s); retrying without new cols", exc)
            row.pop("selectors", None)
            row.pop("agent_source", None)
            r = supabase.table("highlights").insert(row).execute()
            created_highlights.append(r.data[0] if r.data else {})

    created_notes: list[dict] = []
    for n in req.notes:
        row = {
            "user_id": user_id,
            "item_id": req.item_id,
            "content": n.content,
            "title": n.title,
            "tags": list(n.tags),
            "evergreen": n.evergreen,
            "agent_source": agent_meta,
        }
        if n.anchor_selectors is not None:
            row["anchor_selectors"] = n.anchor_selectors
        try:
            r = supabase.table("notes").insert(row).execute()
        except Exception as exc:
            logger.warning("agent note insert fell back: %s", exc)
            row.pop("agent_source", None)
            row.pop("anchor_selectors", None)
            r = supabase.table("notes").insert(row).execute()
        if not r.data:
            continue
        note = r.data[0]
        created_notes.append(note)

        link_rows = []
        for iid in n.mention_item_ids:
            link_rows.append({
                "source_note_id": note["id"],
                "target_ref_type": "item",
                "target_ref_id": iid,
                "mention_offset": 0,
            })
        for nid in n.mention_note_ids:
            link_rows.append({
                "source_note_id": note["id"],
                "target_ref_type": "note",
                "target_ref_id": nid,
                "mention_offset": 0,
            })
        for pid in n.mention_person_ids:
            link_rows.append({
                "source_note_id": note["id"],
                "target_ref_type": "person",
                "target_ref_id": pid,
                "mention_offset": 0,
            })
        if link_rows:
            try:
                supabase.table("note_links").insert(link_rows).execute()
            except Exception as exc:
                logger.info("note_links insert skipped: %s", exc)

    return {
        "item_id": req.item_id,
        "agent_id": req.agent_id,
        "highlights_created": len(created_highlights),
        "notes_created": len(created_notes),
        "highlights": created_highlights,
        "notes": created_notes,
    }
