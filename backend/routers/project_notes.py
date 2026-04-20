"""Project-scoped notes CRUD endpoints (fork of routers/notes.py).

Data-layer fork rationale
─────────────────────────
Evergreen toggle, W3C anchor selectors, mark-and-return highlight anchoring,
autosave idempotency, and @mention cross-links all belong to *Projects*, not
to the general library. The original `notes` table + `/notes` router keep the
pre-merge shape; this router reads/writes `project_notes` exclusively.

Shape parity:
  /project-notes mirrors every endpoint on /notes, with identical response
  shape, plus:
    - evergreen, anchor_selectors, anchored_highlight_ids, draft_id fields
      on create/update
    - /project-notes/:id/links endpoints reading/writing project_note_links

This router requires callers to supply `project_id` (and optionally
`folder_id`) on create. The reader UI passes these from the URL context
(?project_id=…&folder_id=…) so that a note created while reading inside a
project is automatically scoped.
"""

import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id
from services.note_markdown import note_to_markdown

router = APIRouter()

# Valid note types stored as tags
NOTE_TYPES = {"marginalia", "synthesis", "journal"}

# Valid cross-link target types
LINK_TARGET_TYPES = {"note", "item", "person", "folder"}


# ─── request models ───────────────────────────────────────────────────────────


class CreateProjectNoteRequest(BaseModel):
    project_id: Optional[str] = None
    folder_id: Optional[str] = None
    item_id: Optional[str] = None
    person_id: Optional[str] = None
    content: str
    title: Optional[str] = None
    note_type: str = "marginalia"
    item_ids: list[str] = []
    tags: list[str] = []
    evergreen: bool = False
    anchor_selectors: Optional[Any] = None
    anchored_highlight_ids: list[str] = []
    # Client-generated idempotency key (UUID). Autosave race-fix: a concurrent
    # POST carrying the same (user_id, draft_id) returns the existing row
    # instead of creating a duplicate.
    draft_id: Optional[str] = None


class AppendProjectNoteRequest(BaseModel):
    content: str


class LinkProjectNoteRequest(BaseModel):
    item_id: str


class CreateProjectNoteLinkRequest(BaseModel):
    target_ref_type: str
    target_ref_id: str
    mention_offset: Optional[int] = None


# ─── tag helpers (duplicated from notes.py; ok because routers are forks) ─────


def _build_tags(note_type: str, item_ids: list[str], extra_tags: list[str]) -> list[str]:
    effective_type = note_type
    for t in extra_tags:
        if t in NOTE_TYPES:
            effective_type = t
            break
    tags = [effective_type] if effective_type in NOTE_TYPES else []
    for iid in item_ids:
        tags.append(f"ref:{iid}")
    tags.extend(t for t in extra_tags if t and t not in NOTE_TYPES and not t.startswith("ref:"))
    return tags


def _extract_note_type(tags: list[str] | None) -> str:
    if not tags:
        return "marginalia"
    for t in tags:
        if t in NOTE_TYPES:
            return t
    return "marginalia"


def _extract_ref_ids(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    return [t[4:] for t in tags if t.startswith("ref:")]


# ─── ownership guard ──────────────────────────────────────────────────────────


def _assert_project_note_owned(supabase: Any, note_id: str, user_id: str) -> None:
    check = (
        supabase.table("project_notes")
        .select("id")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="Project note not found")


# ─── CRUD ─────────────────────────────────────────────────────────────────────


@router.post("")
async def create_project_note(req: CreateProjectNoteRequest, request: Request):
    """Create a project-scoped note."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if req.note_type not in NOTE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid note_type. Must be one of: {', '.join(NOTE_TYPES)}",
        )

    all_item_ids = list(req.item_ids)
    if req.item_id and req.item_id not in all_item_ids:
        all_item_ids.insert(0, req.item_id)

    tags = _build_tags(req.note_type, all_item_ids, req.tags)

    # Idempotency: a concurrent request carrying the same draft_id returns the
    # existing row. Solves the autosave race where two POSTs fire before the
    # first response arrives.
    if req.draft_id:
        existing = (
            supabase.table("project_notes")
            .select("*")
            .eq("user_id", user_id)
            .eq("draft_id", req.draft_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            note = existing.data[0]
            note["note_type"] = _extract_note_type(note.get("tags"))
            return {"note": note}

    row: dict[str, Any] = {
        "user_id": user_id,
        "item_id": req.item_id,
        "person_id": req.person_id,
        "content": req.content,
        "title": req.title,
        "tags": tags,
        "evergreen": req.evergreen,
        "project_id": req.project_id,
        "folder_id": req.folder_id,
    }
    if req.anchor_selectors is not None:
        row["anchor_selectors"] = req.anchor_selectors
    if req.anchored_highlight_ids:
        row["anchored_highlight_ids"] = req.anchored_highlight_ids
    if req.draft_id:
        row["draft_id"] = req.draft_id

    result = supabase.table("project_notes").insert(row).execute()
    return {"note": result.data[0]}


@router.get("/standalone")
async def list_standalone_project_notes(request: Request, limit: int = 50):
    """List project notes where note_type != marginalia."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("project_notes")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(200)
        .execute()
    )

    notes = []
    for note in result.data or []:
        note_type = _extract_note_type(note.get("tags"))
        if note_type != "marginalia":
            note["note_type"] = note_type
            note["ref_item_ids"] = _extract_ref_ids(note.get("tags"))
            notes.append(note)
            if len(notes) >= limit:
                break

    return {"notes": notes}


@router.get("/search")
async def search_project_notes(request: Request, q: str, limit: int = 20):
    """Full-text ILIKE search across project-note title + content."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters")

    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"

    title_result = (
        supabase.table("project_notes")
        .select("*")
        .eq("user_id", user_id)
        .ilike("title", pattern)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    content_result = (
        supabase.table("project_notes")
        .select("*")
        .eq("user_id", user_id)
        .ilike("content", pattern)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )

    seen: set[str] = set()
    notes = []
    for note in (title_result.data or []) + (content_result.data or []):
        if note["id"] not in seen:
            seen.add(note["id"])
            note["note_type"] = _extract_note_type(note.get("tags"))
            note["ref_item_ids"] = _extract_ref_ids(note.get("tags"))
            notes.append(note)

    return {"notes": notes[:limit], "count": len(notes[:limit])}


@router.get("/{note_id}/markdown", response_class=PlainTextResponse)
async def get_project_note_markdown(note_id: str, request: Request):
    """Return the note as round-trippable `.md` (frontmatter + body).

    Consumed by the folder-sync engine (vault reconciliation) and by the
    editor's "show source" toggle. Path-safe relative to `GET /{note_id}`.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("project_notes")
        .select("*")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project note not found")
    note = result.data[0]

    links_result = (
        supabase.table("project_note_links")
        .select("target_ref_id, target_ref_type")
        .eq("source_project_note_id", note_id)
        .execute()
    )
    md = note_to_markdown(note)
    if links_result.data:
        from services.note_markdown import (  # noqa: WPS433
            _build_frontmatter,
            html_to_markdown,
            stringify_frontmatter,
        )

        fm = _build_frontmatter(dict(note))
        fm["links_out"] = [row["target_ref_id"] for row in links_result.data]
        title = (note.get("title") or "").strip()
        body_md = html_to_markdown(note.get("content") or "")
        title_line = f"# {title}\n\n" if title and title != "Untitled" else ""
        md = f"{stringify_frontmatter(fm)}\n{title_line}{body_md}"

    return PlainTextResponse(md, media_type="text/markdown")


@router.get("/{note_id}")
async def get_project_note(note_id: str, request: Request):
    """Fetch a single project note with linked item titles."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("project_notes")
        .select("*")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project note not found")

    note = result.data[0]
    note["note_type"] = _extract_note_type(note.get("tags"))
    note["ref_item_ids"] = _extract_ref_ids(note.get("tags"))

    all_item_ids: list[str] = []
    if note.get("item_id"):
        all_item_ids.append(note["item_id"])
    all_item_ids.extend(note["ref_item_ids"])
    all_item_ids = list(dict.fromkeys(all_item_ids))

    linked_items: list[Any] = []
    if all_item_ids:
        items_result = (
            supabase.table("items")
            .select("id, title, url, type")
            .in_("id", all_item_ids)
            .execute()
        )
        linked_items = items_result.data or []

    note["linked_items"] = linked_items
    return {"note": note}


@router.post("/{note_id}/append")
async def append_to_project_note(
    note_id: str, req: AppendProjectNoteRequest, request: Request
):
    """Append HTML content to an existing project note."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    existing = (
        supabase.table("project_notes")
        .select("id, content")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project note not found")

    current_content = existing.data[0].get("content", "") or ""
    new_content = current_content + "\n" + req.content if current_content else req.content

    result = (
        supabase.table("project_notes")
        .update({"content": new_content})
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    return {"note": result.data[0]}


@router.post("/{note_id}/link")
async def link_project_note_to_item(
    note_id: str, req: LinkProjectNoteRequest, request: Request
):
    """Link a project note to an item by adding a ref:item_id tag."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    existing = (
        supabase.table("project_notes")
        .select("id, tags")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project note not found")

    item_check = (
        supabase.table("items")
        .select("id")
        .eq("id", req.item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not item_check.data:
        raise HTTPException(status_code=404, detail="Item not found")

    current_tags = existing.data[0].get("tags") or []
    ref_tag = f"ref:{req.item_id}"
    if ref_tag in current_tags:
        return {"note": existing.data[0], "message": "Already linked"}

    updated_tags = current_tags + [ref_tag]
    result = (
        supabase.table("project_notes")
        .update({"tags": updated_tags})
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    return {"note": result.data[0]}


@router.get("")
async def list_project_notes(
    request: Request,
    project_id: Optional[str] = None,
    folder_id: Optional[str] = None,
    item_id: Optional[str] = None,
    person_id: Optional[str] = None,
):
    """List project notes, optionally filtered by project, folder, item, or person."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    query = supabase.table("project_notes").select("*").eq("user_id", user_id)

    if project_id:
        query = query.eq("project_id", project_id)
    if folder_id:
        query = query.eq("folder_id", folder_id)
    if item_id:
        query = query.eq("item_id", item_id)
    if person_id:
        query = query.eq("person_id", person_id)

    result = query.order("created_at", desc=True).limit(100).execute()
    return {"notes": result.data or []}


@router.patch("/{note_id}")
async def update_project_note(note_id: str, request: Request):
    """Update a project note's fields. All Project-only fields are patchable."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    allowed = {
        "content",
        "title",
        "tags",
        "evergreen",
        "anchor_selectors",
        "anchored_highlight_ids",
        "project_id",
        "folder_id",
    }
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("project_notes")
        .update(updates)
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project note not found")
    return {"note": result.data[0]}


@router.delete("/{note_id}")
async def delete_project_note(note_id: str, request: Request):
    """Delete a project note (cascades to project_note_links via FK)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("project_notes")
        .delete()
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project note not found")
    return {"deleted": True, "id": note_id}


# ─── project_note_links: @mention CRUD + Links-tab queries ───────────────────


@router.get("/{note_id}/links")
async def get_project_note_links(note_id: str, request: Request):
    """Links tab query: outgoing @mentions + incoming backlinks."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    _assert_project_note_owned(supabase, note_id, user_id)

    out_result = (
        supabase.table("project_note_links")
        .select("*")
        .eq("source_project_note_id", note_id)
        .order("created_at")
        .execute()
    )
    outgoing: list[dict[str, Any]] = list(out_result.data or [])

    in_result = (
        supabase.table("project_note_links")
        .select("*")
        .eq("target_ref_type", "note")
        .eq("target_ref_id", note_id)
        .order("created_at")
        .execute()
    )
    incoming_raw: list[dict[str, Any]] = list(in_result.data or [])

    note_ids_out = [r["target_ref_id"] for r in outgoing if r["target_ref_type"] == "note"]
    item_ids_out = [r["target_ref_id"] for r in outgoing if r["target_ref_type"] == "item"]
    person_ids_out = [r["target_ref_id"] for r in outgoing if r["target_ref_type"] == "person"]

    target_note_titles = _fetch_project_note_titles(supabase, note_ids_out, user_id)
    target_item_titles = _fetch_item_titles(supabase, item_ids_out, user_id)
    target_person_names = _fetch_person_names(supabase, person_ids_out, user_id)

    for row in outgoing:
        tt = row["target_ref_type"]
        tid = row["target_ref_id"]
        if tt == "note":
            row["target_title"] = target_note_titles.get(tid)
        elif tt == "item":
            row["target_title"] = target_item_titles.get(tid)
        elif tt == "person":
            row["target_title"] = target_person_names.get(tid)
        else:
            row["target_title"] = None

    source_ids = [r["source_project_note_id"] for r in incoming_raw]
    source_titles = _fetch_project_note_titles(supabase, source_ids, user_id)

    incoming: list[dict[str, Any]] = []
    for row in incoming_raw:
        sid = row["source_project_note_id"]
        if sid in source_titles:
            row["source_title"] = source_titles[sid]
            incoming.append(row)

    return {"outgoing": outgoing, "incoming": incoming}


@router.post("/{note_id}/links")
async def create_project_note_link(
    note_id: str, req: CreateProjectNoteLinkRequest, request: Request
):
    """Persist an @mention link from source project note to a target entity."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if req.target_ref_type not in LINK_TARGET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"target_ref_type must be one of: {', '.join(sorted(LINK_TARGET_TYPES))}",
        )

    _assert_project_note_owned(supabase, note_id, user_id)

    offset = req.mention_offset if req.mention_offset is not None else 0

    result = (
        supabase.table("project_note_links")
        .upsert(
            {
                "source_project_note_id": note_id,
                "target_ref_type": req.target_ref_type,
                "target_ref_id": req.target_ref_id,
                "mention_offset": offset,
            },
            on_conflict="source_project_note_id,target_ref_type,target_ref_id,mention_offset",
        )
        .execute()
    )
    link_data: dict[str, Any] = result.data[0] if result.data else {
        "source_project_note_id": note_id,
        "target_ref_type": req.target_ref_type,
        "target_ref_id": req.target_ref_id,
        "mention_offset": offset,
    }
    return {"link": link_data}


@router.delete("/{note_id}/links/{target_ref_type}/{target_ref_id}")
async def delete_project_note_link(
    note_id: str,
    target_ref_type: str,
    target_ref_id: str,
    request: Request,
):
    """Remove all @mention links from this note to the specified target."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    _assert_project_note_owned(supabase, note_id, user_id)

    (
        supabase.table("project_note_links")
        .delete()
        .eq("source_project_note_id", note_id)
        .eq("target_ref_type", target_ref_type)
        .eq("target_ref_id", target_ref_id)
        .execute()
    )
    return {"deleted": True}


# ─── private title-fetch helpers ─────────────────────────────────────────────


def _fetch_project_note_titles(
    supabase: Any, ids: list[str], user_id: str
) -> dict[str, str | None]:
    """Return {note_id: display_title} for project notes the user owns."""
    if not ids:
        return {}
    result = (
        supabase.table("project_notes")
        .select("id, title, content")
        .in_("id", ids)
        .eq("user_id", user_id)
        .execute()
    )
    out: dict[str, str | None] = {}
    for row in result.data or []:
        title = row.get("title") or None
        if not title or title == "Untitled":
            text = re.sub(r"<[^>]+>", "", row.get("content", "")).strip()
            first = text.split("\n")[0][:60] if text else None
            title = first or "Untitled"
        out[row["id"]] = title
    return out


def _fetch_item_titles(
    supabase: Any, ids: list[str], user_id: str
) -> dict[str, str | None]:
    if not ids:
        return {}
    result = (
        supabase.table("items")
        .select("id, title")
        .in_("id", ids)
        .eq("user_id", user_id)
        .execute()
    )
    return {row["id"]: row.get("title") for row in result.data or []}


def _fetch_person_names(
    supabase: Any, ids: list[str], user_id: str
) -> dict[str, str | None]:
    if not ids:
        return {}
    result = (
        supabase.table("people")
        .select("id, name")
        .in_("id", ids)
        .eq("user_id", user_id)
        .execute()
    )
    return {row["id"]: row.get("name") for row in result.data or []}
