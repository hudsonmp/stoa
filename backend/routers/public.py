"""Public, unauthenticated endpoints for shared content.

Access is gated purely on possession of a high-entropy share token — no
Authorization header, no cookies, no X-User-Id. The lookup query requires
public_share_token IS NOT NULL AND public_share_token = :token, so a cleared
token (unshared) fails closed even if the caller still has the old URL.
"""

import logging

from fastapi import APIRouter, HTTPException

from services.auth import get_supabase_service

logger = logging.getLogger(__name__)

router = APIRouter()


# Fields safe to surface to anonymous readers. Notably we exclude
# scroll_position (reading-state leak) and reading_status (private signal).
_PUBLIC_ITEM_FIELDS = [
    "id",
    "url",
    "title",
    "type",
    "favicon_url",
    "cover_image_url",
    "domain",
    "summary",
    "extracted_text",
    "metadata",
    "public_shared_at",
    "created_at",
    "user_id",
]


@router.get("/items/{token}")
async def get_public_item(token: str):
    """Return a shared item by token. No auth required.

    Returns the item, its highlights, the primary source note (if any),
    citation, and the owner's public profile (username + display_name).
    """
    if not token or len(token) < 10:
        raise HTTPException(status_code=404, detail="Not found")

    supabase = get_supabase_service()

    # Single filter does all the work: not null AND matches.
    item_res = (
        supabase.table("items")
        .select(",".join(_PUBLIC_ITEM_FIELDS))
        .eq("public_share_token", token)
        .limit(1)
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Not found")

    item = item_res.data[0]
    item_id = item["id"]
    owner_id = item.pop("user_id", None)

    # Highlights (order by creation so the reader sees them in sequence).
    hl_res = (
        supabase.table("highlights")
        .select("id, text, context, color, note, created_at")
        .eq("item_id", item_id)
        .order("created_at")
        .execute()
    )

    # Only the primary source note (tagged "source-note"). Scratch notes
    # without that tag are treated as private and not exposed publicly.
    note_res = (
        supabase.table("notes")
        .select("id, title, content, tags, created_at, updated_at")
        .eq("item_id", item_id)
        .execute()
    )
    notes = note_res.data or []
    source_note = next(
        (n for n in notes if "source-note" in (n.get("tags") or [])),
        None,
    )

    # Citation metadata (abstract, authors, venue) — already public info.
    cit_res = (
        supabase.table("citations")
        .select("authors, year, venue, doi, arxiv_id, abstract")
        .eq("item_id", item_id)
        .execute()
    )

    # Owner's public profile — username + display name only. Never the
    # raw auth.users id or email.
    owner = None
    if owner_id:
        try:
            prof_res = (
                supabase.table("profiles")
                .select("username, display_name, avatar_url")
                .eq("user_id", owner_id)
                .limit(1)
                .execute()
            )
            if prof_res.data:
                owner = prof_res.data[0]
        except Exception as e:
            logger.debug("Owner profile lookup failed: %s", e)

    return {
        "item": item,
        "highlights": hl_res.data or [],
        "source_note": source_note,
        "citation": cit_res.data[0] if cit_res.data else None,
        "owner": owner,
    }
