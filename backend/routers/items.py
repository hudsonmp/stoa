"""Item endpoints: list, detail, update, concept extraction."""

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from supabase import create_client

logger = logging.getLogger(__name__)

router = APIRouter()


def get_supabase():
    return create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY"),
    )


def _get_user_id(request: Request) -> str:
    """Extract user_id from X-User-Id header (dev mode)."""
    user_id = request.headers.get("X-User-Id", "")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    return user_id


@router.get("")
async def list_items(
    request: Request,
    type: Optional[str] = None,
    limit: int = 200,
):
    """List items for the authenticated user."""
    user_id = _get_user_id(request)
    supabase = get_supabase()

    select_fields = "id, user_id, url, title, type, favicon_url, domain, reading_status, metadata, created_at"
    query = (
        supabase.table("items")
        .select(select_fields)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if type:
        query = query.eq("type", type)

    result = query.execute()
    return {"items": result.data or []}


@router.get("/{item_id}")
async def get_item(item_id: str, request: Request):
    """Get a single item."""
    user_id = _get_user_id(request)
    supabase = get_supabase()

    item_res = (
        supabase.table("items")
        .select("*")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"item": item_res.data}


@router.post("/{item_id}/extract-concepts")
async def extract_concepts(item_id: str, request: Request):
    """Run concept extraction on an item and store propositions in metadata.

    Extracts structured claims, methods, findings, limitations, and research
    questions from the item's text using Claude, then stores them in the
    item's metadata.propositions JSONB field.
    """
    from services.concept_extraction import extract_propositions

    user_id = _get_user_id(request)
    supabase = get_supabase()

    item_res = (
        supabase.table("items")
        .select("id, type, extracted_text, metadata")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    item = item_res.data
    extracted_text = item.get("extracted_text") or ""
    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail="Item has no extracted text")

    try:
        propositions = await extract_propositions(extracted_text)
    except Exception as e:
        logger.error("Concept extraction failed for item %s: %s", item_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")

    # Merge into existing metadata (non-destructive)
    existing_metadata = item.get("metadata") or {}
    existing_metadata["propositions"] = propositions

    supabase.table("items").update({
        "metadata": existing_metadata,
    }).eq("id", item_id).execute()

    return {
        "item_id": item_id,
        "propositions": propositions,
        "count": len(propositions),
    }


@router.delete("/{item_id}")
async def delete_item(item_id: str, request: Request):
    """Delete an item."""
    user_id = _get_user_id(request)
    supabase = get_supabase()

    result = (
        supabase.table("items")
        .delete()
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"deleted": True, "id": item_id}
