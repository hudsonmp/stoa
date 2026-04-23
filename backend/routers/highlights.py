"""Highlight CRUD endpoints."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.auth import get_supabase_service, get_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateHighlightRequest(BaseModel):
    item_id: str
    text: str
    context: Optional[str] = None
    css_selector: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    color: str = Field(default="yellow", pattern="^(yellow|green|blue|pink|purple)$")
    note: Optional[str] = None


@router.post("")
async def create_highlight(req: CreateHighlightRequest, request: Request):
    """Save a highlight and enqueue for spaced repetition."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Verify item belongs to this user
    item_check = (
        supabase.table("items")
        .select("id")
        .eq("id", req.item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not item_check.data:
        raise HTTPException(status_code=404, detail="Item not found")

    result = supabase.table("highlights").insert({
        "item_id": req.item_id,
        "user_id": user_id,
        "text": req.text,
        "context": req.context,
        "css_selector": req.css_selector,
        "start_offset": req.start_offset,
        "end_offset": req.end_offset,
        "color": req.color,
        "note": req.note,
    }).execute()

    highlight = result.data[0]

    # Auto-enqueue for spaced repetition (first review in 24h)
    try:
        supabase.table("review_queue").insert({
            "user_id": user_id,
            "highlight_id": highlight["id"],
            "next_review_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        }).execute()
    except Exception:
        logger.warning("Failed to enqueue highlight %s for review", highlight["id"])

    return {"highlight": highlight}


@router.patch("/{highlight_id}")
async def update_highlight(highlight_id: str, request: Request):
    """Update a highlight (e.g. note, color)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    allowed = {"note", "color"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")

    result = (
        supabase.table("highlights")
        .update(updates)
        .eq("id", highlight_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return {"highlight": result.data[0]}


@router.get("")
async def get_highlights_for_url(
    request: Request,
    url: Optional[str] = None,
    item_id: Optional[str] = None,
):
    """Get highlights by URL or item_id (used by Chrome extension for re-injection)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    query = supabase.table("highlights").select("*").eq("user_id", user_id)

    if item_id:
        query = query.eq("item_id", item_id)
    elif url:
        items = (
            supabase.table("items")
            .select("id")
            .eq("user_id", user_id)
            .eq("url", url)
            .execute()
        )
        if not items.data:
            return {"highlights": []}
        query = query.eq("item_id", items.data[0]["id"])

    result = query.order("created_at", desc=True).limit(100).execute()
    return {"highlights": result.data or []}


@router.delete("/{highlight_id}")
async def delete_highlight(highlight_id: str, request: Request):
    """Delete a highlight and its review queue entry."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Delete review queue entry first (FK constraint)
    supabase.table("review_queue").delete().eq(
        "highlight_id", highlight_id
    ).execute()

    result = (
        supabase.table("highlights")
        .delete()
        .eq("id", highlight_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return {"deleted": True, "id": highlight_id}
