"""Notes CRUD endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()

# Valid note types stored as tags
NOTE_TYPES = {"marginalia", "synthesis", "journal"}

# Knowledge types — encode BEFORE extracting. Maps to different memory systems.
# declarative → Anki-friendly; procedural → spaced practice; conceptual → schemas/essay;
# episodic → story retention; stylistic → imitation. See Reading Hamming companion §4.
KNOWLEDGE_TYPES = {"declarative", "procedural", "conceptual", "episodic", "stylistic"}

# Note types that should enforce dense linking (orphan detection applies).
# Marginalia is tied to an item already; journals are free-form. Synthesis/evergreen should link.
EVERGREEN_TYPES = {"synthesis"}

# Minimum links for a synthesis note not to count as an orphan (Matuschak: "orphan = waste").
MIN_LINKS = 2


class CreateNoteRequest(BaseModel):
    item_id: Optional[str] = None
    person_id: Optional[str] = None
    content: str
    title: Optional[str] = None
    note_type: str = "marginalia"
    knowledge_type: Optional[str] = None
    item_ids: list[str] = []
    note_ids: list[str] = []
    tags: list[str] = []


class AppendNoteRequest(BaseModel):
    content: str


class LinkNoteRequest(BaseModel):
    item_id: str


class LinkNoteToNoteRequest(BaseModel):
    target_note_id: str


def _build_tags(
    note_type: str,
    item_ids: list[str],
    extra_tags: list[str],
    knowledge_type: Optional[str] = None,
    note_ids: Optional[list[str]] = None,
) -> list[str]:
    """Build tags: note_type + kt:<knowledge_type> + ref:<item_id> + link:<note_id> + user tags."""
    # Allow note type to be overridden via extra_tags
    effective_type = note_type
    for t in extra_tags:
        if t in NOTE_TYPES:
            effective_type = t
            break
    tags = [effective_type] if effective_type in NOTE_TYPES else []

    # Knowledge type: explicit param wins; fall back to any kt:* in extra_tags
    effective_kt = knowledge_type
    if effective_kt is None:
        for t in extra_tags:
            if t.startswith("kt:") and t[3:] in KNOWLEDGE_TYPES:
                effective_kt = t[3:]
                break
    if effective_kt in KNOWLEDGE_TYPES:
        tags.append(f"kt:{effective_kt}")

    for iid in item_ids:
        tags.append(f"ref:{iid}")
    for nid in (note_ids or []):
        tags.append(f"link:{nid}")

    # Pass through any remaining user tags (filter out anything we already consumed)
    reserved_prefixes = ("ref:", "link:", "kt:")
    for t in extra_tags:
        if not t or t in NOTE_TYPES:
            continue
        if t.startswith(reserved_prefixes):
            continue
        tags.append(t)
    return tags


def _extract_note_type(tags: list[str] | None) -> str:
    """Extract note_type from tags array."""
    if not tags:
        return "marginalia"
    for t in tags:
        if t in NOTE_TYPES:
            return t
    return "marginalia"


def _extract_knowledge_type(tags: list[str] | None) -> Optional[str]:
    """Extract knowledge_type from a kt:<type> tag, if present."""
    if not tags:
        return None
    for t in tags:
        if t.startswith("kt:") and t[3:] in KNOWLEDGE_TYPES:
            return t[3:]
    return None


def _extract_ref_ids(tags: list[str] | None) -> list[str]:
    """Extract referenced item_ids from ref: tags."""
    if not tags:
        return []
    return [t[4:] for t in tags if t.startswith("ref:")]


def _extract_linked_note_ids(tags: list[str] | None) -> list[str]:
    """Extract linked note ids from link: tags."""
    if not tags:
        return []
    return [t[5:] for t in tags if t.startswith("link:")]


def _annotate(note: dict) -> dict:
    """Attach derived fields (note_type, knowledge_type, refs, links) from tags."""
    tags = note.get("tags")
    note["note_type"] = _extract_note_type(tags)
    note["knowledge_type"] = _extract_knowledge_type(tags)
    note["ref_item_ids"] = _extract_ref_ids(tags)
    note["linked_note_ids"] = _extract_linked_note_ids(tags)
    return note


@router.post("")
async def create_note(req: CreateNoteRequest, request: Request):
    """Create a note. Supports marginalia (linked to item), synthesis, and journal types."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if req.note_type not in NOTE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid note_type. Must be one of: {', '.join(NOTE_TYPES)}")

    if req.knowledge_type is not None and req.knowledge_type not in KNOWLEDGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid knowledge_type. Must be one of: {', '.join(sorted(KNOWLEDGE_TYPES))}",
        )

    # For synthesis notes, merge item_id into item_ids if provided
    all_item_ids = list(req.item_ids)
    if req.item_id and req.item_id not in all_item_ids:
        all_item_ids.insert(0, req.item_id)

    tags = _build_tags(
        req.note_type,
        all_item_ids,
        req.tags,
        knowledge_type=req.knowledge_type,
        note_ids=req.note_ids,
    )

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
            _annotate(note)
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
            _annotate(note)
            notes.append(note)

    return {"notes": notes[:limit], "count": len(notes[:limit])}


@router.get("/orphans")
async def list_orphan_notes(request: Request, limit: int = 50):
    """Return synthesis/evergreen notes with fewer than MIN_LINKS note-to-note links.

    Matuschak: an orphan note (not linked to the rest of the graph) is wasted.
    This endpoint surfaces them so the user can retrofit links or delete them.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(500)
        .execute()
    )

    orphans = []
    for note in (result.data or []):
        tags = note.get("tags")
        note_type = _extract_note_type(tags)
        if note_type not in EVERGREEN_TYPES:
            continue
        if len(_extract_linked_note_ids(tags)) < MIN_LINKS:
            _annotate(note)
            orphans.append(note)
            if len(orphans) >= limit:
                break

    return {"notes": orphans, "count": len(orphans), "min_links": MIN_LINKS}


@router.get("/by-knowledge-type/{kt}")
async def list_notes_by_knowledge_type(kt: str, request: Request, limit: int = 50):
    """Filter notes by knowledge type. Route each unit to the correct memory system:
    declarative → Anki; procedural → spaced practice; conceptual → essays; etc.
    """
    if kt not in KNOWLEDGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid knowledge_type. Must be one of: {', '.join(sorted(KNOWLEDGE_TYPES))}",
        )

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Supabase array containment: tags @> ['kt:<type>'] — contains() wraps this.
    result = (
        supabase.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .contains("tags", [f"kt:{kt}"])
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )

    notes = [_annotate(n) for n in (result.data or [])]
    return {"notes": notes, "knowledge_type": kt, "count": len(notes)}


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
    _annotate(note)

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

    # Hydrate linked-note previews (title + note_type) for the dense-linking UI
    linked_notes = []
    if note["linked_note_ids"]:
        linked_notes_result = (
            supabase.table("notes")
            .select("id, title, tags")
            .in_("id", note["linked_note_ids"])
            .eq("user_id", user_id)
            .execute()
        )
        for ln in (linked_notes_result.data or []):
            linked_notes.append({
                "id": ln["id"],
                "title": ln.get("title"),
                "note_type": _extract_note_type(ln.get("tags")),
                "knowledge_type": _extract_knowledge_type(ln.get("tags")),
            })
    note["linked_notes"] = linked_notes

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


@router.delete("/{note_id}/link-note/{target_note_id}")
async def unlink_note_from_note(note_id: str, target_note_id: str, request: Request):
    """Remove a link:<target> tag from the source note. Inverse of link_note_to_note."""
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

    current_tags = existing.data[0].get("tags") or []
    link_tag = f"link:{target_note_id}"
    if link_tag not in current_tags:
        return {"note": existing.data[0], "message": "Not linked"}

    updated_tags = [t for t in current_tags if t != link_tag]
    result = (
        supabase.table("notes")
        .update({"tags": updated_tags})
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    return {"note": result.data[0]}


@router.post("/{note_id}/link-note")
async def link_note_to_note(note_id: str, req: LinkNoteToNoteRequest, request: Request):
    """Link one note to another via a link:<note_id> tag (Matuschak dense linking).

    Idempotent: duplicate links are a no-op. Rejects self-links and cross-user links.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if note_id == req.target_note_id:
        raise HTTPException(status_code=400, detail="Cannot link a note to itself")

    existing = (
        supabase.table("notes")
        .select("id, tags")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Note not found")

    target = (
        supabase.table("notes")
        .select("id")
        .eq("id", req.target_note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not target.data:
        raise HTTPException(status_code=404, detail="Target note not found")

    current_tags = existing.data[0].get("tags") or []
    link_tag = f"link:{req.target_note_id}"
    if link_tag in current_tags:
        return {"note": existing.data[0], "message": "Already linked"}

    updated_tags = current_tags + [link_tag]
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
