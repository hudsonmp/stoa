"""Notes CRUD endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()

# Valid note types stored as tags
NOTE_TYPES = {"marginalia", "synthesis", "journal"}


class CreateNoteRequest(BaseModel):
    item_id: Optional[str] = None
    person_id: Optional[str] = None
    content: str
    title: Optional[str] = None
    note_type: str = "marginalia"
    item_ids: list[str] = []
    tags: list[str] = []


class AppendNoteRequest(BaseModel):
    content: str


class LinkNoteRequest(BaseModel):
    item_id: str


def _build_tags(note_type: str, item_ids: list[str], extra_tags: list[str]) -> list[str]:
    """Build the tags array: note_type + ref:item_id entries + user tags."""
    tags = []
    if note_type in NOTE_TYPES:
        tags.append(note_type)
    for iid in item_ids:
        tags.append(f"ref:{iid}")
    tags.extend(t for t in extra_tags if t and t not in NOTE_TYPES and not t.startswith("ref:"))
    return tags


def _extract_note_type(tags: list[str] | None) -> str:
    """Extract note_type from tags array."""
    if not tags:
        return "marginalia"
    for t in tags:
        if t in NOTE_TYPES:
            return t
    return "marginalia"


def _extract_ref_ids(tags: list[str] | None) -> list[str]:
    """Extract referenced item_ids from ref: tags."""
    if not tags:
        return []
    return [t[4:] for t in tags if t.startswith("ref:")]


@router.post("")
async def create_note(req: CreateNoteRequest, request: Request):
    """Create a note. Supports marginalia (linked to item), synthesis, and journal types."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if req.note_type not in NOTE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid note_type. Must be one of: {', '.join(NOTE_TYPES)}")

    # For synthesis notes, merge item_id into item_ids if provided
    all_item_ids = list(req.item_ids)
    if req.item_id and req.item_id not in all_item_ids:
        all_item_ids.insert(0, req.item_id)

    tags = _build_tags(req.note_type, all_item_ids, req.tags)

    result = supabase.table("notes").insert({
        "user_id": user_id,
        "item_id": req.item_id,
        "person_id": req.person_id,
        "content": req.content,
        "title": req.title,
        "tags": tags,
    }).execute()

    return {"note": result.data[0]}


@router.get("/standalone")
async def list_standalone_notes(request: Request, limit: int = 50):
    """List notes where note_type != marginalia (synthesis and journal notes), ordered by updated_at."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Get all user notes, then filter client-side for non-marginalia
    # (Supabase array containment queries are limited; we pull and filter)
    result = (
        supabase.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(200)
        .execute()
    )

    notes = []
    for note in (result.data or []):
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

    # Search title
    title_result = (
        supabase.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .ilike("title", pattern)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )

    # Search content
    content_result = (
        supabase.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .ilike("content", pattern)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )

    # Merge and deduplicate, preserving order
    seen = set()
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

    # Fetch linked item titles
    linked_items = []
    # Primary item_id
    all_item_ids = []
    if note.get("item_id"):
        all_item_ids.append(note["item_id"])
    all_item_ids.extend(note["ref_item_ids"])
    # Deduplicate
    all_item_ids = list(dict.fromkeys(all_item_ids))

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
    """Append HTML content to an existing note (for highlight-to-quote pipeline)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Fetch existing note
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

    # Fetch existing note
    existing = (
        supabase.table("notes")
        .select("id, tags")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Note not found")

    # Verify the target item exists and belongs to user
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
    """Update a note's content, title, or tags."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    allowed = {"content", "title", "tags"}
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
    """Delete a note."""
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
