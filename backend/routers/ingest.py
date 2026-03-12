"""Ingest endpoints: URL, PDF, arXiv."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id
from services.url_validator import validate_url
from services.extraction import extract_from_url, extract_from_pdf, fetch_arxiv_metadata
from services.embedding import chunk_and_embed

router = APIRouter()


class IngestURLRequest(BaseModel):
    url: str
    type: str = "blog"
    tags: list[str] = []
    person_ids: list[str] = []
    collection_id: Optional[str] = None


class MetadataRequest(BaseModel):
    url: str


@router.post("")
async def ingest_url(req: IngestURLRequest, request: Request):
    """Extract content from URL, chunk, embed, and store."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Validate URL against SSRF
    validate_url(req.url)

    # Check for duplicate: return existing item if URL already saved
    existing = (
        supabase.table("items")
        .select("id, title, url")
        .eq("user_id", user_id)
        .eq("url", req.url)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"item": existing.data[0], "chunks_created": 0, "deduplicated": True}

    # Extract content
    extracted = await extract_from_url(req.url)

    # Create item
    item_data = {
        "user_id": user_id,
        "url": req.url,
        "title": extracted["title"],
        "type": req.type,
        "domain": extracted["domain"],
        "favicon_url": extracted["favicon_url"],
        "extracted_text": extracted["extracted_text"],
        "reading_status": "to_read",
    }

    result = supabase.table("items").insert(item_data).execute()
    item = result.data[0]
    item_id = item["id"]

    # Link to people
    for person_id in req.person_ids:
        supabase.table("person_items").insert({
            "person_id": person_id,
            "item_id": item_id,
            "relation": "authored",
        }).execute()

    # Add tags
    for tag_name in req.tags:
        tag_result = supabase.table("tags").upsert(
            {"user_id": user_id, "name": tag_name},
            on_conflict="user_id,name",
        ).execute()
        tag_id = tag_result.data[0]["id"]
        supabase.table("item_tags").insert({
            "item_id": item_id,
            "tag_id": tag_id,
        }).execute()

    # Add to collection
    if req.collection_id:
        supabase.table("collection_items").insert({
            "collection_id": req.collection_id,
            "item_id": item_id,
            "sort_order": 0,
        }).execute()

    # Chunk and embed
    chunks = await chunk_and_embed(
        extracted["extracted_text"],
        item_id,
        metadata={"type": req.type, "domain": extracted["domain"]},
    )
    if chunks:
        supabase.table("chunks").insert(chunks).execute()

    # Log activity
    supabase.table("activity").insert({
        "user_id": user_id,
        "action": "save",
        "item_id": item_id,
    }).execute()

    return {"item": item, "chunks_created": len(chunks)}


@router.post("/pdf")
async def ingest_pdf(
    request: Request,
    file: UploadFile = File(...),
    title: Optional[str] = None,
):
    """Upload and process a PDF."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Enforce 50MB upload limit
    MAX_PDF_SIZE = 50 * 1024 * 1024
    pdf_bytes = await file.read()
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise HTTPException(status_code=413, detail="PDF exceeds 50MB limit")
    extracted = extract_from_pdf(pdf_bytes)

    # Sanitize filename to prevent path traversal
    import os as _os
    import uuid as _uuid
    safe_filename = _os.path.basename(file.filename or "upload.pdf").replace("..", "")
    if not safe_filename:
        safe_filename = f"{_uuid.uuid4().hex}.pdf"
    storage_path = f"{user_id}/pdfs/{safe_filename}"
    supabase.storage.from_("documents").upload(storage_path, pdf_bytes)

    item_data = {
        "user_id": user_id,
        "title": title or extracted["title"],
        "type": "paper",
        "extracted_text": extracted["extracted_text"],
        "metadata": {"page_count": extracted["page_count"], "pdf_storage_path": storage_path},
        "reading_status": "to_read",
    }

    result = supabase.table("items").insert(item_data).execute()
    item = result.data[0]

    # Chunk and embed
    chunks = await chunk_and_embed(extracted["extracted_text"], item["id"])
    if chunks:
        supabase.table("chunks").insert(chunks).execute()

    return {"item": item, "chunks_created": len(chunks)}


@router.post("/arxiv/{arxiv_id}")
async def ingest_arxiv(arxiv_id: str, request: Request):
    """Fetch and process an arXiv paper by ID."""
    import httpx

    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    meta = await fetch_arxiv_metadata(arxiv_id)

    # Duplicate check: if we already have this arXiv paper, return it
    arxiv_url = f"https://arxiv.org/abs/{meta['arxiv_id']}"
    existing = (
        supabase.table("items")
        .select("id, title, url")
        .eq("user_id", user_id)
        .eq("url", arxiv_url)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"item": existing.data[0], "chunks_created": 0, "deduplicated": True}

    # Download PDF
    async with httpx.AsyncClient(timeout=60) as client:
        pdf_resp = await client.get(meta["pdf_url"])
        pdf_bytes = pdf_resp.content

    extracted = extract_from_pdf(pdf_bytes)

    # Upload PDF to storage
    storage_path = f"{user_id}/pdfs/arxiv_{meta['arxiv_id']}.pdf"
    supabase.storage.from_("documents").upload(storage_path, pdf_bytes)

    # Create item
    item_data = {
        "user_id": user_id,
        "url": meta["url"],
        "title": meta["title"],
        "type": "paper",
        "domain": "arxiv.org",
        "extracted_text": extracted["extracted_text"],
        "reading_status": "to_read",
    }
    result = supabase.table("items").insert(item_data).execute()
    item = result.data[0]

    # Create citation
    citation_data = {
        "item_id": item["id"],
        "authors": meta["authors"],
        "year": meta["year"],
        "arxiv_id": meta["arxiv_id"],
        "abstract": meta["abstract"],
        "pdf_storage_path": storage_path,
    }
    supabase.table("citations").insert(citation_data).execute()

    # Link authors as people (create if needed)
    for author in meta["authors"]:
        existing = (
            supabase.table("people")
            .select("id")
            .eq("user_id", user_id)
            .eq("name", author["name"])
            .execute()
        )
        if existing.data:
            person_id = existing.data[0]["id"]
        else:
            person_result = supabase.table("people").insert({
                "user_id": user_id,
                "name": author["name"],
                "role": "researcher",
            }).execute()
            person_id = person_result.data[0]["id"]

        supabase.table("person_items").insert({
            "person_id": person_id,
            "item_id": item["id"],
            "relation": "authored",
        }).execute()

    # Chunk and embed
    chunks = await chunk_and_embed(extracted["extracted_text"], item["id"])
    if chunks:
        supabase.table("chunks").insert(chunks).execute()

    return {"item": item, "citation": citation_data, "chunks_created": len(chunks)}


@router.post("/metadata")
async def extract_metadata(req: MetadataRequest, request: Request):
    """Quick metadata extraction from a URL (no full ingest)."""
    await get_user_id(request)
    validate_url(req.url)
    extracted = await extract_from_url(req.url)
    return {
        "title": extracted["title"],
        "author": extracted["author"],
        "domain": extracted["domain"],
        "favicon_url": extracted["favicon_url"],
    }
