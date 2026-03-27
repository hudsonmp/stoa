"""Item list/detail endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("")
async def list_items(
    request: Request,
    status: Optional[str] = None,
    type: Optional[str] = None,
    limit: int = 200,
):
    """List items for the authenticated user."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Use lightweight select for list view (skip extracted_text which can be huge)
    select_fields = "id, user_id, url, title, type, favicon_url, cover_image_url, spine_color, text_color, domain, scroll_position, reading_status, metadata, summary, created_at"
    query = (
        supabase.table("items")
        .select(select_fields)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if status:
        query = query.eq("reading_status", status)
    if type:
        query = query.eq("type", type)

    result = query.execute()
    return {"items": result.data or []}


@router.get("/counts")
async def get_item_counts(request: Request):
    """Return item counts by reading_status and type. Lightweight endpoint for sidebar."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("items")
        .select("reading_status, type")
        .eq("user_id", user_id)
        .execute()
    )
    items = result.data or []

    return {
        "to_read": sum(1 for i in items if i["reading_status"] == "to_read" and i["type"] != "writing"),
        "read": sum(1 for i in items if i["reading_status"] == "read" and i["type"] != "writing"),
        "writing": sum(1 for i in items if i["type"] == "writing"),
        "total": len(items),
    }


@router.get("/papers/by-topic")
async def papers_by_topic(request: Request, limit: int = 200):
    """Return papers grouped by research topic using keyword classification.

    Combines item metadata (propositions), citation data (abstract, venue),
    and item tags to assign each paper a topic label.
    """
    from services.topic_classifier import classify_papers_batch

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Fetch papers
    select_fields = (
        "id, user_id, url, title, type, favicon_url, cover_image_url, "
        "spine_color, text_color, domain, reading_status, metadata, summary, created_at"
    )
    papers_res = (
        supabase.table("items")
        .select(select_fields)
        .eq("user_id", user_id)
        .eq("type", "paper")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    papers = papers_res.data or []
    if not papers:
        return {"groups": {}, "total": 0}

    paper_ids = [p["id"] for p in papers]

    # Fetch citations for these papers (abstract + venue)
    citations_res = (
        supabase.table("citations")
        .select("item_id, abstract, venue")
        .in_("item_id", paper_ids)
        .execute()
    )
    citations_map = {c["item_id"]: c for c in (citations_res.data or [])}

    # Fetch tags for these papers
    tags_res = (
        supabase.table("item_tags")
        .select("item_id, tags(name)")
        .in_("item_id", paper_ids)
        .execute()
    )
    tags_map: dict[str, list[str]] = {}
    for row in tags_res.data or []:
        iid = row["item_id"]
        tag_name = row.get("tags", {}).get("name")
        if tag_name:
            tags_map.setdefault(iid, []).append(tag_name)

    groups = classify_papers_batch(papers, citations_map, tags_map)

    return {
        "groups": {
            topic: {"papers": topic_papers, "count": len(topic_papers)}
            for topic, topic_papers in groups.items()
        },
        "total": len(papers),
    }


@router.get("/collections")
async def list_collections(request: Request):
    """List all collections for the authenticated user, with item counts."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("collections")
        .select("id, name, description")
        .eq("user_id", user_id)
        .order("name")
        .execute()
    )
    collections = result.data or []

    # Fetch item counts per collection
    if collections:
        col_ids = [c["id"] for c in collections]
        counts_res = (
            supabase.table("collection_items")
            .select("collection_id")
            .in_("collection_id", col_ids)
            .execute()
        )
        count_map: dict[str, int] = {}
        for row in counts_res.data or []:
            cid = row["collection_id"]
            count_map[cid] = count_map.get(cid, 0) + 1
        for c in collections:
            c["item_count"] = count_map.get(c["id"], 0)

    return {"collections": collections}


@router.post("/collections")
async def create_collection(request: Request):
    """Create a new collection."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    result = supabase.table("collections").insert({
        "user_id": user_id,
        "name": name,
        "description": body.get("description", ""),
    }).execute()

    return {"collection": result.data[0]}


@router.patch("/collections/{collection_id}")
async def rename_collection(collection_id: str, request: Request):
    """Rename a collection."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    result = (
        supabase.table("collections")
        .update({"name": name})
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"collection": result.data[0]}


@router.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str, request: Request):
    """Delete a collection (does not delete the items in it)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Delete collection_items links first
    supabase.table("collection_items").delete().eq("collection_id", collection_id).execute()

    result = (
        supabase.table("collections")
        .delete()
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"deleted": True, "id": collection_id}


@router.post("/collections/{collection_id}/items")
async def add_item_to_collection(collection_id: str, request: Request):
    """Add an item to a collection."""
    import logging
    logger = logging.getLogger(__name__)
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")

    try:
        # Check for duplicate first
        existing = (
            supabase.table("collection_items")
            .select("collection_id")
            .eq("collection_id", collection_id)
            .eq("item_id", item_id)
            .execute()
        )
        if existing.data:
            return {"already_exists": True}

        # Insert
        supabase.table("collection_items").insert({
            "collection_id": collection_id,
            "item_id": item_id,
            "sort_order": 0,
        }).execute()
        return {"added": True}
    except Exception as e:
        logger.error("Failed to add item %s to collection %s: %s", item_id, collection_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/collections/{collection_id}/items")
async def get_collection_items(collection_id: str, request: Request):
    """Get all items in a collection."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    links = supabase.table("collection_items").select("item_id").eq("collection_id", collection_id).execute()
    if not links.data:
        return {"items": []}

    item_ids = [r["item_id"] for r in links.data]
    items_res = (
        supabase.table("items")
        .select("id, title, url, type, domain, favicon_url, reading_status, created_at")
        .eq("user_id", user_id)
        .in_("id", item_ids)
        .execute()
    )
    return {"items": items_res.data or []}


@router.get("/collections/{collection_id}/count")
async def get_collection_item_count(collection_id: str, request: Request):
    """Get item count for a collection."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = supabase.table("collection_items").select("item_id").eq("collection_id", collection_id).execute()
    return {"count": len(result.data or [])}


@router.get("/by-url")
async def get_item_by_url(request: Request, url: str):
    """Look up an item by URL. Used by Chrome extension for scroll sync.
    Also returns collection_ids and person_ids for sidebar pre-selection."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("items")
        .select("id, title, url, type, reading_status, scroll_position")
        .eq("user_id", user_id)
        .eq("url", url)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found for this URL")

    item = result.data[0]
    item_id = item["id"]

    # Fetch collection links
    col_links = (
        supabase.table("collection_items")
        .select("collection_id")
        .eq("item_id", item_id)
        .execute()
    )
    item["collection_ids"] = [r["collection_id"] for r in (col_links.data or [])]

    # Fetch person links
    person_links = (
        supabase.table("person_items")
        .select("person_id")
        .eq("item_id", item_id)
        .execute()
    )
    item["person_ids"] = [r["person_id"] for r in (person_links.data or [])]

    return {"item": item}


@router.get("/{item_id}")
async def get_item(item_id: str, request: Request):
    """Get a single item with highlights, notes, and citation."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

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

    # Fetch related data in parallel-ish
    hl_res = (
        supabase.table("highlights")
        .select("*")
        .eq("item_id", item_id)
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    note_res = (
        supabase.table("notes")
        .select("*")
        .eq("item_id", item_id)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    cit_res = (
        supabase.table("citations")
        .select("*")
        .eq("item_id", item_id)
        .execute()
    )
    # Related items: try embedding similarity first, fall back to same-type
    related = []
    try:
        related_res = supabase.rpc("find_related_items", {
            "source_item_id": item_id,
            "filter_user_id": user_id,
            "match_count": 4,
        }).execute()
        related = related_res.data or []
    except Exception:
        logger.debug("find_related_items RPC unavailable, falling back to type match")

    if not related:
        fallback_res = (
            supabase.table("items")
            .select("id, title, url, type, domain, favicon_url")
            .eq("user_id", user_id)
            .eq("type", item_res.data["type"])
            .neq("id", item_id)
            .order("created_at", desc=True)
            .limit(4)
            .execute()
        )
        related = fallback_res.data or []

    return {
        "item": item_res.data,
        "highlights": hl_res.data or [],
        "notes": note_res.data or [],
        "citation": cit_res.data[0] if cit_res.data else None,
        "related": related,
    }


@router.patch("/{item_id}")
async def update_item(item_id: str, request: Request):
    """Update item fields (e.g. reading_status)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    # Only allow safe fields
    allowed = {"reading_status", "title", "type", "summary", "scroll_position", "spine_color", "text_color", "cover_image_url"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("items")
        .update(updates)
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"item": result.data[0]}


@router.put("/{item_id}/tags")
async def set_item_tags(item_id: str, request: Request):
    """Replace all tags on an item. Body: {"tags": ["tag1", "tag2"]}"""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()
    tag_names: list[str] = body.get("tags", [])

    # Verify item belongs to user
    item_res = (
        supabase.table("items").select("id").eq("id", item_id).eq("user_id", user_id).execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    # Clear existing tags
    supabase.table("item_tags").delete().eq("item_id", item_id).execute()

    # Upsert + link new tags
    linked = []
    for name in tag_names:
        name = name.strip().lower()
        if not name:
            continue
        tag_res = supabase.table("tags").upsert(
            {"user_id": user_id, "name": name}, on_conflict="user_id,name"
        ).execute()
        tag_id = tag_res.data[0]["id"]
        supabase.table("item_tags").insert({"item_id": item_id, "tag_id": tag_id}).execute()
        linked.append(name)

    return {"tags": linked}


@router.get("/{item_id}/tags")
async def get_item_tags(item_id: str, request: Request):
    """Get tags for an item."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("item_tags")
        .select("tag_id, tags(name)")
        .eq("item_id", item_id)
        .execute()
    )
    tags = [row["tags"]["name"] for row in (result.data or []) if row.get("tags")]
    return {"tags": tags}


@router.get("/{item_id}/pdf")
async def get_item_pdf(item_id: str, request: Request, user_id: str | None = None):
    """Serve the stored PDF with correct Content-Type.
    Accepts user_id as query param for embed/iframe use (can't send headers)."""
    from fastapi.responses import Response
    if not user_id:
        user_id = await get_user_id(request)
    supabase = get_supabase_service()

    item_res = (
        supabase.table("items")
        .select("metadata")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    meta = item_res.data.get("metadata") or {}
    storage_path = meta.get("pdf_storage_path")
    if not storage_path:
        raise HTTPException(status_code=404, detail="No PDF stored for this item")

    pdf_bytes = supabase.storage.from_("documents").download(storage_path)
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.post("/{item_id}/re-extract")
async def re_extract_item(item_id: str, request: Request):
    """Re-extract content for an item using the latest extraction pipeline.
    For papers with stored PDFs, re-runs pymupdf4llm markdown extraction."""
    import httpx
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

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

    item = item_res.data
    url = item.get("url", "")

    # For arXiv papers: download PDF and re-extract
    import re
    arxiv_match = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)", url)
    if arxiv_match:
        arxiv_id = arxiv_match.group(1)
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        async with httpx.AsyncClient(verify=False, timeout=60, follow_redirects=True) as client:
            pdf_resp = await client.get(pdf_url)
            pdf_bytes = pdf_resp.content

        from services.extraction import extract_from_pdf
        extracted = extract_from_pdf(pdf_bytes)

        # Merge is_two_column into existing metadata
        existing_meta = item.get("metadata") or {}
        existing_meta["is_two_column"] = extracted.get("is_two_column", False)

        supabase.table("items").update({
            "extracted_text": extracted["extracted_text"],
            "metadata": existing_meta,
        }).eq("id", item_id).execute()

        return {"success": True, "text_length": len(extracted["extracted_text"]), "is_two_column": extracted.get("is_two_column", False)}

    # For items with URLs: re-extract from URL
    if url:
        from services.extraction import extract_from_url
        extracted = await extract_from_url(url)
        supabase.table("items").update({
            "extracted_text": extracted["extracted_text"],
        }).eq("id", item_id).execute()
        return {"success": True, "text_length": len(extracted["extracted_text"] or "")}

    return {"success": False, "error": "No URL or PDF to re-extract from"}


@router.delete("/{item_id}")
async def delete_item(item_id: str, request: Request):
    """Delete an item and all its related data (cascades via FK constraints)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

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


@router.get("/quick-search")
async def quick_search(request: Request, q: str = "", limit: int = 8):
    """Fast title prefix search for @ mentions. No embeddings, just ILIKE."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    if not q or len(q) < 2:
        return {"results": []}
    result = (
        supabase.table("items")
        .select("id, title, type, domain")
        .eq("user_id", user_id)
        .ilike("title", f"%{q}%")
        .limit(limit)
        .execute()
    )
    return {"results": result.data or []}


@router.get("/{item_id}/proxy")
async def proxy_page(item_id: str, request: Request, user_id: str | None = None):
    """Proxy an item's URL to bypass X-Frame-Options restrictions."""
    import httpx
    from fastapi.responses import HTMLResponse
    if not user_id:
        user_id = await get_user_id(request)
    supabase = get_supabase_service()

    item_res = (
        supabase.table("items")
        .select("url")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item_res.data or not item_res.data.get("url"):
        raise HTTPException(status_code=404, detail="Item or URL not found")

    url = item_res.data["url"]
    async with httpx.AsyncClient(verify=False, timeout=30, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})

    # Inject base tag so relative URLs resolve correctly
    from urllib.parse import urlparse
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    html = resp.text
    if "<head>" in html:
        html = html.replace("<head>", f'<head><base href="{base_url}">', 1)
    elif "<HEAD>" in html:
        html = html.replace("<HEAD>", f'<HEAD><base href="{base_url}">', 1)

    return HTMLResponse(content=html, status_code=200)
