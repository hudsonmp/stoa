"""Notes CRUD endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()


class CreateNoteRequest(BaseModel):
    item_id: Optional[str] = None
    person_id: Optional[str] = None
    content: str
    title: Optional[str] = None


@router.post("")
async def create_note(req: CreateNoteRequest, request: Request):
    """Create a note."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = supabase.table("notes").insert({
        "user_id": user_id,
        "item_id": req.item_id,
        "person_id": req.person_id,
        "content": req.content,
        "title": req.title,
    }).execute()

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
    """Update a note's content or title."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    allowed = {"content", "title"}
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
