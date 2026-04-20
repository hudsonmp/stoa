"""Signed-URL endpoint for iPad-authored ink overlays.

The Mac daemon uploads per-page PNGs to the `project-sync` bucket at:
    <user_id>/.stoa/ink/<item_id>/p<NNN>.png

The webapp fetches GET /project-items/:id/ink?page=N and receives a
60s-TTL signed URL + the page dimensions (in PDF points) that the
iPad wrote into meta.json. The web renders the PNG as a zoom-stable
absolutely-positioned overlay inside each react-pdf <Page>.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from services.auth import get_supabase_service, get_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/{item_id}/ink")
async def get_ipad_ink(
    item_id: str,
    request: Request,
    page: int = Query(..., ge=1, description="1-based page number"),
):
    """Return a short-lived signed URL for the ink PNG on `item_id`'s page `page`.

    Response:
        {
          "signed_url":      "<60s ttl>",
          "page_width_pt":   612.0,
          "page_height_pt":  792.0,
          "scale":           2.0,
          "sha_png":         "<sha256>",
          "updated_at":      "<iso8601>"
        }

    404 if no ink row exists for (item, page-1). The web component MUST
    treat 404 as "render nothing" — not an error toast.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Verify item ownership.
    item_check = (
        supabase.table("items")
        .select("id")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not item_check.data:
        raise HTTPException(status_code=404, detail="Item not found")

    page_index = page - 1
    row = (
        supabase.table("sync_manifest")
        .select("meta, content_hash, last_synced_at, last_size")
        .eq("user_id", user_id)
        .eq("item_id", item_id)
        .eq("kind", "ink")
        .eq("page_index", page_index)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="No ink for this page")

    meta: Dict[str, Any] = row.data[0].get("meta") or {}
    storage_key = meta.get("storage_key")
    if not storage_key:
        logger.warning("ink row for item=%s page=%s missing storage_key", item_id, page)
        raise HTTPException(status_code=500, detail="Ink storage key missing")

    # Mint a 60s signed URL. supabase-py's create_signed_url returns either
    # {"signedURL": "..."} or {"signedUrl": "..."} depending on version.
    try:
        res = supabase.storage.from_("project-sync").create_signed_url(storage_key, 60)
    except Exception as exc:
        logger.exception("signed url mint failed for %s", storage_key)
        raise HTTPException(status_code=500, detail=f"Signed URL failed: {exc}") from exc

    signed_url = (
        res.get("signedURL")
        or res.get("signedUrl")
        or res.get("signed_url")
    )
    if not signed_url:
        raise HTTPException(status_code=500, detail="Signed URL response malformed")

    return {
        "signed_url": signed_url,
        "page_width_pt": meta.get("page_width_pt"),
        "page_height_pt": meta.get("page_height_pt"),
        "scale": meta.get("scale"),
        "sha_png": row.data[0].get("content_hash"),
        "updated_at": row.data[0].get("last_synced_at"),
    }
