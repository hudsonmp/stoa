"""Project-scoped highlights CRUD (fork of routers/highlights.py).

W3C Web Annotation support
──────────────────────────
`selectors` is a jsonb array of W3C Web Annotation selectors:
  [
    {"type": "TextQuoteSelector",    "exact": "...", "prefix": "...", "suffix": "..."},
    {"type": "TextPositionSelector", "start": 42,   "end": 58},
    {"type": "FragmentSelector",     "value": "page=3"}
  ]

The frontend three-tier resolver (ProjectPdfAnnotationView) tries
TextPositionSelector first, then TextQuoteSelector, then falls back to a
substring match on `text`. Storing all three makes the highlight robust to
ligature repair drift and page re-rendering.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.auth import get_supabase_service, get_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateProjectHighlightRequest(BaseModel):
    item_id: str
    project_id: Optional[str] = None
    folder_id: Optional[str] = None
    text: str
    context: Optional[str] = None
    css_selector: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    color: str = Field(default="yellow", pattern="^(yellow|green|blue|pink|purple)$")
    note: Optional[str] = None
    page_number: Optional[int] = None
    # W3C Web Annotation selectors computed by the client from pdfjs TextItem positions.
    selectors: Optional[list[Any]] = None


@router.post("")
async def create_project_highlight(
    req: CreateProjectHighlightRequest, request: Request
):
    """Save a project-scoped highlight and enqueue for spaced repetition."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Verify the item belongs to this user
    item_check = (
        supabase.table("items")
        .select("id")
        .eq("id", req.item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not item_check.data:
        raise HTTPException(status_code=404, detail="Item not found")

    row: dict[str, Any] = {
        "item_id": req.item_id,
        "user_id": user_id,
        "project_id": req.project_id,
        "folder_id": req.folder_id,
        "text": req.text,
        "context": req.context,
        "css_selector": req.css_selector,
        "start_offset": req.start_offset,
        "end_offset": req.end_offset,
        "color": req.color,
        "note": req.note,
        "page_number": req.page_number,
    }
    if req.selectors is not None:
        row["selectors"] = req.selectors

    result = supabase.table("project_highlights").insert(row).execute()
    highlight = result.data[0]

    # Auto-enqueue for spaced repetition (first review in 24h).
    # review_queue.highlight_id FK points at `highlights.id`, so we only enqueue
    # project highlights if they can be cross-referenced; otherwise skip and
    # let the caller wire SR separately. We attempt insert and swallow failure.
    try:
        supabase.table("review_queue").insert({
            "user_id": user_id,
            "highlight_id": highlight["id"],
            "next_review_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        }).execute()
    except Exception:
        # Project highlights do not share the review_queue FK; fail quietly.
        logger.debug(
            "Skipping review_queue enqueue for project highlight %s (FK mismatch)",
            highlight["id"],
        )

    return {"highlight": highlight}


@router.patch("/{highlight_id}")
async def update_project_highlight(highlight_id: str, request: Request):
    """Update a project highlight (note, color, or selectors)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    allowed = {"note", "color", "selectors", "page_number"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")

    result = (
        supabase.table("project_highlights")
        .update(updates)
        .eq("id", highlight_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project highlight not found")
    return {"highlight": result.data[0]}


@router.get("")
async def get_project_highlights(
    request: Request,
    url: Optional[str] = None,
    item_id: Optional[str] = None,
    project_id: Optional[str] = None,
    folder_id: Optional[str] = None,
):
    """Fetch project highlights by URL / item / project / folder."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    query = supabase.table("project_highlights").select("*").eq("user_id", user_id)

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

    if project_id:
        query = query.eq("project_id", project_id)
    if folder_id:
        query = query.eq("folder_id", folder_id)

    result = query.order("created_at", desc=True).limit(100).execute()
    return {"highlights": result.data or []}


@router.delete("/{highlight_id}")
async def delete_project_highlight(highlight_id: str, request: Request):
    """Delete a project highlight."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Best-effort cleanup of any review_queue row that happens to reference it.
    try:
        supabase.table("review_queue").delete().eq(
            "highlight_id", highlight_id
        ).execute()
    except Exception:
        pass

    result = (
        supabase.table("project_highlights")
        .delete()
        .eq("id", highlight_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project highlight not found")
    return {"deleted": True, "id": highlight_id}
