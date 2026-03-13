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
