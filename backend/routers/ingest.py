"""Ingest endpoints: URL, PDF, arXiv."""

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from supabase import create_client

from services.extraction import extract_from_url, extract_from_pdf, fetch_arxiv_metadata
from services.embedding import chunk_and_embed

router = APIRouter()


def get_supabase():
    return create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY"),
    )


class IngestURLRequest(BaseModel):
    url: str
    user_id: str
    type: str = "blog"
    tags: list[str] = []
    person_ids: list[str] = []
    collection_id: Optional[str] = None


class MetadataRequest(BaseModel):
    url: str


@router.post("")
async def ingest_url(req: IngestURLRequest):
    """Extract content from URL, chunk, embed, and store."""
    supabase = get_supabase()

    # Extract content
    extracted = await extract_from_url(req.url)

    # Create item
    item_data = {
        "user_id": req.user_id,
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
        # Upsert tag
        tag_result = supabase.table("tags").upsert(
            {"user_id": req.user_id, "name": tag_name},
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
        "user_id": req.user_id,
        "action": "save",
        "item_id": item_id,
    }).execute()

    return {"item": item, "chunks_created": len(chunks)}


@router.post("/pdf")
async def ingest_pdf(
    user_id: str,
    file: UploadFile = File(...),
    title: Optional[str] = None,
):
    """Upload and process a PDF."""
    supabase = get_supabase()

    pdf_bytes = await file.read()
    extracted = extract_from_pdf(pdf_bytes)

    # Upload to Supabase Storage
    storage_path = f"{user_id}/pdfs/{file.filename}"
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
async def ingest_arxiv(arxiv_id: str, user_id: str):
    """Fetch and process an arXiv paper by ID."""
    import httpx

    supabase = get_supabase()
    meta = await fetch_arxiv_metadata(arxiv_id)

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
        # Check if person exists
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
async def extract_metadata(req: MetadataRequest):
    """Quick metadata extraction from a URL (no full ingest)."""
    extracted = await extract_from_url(req.url)
    return {
        "title": extracted["title"],
        "author": extracted["author"],
        "domain": extracted["domain"],
        "favicon_url": extracted["favicon_url"],
    }
