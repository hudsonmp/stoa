"""Unified mention search — items + people + profiles in one round-trip.

Called by the tiptap @ mention suggestion in ResearchEditor.tsx. Returns
typed results so the frontend can render sectioned suggestions and route
the resulting mention node to the correct page (/item/:id, /people/:id,
/@:username).

Three ILIKE queries run sequentially (supabase-py is synchronous, but
each query finishes in <1ms on the current library size of ~420 items,
~60 people, ~2 profiles).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Request

from services.auth import get_supabase_service, get_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/search")
async def mention_search(request: Request, q: str = "", limit: int = 8):
    """Unified mention search for @ autocomplete.

    Returns items, people, and profiles in one response so the frontend
    makes a single request per debounced keystroke instead of three.
    """
    user_id = await get_user_id(request)
    if not q or len(q.strip()) < 1:
        return {"items": [], "people": [], "profiles": []}

    supabase = get_supabase_service()
    term = q.strip()
    per_section = max(2, limit // 3)

    # Items: title ILIKE
    items_res = (
        supabase.table("items")
        .select("id, title, type, domain")
        .eq("user_id", user_id)
        .ilike("title", f"%{term}%")
        .limit(per_section)
        .execute()
    )

    # People: name ILIKE
    people_res = (
        supabase.table("people")
        .select("id, name, affiliation")
        .eq("user_id", user_id)
        .ilike("name", f"%{term}%")
        .limit(per_section)
        .execute()
    )

    # Profiles (friends / users): username or display_name ILIKE
    term_lower = f"%{term.lower()}%"
    profiles_res = (
        supabase.table("profiles")
        .select("user_id, username, display_name, avatar_url")
        .or_(f"username.ilike.{term_lower},display_name.ilike.{term_lower}")
        .limit(per_section)
        .execute()
    )

    return {
        "items": items_res.data or [],
        "people": people_res.data or [],
        "profiles": profiles_res.data or [],
    }
