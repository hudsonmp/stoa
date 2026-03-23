"""People list/detail endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()


class CreatePersonRequest(BaseModel):
    name: str
    affiliation: Optional[str] = None
    role: str = "intellectual hero"
    email: Optional[str] = None
    website_url: Optional[str] = None
    twitter_handle: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
async def list_people(request: Request):
    """List people for the authenticated user."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("people")
        .select("*")
        .eq("user_id", user_id)
        .order("name")
        .execute()
    )
    return {"people": result.data or []}


@router.post("")
async def create_person(req: CreatePersonRequest, request: Request):
    """Create a new person."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = supabase.table("people").insert({
        "user_id": user_id,
        "name": req.name,
        "affiliation": req.affiliation,
        "role": req.role,
        "website_url": req.website_url,
        "twitter_handle": req.twitter_handle,
        "notes": req.notes,
    }).execute()

    return {"person": result.data[0]}


@router.get("/authors")
async def list_authors(request: Request):
    """List people who have authored at least one paper, with paper counts."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Get all person_items with relation=authored
    links = (
        supabase.table("person_items")
        .select("person_id, item_id")
        .eq("relation", "authored")
        .execute()
    )
    if not links.data:
        return {"authors": []}

    # Count papers per person
    from collections import Counter
    person_ids = [l["person_id"] for l in links.data]
    paper_counts = Counter(person_ids)

    # Get unique person records
    unique_ids = list(paper_counts.keys())
    people_res = (
        supabase.table("people")
        .select("*")
        .eq("user_id", user_id)
        .in_("id", unique_ids)
        .order("name")
        .execute()
    )

    # Filter out garbage names from PDF metadata extraction
    GARBAGE_NAMES = {
        "pdf download", "total citations:", "total downloads:", "canada",
        "cambridge", "open access", "research-article", "view all",
        "united states", "germany", "australia", "china", "india",
    }

    # Attach paper_count to each person, filter garbage
    authors = []
    for p in (people_res.data or []):
        name_lower = p["name"].strip().lower()
        if name_lower in GARBAGE_NAMES or len(p["name"].strip()) < 3:
            continue
        p["paper_count"] = paper_counts.get(p["id"], 0)
        authors.append(p)

    # Sort by paper count descending, then name
    authors.sort(key=lambda a: (-a["paper_count"], a["name"]))

    return {"authors": authors}


@router.post("/{person_id}/resolve-email")
async def resolve_email(person_id: str, request: Request):
    """Try to find a person's email via faculty page scraping."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    person_res = (
        supabase.table("people")
        .select("*")
        .eq("id", person_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not person_res.data:
        raise HTTPException(status_code=404, detail="Person not found")

    person = person_res.data
    from services.faculty_lookup import resolve_faculty_email
    email = await resolve_faculty_email(person["name"], person.get("affiliation"))

    if email:
        # Store in bio field (until email column migration)
        supabase.table("people").update({"bio": email}).eq("id", person_id).execute()
        return {"email": email, "resolved": True}

    return {"email": None, "resolved": False}


@router.patch("/{person_id}")
async def update_person(person_id: str, request: Request):
    """Update person fields."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    allowed = {"name", "affiliation", "role", "website_url", "twitter_handle", "notes", "bio", "tags"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("people")
        .update(updates)
        .eq("id", person_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")

    return {"person": result.data[0]}


@router.get("/{person_id}")
async def get_person(person_id: str, request: Request):
    """Get a person with their items."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    person_res = (
        supabase.table("people")
        .select("*")
        .eq("id", person_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not person_res.data:
        raise HTTPException(status_code=404, detail="Person not found")

    # Get items linked to this person
    links = (
        supabase.table("person_items")
        .select("item_id, relation")
        .eq("person_id", person_id)
        .execute()
    )
    item_ids = [l["item_id"] for l in (links.data or [])]
    items = []
    if item_ids:
        items_res = (
            supabase.table("items")
            .select("id, title, url, type, domain, favicon_url, reading_status, created_at")
            .in_("id", item_ids)
            .execute()
        )
        items = items_res.data or []

    return {
        "person": person_res.data,
        "items": items,
    }


@router.post("/{person_id}/items")
async def link_item_to_person(person_id: str, request: Request):
    """Link an item to a person (e.g., authored, referenced)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    item_id = body.get("item_id")
    relation = body.get("relation", "authored")
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id required")

    # Check for existing link
    existing = (
        supabase.table("person_items")
        .select("id")
        .eq("person_id", person_id)
        .eq("item_id", item_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"linked": True, "existing": True}

    try:
        supabase.table("person_items").insert({
            "person_id": person_id,
            "item_id": item_id,
            "relation": relation,
        }).execute()
    except Exception:
        pass  # duplicate constraint

    return {"linked": True}


@router.delete("/{person_id}")
async def delete_person(person_id: str, request: Request):
    """Delete a person and their connections (cascades via FK constraints)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("people")
        .delete()
        .eq("id", person_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")

    return {"deleted": True, "id": person_id}
