"""Notes CRUD endpoints.

Evergreen notes extension (feat/notes-evergreen PR 1)
─────────────────────────────────────────────────────
notes table additions:
  - evergreen              boolean, per-note toggle
  - anchor_selectors       jsonb, W3C Web Annotation selectors
  - anchored_highlight_ids uuid[], passages flagged mark-and-return

note_links table (new):
  @mention cross-links from a note to note|item|person|folder

New endpoints:
  GET    /notes/{id}/links                          Links tab query
  POST   /notes/{id}/links                          Persist a mention
  DELETE /notes/{id}/links/{ref_type}/{ref_id}      Remove links
"""

import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()

# Valid note types stored as tags
NOTE_TYPES = {"marginalia", "synthesis", "journal"}

# Valid cross-link target types (mirrors CHECK constraint in migration 006)
LINK_TARGET_TYPES = {"note", "item", "person", "folder"}


# ─── request models ───────────────────────────────────────────────────────────


class CreateNoteRequest(BaseModel):
    item_id: Optional[str] = None
    person_id: Optional[str] = None
    content: str
    title: Optional[str] = None
    note_type: str = "marginalia"
    item_ids: list[str] = []
    tags: list[str] = []
    evergreen: bool = False
    anchor_selectors: Optional[Any] = None  # jsonb W3C Web Annotation
    anchored_highlight_ids: list[str] = []
    # Client-generated idempotency key (UUID). If supplied and a note with
    # the same (user_id, draft_id) already exists, that note is returned
    # instead of creating a duplicate. Solves the autosave race where two
    # concurrent POSTs fire before the first response arrives.
    draft_id: Optional[str] = None


class AppendNoteRequest(BaseModel):
    content: str


class LinkNoteRequest(BaseModel):
    item_id: str


class CreateNoteLinkRequest(BaseModel):
    target_ref_type: str
    target_ref_id: str
    mention_offset: Optional[int] = None


# ─── tag helpers ──────────────────────────────────────────────────────────────


def _build_tags(note_type: str, item_ids: list[str], extra_tags: list[str]) -> list[str]:
    """Build the tags array: note_type + ref:item_id entries + user tags."""
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


def _assert_note_owned(supabase: Any, note_id: str, user_id: str) -> None:
    """Raises 404 if note_id does not exist or belongs to a different user."""
    check = (
        supabase.table("notes")
        .select("id")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="Note not found")


# ─── notes CRUD ───────────────────────────────────────────────────────────────


@router.post("")
async def create_note(req: CreateNoteRequest, request: Request):
    """Create a note.  Supports marginalia, synthesis, journal types.

    New fields: evergreen, anchor_selectors, anchored_highlight_ids.
    """
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

    # Idempotency: if draft_id was supplied, check whether this note was
    # already created by a concurrent request. Return the existing row to
    # prevent duplicates under rapid-keystroke autosave race conditions.
    if req.draft_id:
        existing = (
            supabase.table("notes")
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
    }
    if req.anchor_selectors is not None:
        row["anchor_selectors"] = req.anchor_selectors
    if req.anchored_highlight_ids:
        row["anchored_highlight_ids"] = req.anchored_highlight_ids
    if req.draft_id:
        row["draft_id"] = req.draft_id

    result = supabase.table("notes").insert(row).execute()
    return {"note": result.data[0]}


@router.get("/standalone")
async def list_standalone_notes(request: Request, limit: int = 50):
    """List notes where note_type != marginalia, ordered by updated_at."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("notes")
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
async def search_notes(request: Request, q: str, limit: int = 20):
    """Full-text ILIKE search across note title + content."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters")

    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"

    title_result = (
        supabase.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .ilike("title", pattern)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )

    content_result = (
        supabase.table("notes")
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


@router.get("/{note_id}")
async def get_note(note_id: str, request: Request):
    """Get a single note with linked item titles."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("notes")
        .select("*")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")

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
async def append_to_note(note_id: str, req: AppendNoteRequest, request: Request):
    """Append HTML content to an existing note."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    existing = (
        supabase.table("notes")
        .select("id, content")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Note not found")

    current_content = existing.data[0].get("content", "") or ""
    new_content = current_content + "\n" + req.content if current_content else req.content

    result = (
        supabase.table("notes")
        .update({"content": new_content})
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    return {"note": result.data[0]}


@router.post("/{note_id}/link")
async def link_note_to_item(note_id: str, req: LinkNoteRequest, request: Request):
    """Link a note to an item by adding a ref:item_id tag."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    existing = (
        supabase.table("notes")
        .select("id, tags")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Note not found")

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
        supabase.table("notes")
        .update({"tags": updated_tags})
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    return {"note": result.data[0]}


@router.get("")
async def list_notes(
    request: Request,
    item_id: Optional[str] = None,
    person_id: Optional[str] = None,
):
    """List notes for the authenticated user, optionally filtered by item or person."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    query = supabase.table("notes").select("*").eq("user_id", user_id)

    if item_id:
        query = query.eq("item_id", item_id)
    if person_id:
        query = query.eq("person_id", person_id)

    result = query.order("created_at", desc=True).limit(100).execute()
    return {"notes": result.data or []}


@router.patch("/{note_id}")
async def update_note(note_id: str, request: Request):
    """Update a note's content, title, tags, evergreen flag, or anchor fields."""
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
    }
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("notes")
        .update(updates)
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"note": result.data[0]}


@router.delete("/{note_id}")
async def delete_note(note_id: str, request: Request):
    """Delete a note (cascades to note_links via FK)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("notes")
        .delete()
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"deleted": True, "id": note_id}


# ─── note_links: @mention cross-link CRUD + Links-tab queries ────────────────


@router.get("/{note_id}/links")
async def get_note_links(note_id: str, request: Request):
    """Links tab query: outgoing @mentions + incoming backlinks.

    Response:
    {
      "outgoing": [{ ...link_row, target_title }],
      "incoming": [{ ...link_row, source_title }]
    }
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    _assert_note_owned(supabase, note_id, user_id)

    out_result = (
        supabase.table("note_links")
        .select("*")
        .eq("source_note_id", note_id)
        .order("created_at")
        .execute()
    )
    outgoing: list[dict[str, Any]] = list(out_result.data or [])

    in_result = (
        supabase.table("note_links")
        .select("*")
        .eq("target_ref_type", "note")
        .eq("target_ref_id", note_id)
        .order("created_at")
        .execute()
    )
    incoming_raw: list[dict[str, Any]] = list(in_result.data or [])

    # Enrich outgoing with human-readable target titles
    note_ids_out = [r["target_ref_id"] for r in outgoing if r["target_ref_type"] == "note"]
    item_ids_out = [r["target_ref_id"] for r in outgoing if r["target_ref_type"] == "item"]
    person_ids_out = [r["target_ref_id"] for r in outgoing if r["target_ref_type"] == "person"]

    target_note_titles = _fetch_note_titles(supabase, note_ids_out, user_id)
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

    # Enrich incoming with source note titles (only this user's owned notes)
    source_ids = [r["source_note_id"] for r in incoming_raw]
    source_titles = _fetch_note_titles(supabase, source_ids, user_id)

    incoming: list[dict[str, Any]] = []
    for row in incoming_raw:
        sid = row["source_note_id"]
        if sid in source_titles:
            row["source_title"] = source_titles[sid]
            incoming.append(row)

    return {"outgoing": outgoing, "incoming": incoming}


@router.post("/{note_id}/links")
async def create_note_link(
    note_id: str, req: CreateNoteLinkRequest, request: Request
):
    """Persist an @mention link from source note to a target entity.

    Upserts on composite PK — safe to call on every editor save.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if req.target_ref_type not in LINK_TARGET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"target_ref_type must be one of: {', '.join(sorted(LINK_TARGET_TYPES))}",
        )

    _assert_note_owned(supabase, note_id, user_id)

    # Use 0 as sentinel when offset is omitted so the composite PK is defined
    offset = req.mention_offset if req.mention_offset is not None else 0

    result = (
        supabase.table("note_links")
        .upsert(
            {
                "source_note_id": note_id,
                "target_ref_type": req.target_ref_type,
                "target_ref_id": req.target_ref_id,
                "mention_offset": offset,
            },
            on_conflict="source_note_id,target_ref_type,target_ref_id,mention_offset",
        )
        .execute()
    )
    link_data: dict[str, Any] = result.data[0] if result.data else {
        "source_note_id": note_id,
        "target_ref_type": req.target_ref_type,
        "target_ref_id": req.target_ref_id,
        "mention_offset": offset,
    }
    return {"link": link_data}


@router.delete("/{note_id}/links/{target_ref_type}/{target_ref_id}")
async def delete_note_link(
    note_id: str,
    target_ref_type: str,
    target_ref_id: str,
    request: Request,
):
    """Remove all @mention links from this note to the specified target.

    Removes all offsets for the (source, type, target) triple.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    _assert_note_owned(supabase, note_id, user_id)

    (
        supabase.table("note_links")
        .delete()
        .eq("source_note_id", note_id)
        .eq("target_ref_type", target_ref_type)
        .eq("target_ref_id", target_ref_id)
        .execute()
    )
    return {"deleted": True}


# ─── private title-fetch helpers ─────────────────────────────────────────────


def _fetch_note_titles(
    supabase: Any, ids: list[str], user_id: str
) -> dict[str, str | None]:
    """Return {note_id: display_title} for notes the calling user owns."""
    if not ids:
        return {}
    result = (
        supabase.table("notes")
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
