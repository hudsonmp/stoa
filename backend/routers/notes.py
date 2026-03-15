"""Notes endpoints."""

import os
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from supabase import create_client

router = APIRouter()


def get_supabase():
    return create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY"),
    )


class CreateNoteRequest(BaseModel):
    user_id: str
    item_id: str
    content: str
    title: Optional[str] = None
    tags: list[str] = []


@router.post("")
async def create_note(req: CreateNoteRequest):
    """Create a note attached to an item."""
    supabase = get_supabase()

    note_data = {
        "user_id": req.user_id,
        "item_id": req.item_id,
        "content": req.content,
    }
    if req.title:
        note_data["title"] = req.title
    if req.tags:
        note_data["tags"] = req.tags

    result = supabase.table("notes").insert(note_data).execute()
    note = result.data[0]

    # Log activity
    supabase.table("activity").insert({
        "user_id": req.user_id,
        "action": "note",
        "item_id": req.item_id,
    }).execute()

    return {"note": note}
