"""Ingest endpoints: URL, PDF, arXiv, book."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id
from services.url_validator import validate_url
from services.extraction import extract_from_url, extract_from_pdf, fetch_arxiv_metadata, extract_authors_and_emails
from services.embedding import chunk_and_embed
from services.citation_resolver import resolve_citation
from services.book_lookup import search_books

logger = logging.getLogger(__name__)

router = APIRouter()


class IngestURLRequest(BaseModel):
    url: str
    type: str = "blog"
    tags: list[str] = []
    person_ids: list[str] = []
    collection_id: Optional[str] = None


class IngestPasteRequest(BaseModel):
    content: str  # Raw text content
    title: Optional[str] = None
    type: str = "writing"
    tags: list[str] = []


class MetadataRequest(BaseModel):
    url: str


class IngestBookRequest(BaseModel):
    title: str
    authors: list[dict] = []  # [{"name": "..."}]
    isbn: Optional[str] = None
    cover_url: Optional[str] = None
    year: Optional[int] = None
    publisher: Optional[str] = None
    page_count: Optional[int] = None
    subjects: list[str] = []
    reading_status: str = "to_read"


import re
from urllib.parse import urlparse

# Domains that should auto-classify as "paper"
PAPER_DOMAINS = {
    "arxiv.org", "dl.acm.org", "link.springer.com", "ieeexplore.ieee.org",
    "aclanthology.org", "openreview.net", "proceedings.mlr.press",
    "papers.nips.cc", "semanticscholar.org", "scholar.google.com",
    "nature.com", "science.org", "biorxiv.org", "medrxiv.org",
}

def _extract_arxiv_id(url: str) -> str | None:
    """Extract arXiv ID from various URL formats."""
    m = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)", url)
    return m.group(1) if m else None

def _is_paper_url(url: str) -> bool:
    """Check if URL is from a known academic paper domain."""
    from urllib.parse import urlparse
    try:
        host = urlparse(url).hostname or ""
        return any(host.endswith(d) for d in PAPER_DOMAINS)
    except Exception:
        return False


@router.post("")
async def ingest_url(req: IngestURLRequest, request: Request):
    """Extract content from URL, chunk, embed, and store."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Validate URL against SSRF
    validate_url(req.url)

    # Auto-detect arXiv URLs and delegate to the arXiv pipeline
    arxiv_id = _extract_arxiv_id(req.url)
    if arxiv_id:
        return await ingest_arxiv(arxiv_id, request)

    # Auto-detect direct PDF URLs — download and process as PDF
    if req.url.lower().endswith(".pdf"):
        import httpx
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                pdf_resp = await client.get(req.url)
                if pdf_resp.headers.get("content-type", "").startswith("application/pdf") or req.url.endswith(".pdf"):
                    from fastapi import UploadFile
                    from io import BytesIO
                    # Route through the PDF pipeline
                    extracted = extract_from_pdf(pdf_resp.content)
                    item_data = {
                        "user_id": user_id,
                        "url": req.url,
                        "title": extracted["title"] if extracted["title"] != "Untitled PDF" else req.url.split("/")[-1].replace(".pdf", ""),
                        "type": "paper",
                        "domain": extracted.get("domain") or urlparse(req.url).hostname,
                        "extracted_text": extracted["extracted_text"],
                        "metadata": {"page_count": extracted["page_count"], "is_two_column": extracted.get("is_two_column", False)},
                        "reading_status": "to_read",
                    }
                    result = supabase.table("items").insert(item_data).execute()
                    item = result.data[0]
                    # Non-fatal embedding
                    chunks = []
                    try:
                        chunks = await chunk_and_embed(extracted["extracted_text"], item["id"])
                        if chunks:
                            supabase.table("chunks").insert(chunks).execute()
                    except Exception:
                        pass
                    return {"item": item, "chunks_created": len(chunks)}
        except Exception:
            logger.warning("Direct PDF download failed for %s, falling back to URL extraction", req.url)

    # Auto-classify paper URLs
    if req.type in ("blog", "page") and _is_paper_url(req.url):
        req.type = "paper"

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

    # Auto-link extracted author to existing people (D2)
    if extracted.get("author"):
        _link_author_to_item(supabase, user_id, extracted["author"], item_id)

    # Auto-resolve citation for papers (C)
    citation_data = None
    if req.type == "paper":
        try:
            citation_data = await resolve_citation(
                url=req.url,
                title=extracted["title"],
                text=(extracted.get("extracted_text") or "")[:3000],
            )
            if citation_data:
                supabase.table("citations").insert({
                    "item_id": item_id,
                    "authors": citation_data.get("authors"),
                    "year": citation_data.get("year"),
                    "venue": citation_data.get("venue"),
                    "doi": citation_data.get("doi"),
                    "arxiv_id": citation_data.get("arxiv_id"),
                    "abstract": citation_data.get("abstract"),
                    "bibtex": citation_data.get("bibtex"),
                }).execute()
                # Link citation authors as people
                for author in citation_data.get("authors", []):
                    _link_or_create_person(supabase, user_id, author["name"], item_id)
        except Exception:
            logger.warning("Citation resolution failed for %s", req.url, exc_info=True)

    # Log activity
    supabase.table("activity").insert({
        "user_id": user_id,
        "action": "save",
        "item_id": item_id,
    }).execute()

    return {"item": item, "chunks_created": len(chunks), "citation": citation_data}


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
    try:
        supabase.storage.from_("documents").upload(storage_path, pdf_bytes)
    except Exception:
        try:
            supabase.storage.from_("documents").update(storage_path, pdf_bytes)
        except Exception:
            logger.warning("PDF storage failed for %s, continuing", storage_path)

    item_data = {
        "user_id": user_id,
        "title": title or extracted["title"],
        "type": "paper",
        "extracted_text": extracted["extracted_text"],
        "metadata": {"page_count": extracted["page_count"], "pdf_storage_path": storage_path, "is_two_column": extracted.get("is_two_column", False)},
        "reading_status": "to_read",
    }

    result = supabase.table("items").insert(item_data).execute()
    item = result.data[0]

    # Chunk and embed (non-fatal)
    chunks = []
    try:
        chunks = await chunk_and_embed(extracted["extracted_text"], item["id"])
        if chunks:
            supabase.table("chunks").insert(chunks).execute()
    except Exception:
        logger.warning("Embedding failed for PDF %s, paper saved without chunks", safe_filename)

    # Auto-resolve citation for PDFs (C)
    citation_data = None
    try:
        citation_data = await resolve_citation(
            title=title or extracted["title"],
            text=(extracted.get("extracted_text") or "")[:3000],
        )
        if citation_data:
            supabase.table("citations").insert({
                "item_id": item["id"],
                "authors": citation_data.get("authors"),
                "year": citation_data.get("year"),
                "venue": citation_data.get("venue"),
                "doi": citation_data.get("doi"),
                "arxiv_id": citation_data.get("arxiv_id"),
                "abstract": citation_data.get("abstract"),
                "bibtex": citation_data.get("bibtex"),
                "pdf_storage_path": storage_path,
            }).execute()
            for author in citation_data.get("authors", []):
                _link_or_create_person(supabase, user_id, author["name"], item["id"])
    except Exception:
        logger.warning("Citation resolution failed for PDF %s", safe_filename, exc_info=True)

    # Fallback: extract authors + emails directly from PDF if citation didn't provide them
    if not citation_data or not citation_data.get("authors"):
        try:
            pdf_authors = extract_authors_and_emails(pdf_bytes)
            for author_info in pdf_authors:
                person_data = {"role": "researcher"}
                if author_info.get("affiliation"):
                    person_data["affiliation"] = author_info["affiliation"]
                _link_or_create_person(supabase, user_id, author_info["name"], item["id"], extra=person_data)
                # Store email in person bio field (until email column migration)
                if author_info.get("email"):
                    existing = supabase.table("people").select("id, bio").eq("user_id", user_id).eq("name", author_info["name"]).limit(1).execute()
                    if existing.data and not existing.data[0].get("bio"):
                        supabase.table("people").update({"bio": author_info["email"]}).eq("id", existing.data[0]["id"]).execute()
        except Exception:
            logger.warning("PDF author extraction failed for %s", safe_filename, exc_info=True)

    return {"item": item, "chunks_created": len(chunks), "citation": citation_data}


@router.post("/batch-pdf")
async def ingest_batch_pdf(
    request: Request,
    files: list[UploadFile] = File(...),
    collection_id: Optional[str] = Form(None),
    tags: list[str] = Form([]),
):
    """Upload and process multiple PDFs at once."""
    import os as _os
    import uuid as _uuid

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    MAX_PDF_SIZE = 50 * 1024 * 1024
    created_items = []
    errors = []

    for file in files:
        try:
            pdf_bytes = await file.read()
            if len(pdf_bytes) > MAX_PDF_SIZE:
                errors.append({"file": file.filename, "error": "PDF exceeds 50MB limit"})
                continue

            extracted = extract_from_pdf(pdf_bytes)

            # Sanitize filename
            safe_filename = _os.path.basename(file.filename or "upload.pdf").replace("..", "")
            if not safe_filename:
                safe_filename = f"{_uuid.uuid4().hex}.pdf"
            storage_path = f"{user_id}/pdfs/{safe_filename}"

            # Upload to storage
            try:
                supabase.storage.from_("documents").upload(storage_path, pdf_bytes)
            except Exception:
                try:
                    supabase.storage.from_("documents").update(storage_path, pdf_bytes)
                except Exception:
                    logger.warning("PDF storage failed for %s, continuing", storage_path)

            item_data = {
                "user_id": user_id,
                "title": extracted["title"],
                "type": "paper",
                "extracted_text": extracted["extracted_text"],
                "metadata": {"page_count": extracted["page_count"], "pdf_storage_path": storage_path, "is_two_column": extracted.get("is_two_column", False)},
                "reading_status": "to_read",
            }

            result = supabase.table("items").insert(item_data).execute()
            item = result.data[0]
            item_id = item["id"]

            # Add to collection
            if collection_id:
                try:
                    supabase.table("collection_items").insert({
                        "collection_id": collection_id,
                        "item_id": item_id,
                        "sort_order": 0,
                    }).execute()
                except Exception:
                    logger.warning("Failed to add item %s to collection %s", item_id, collection_id)

            # Add tags
            for tag_name in tags:
                try:
                    tag_result = supabase.table("tags").upsert(
                        {"user_id": user_id, "name": tag_name},
                        on_conflict="user_id,name",
                    ).execute()
                    tag_id = tag_result.data[0]["id"]
                    supabase.table("item_tags").insert({
                        "item_id": item_id,
                        "tag_id": tag_id,
                    }).execute()
                except Exception:
                    logger.warning("Failed to add tag %s to item %s", tag_name, item_id)

            # Chunk and embed (non-fatal)
            chunks_created = 0
            try:
                chunks = await chunk_and_embed(extracted["extracted_text"], item_id)
                if chunks:
                    supabase.table("chunks").insert(chunks).execute()
                    chunks_created = len(chunks)
            except Exception:
                logger.warning("Embedding failed for PDF %s, item saved without chunks", safe_filename, exc_info=True)

            # Auto-resolve citation (non-fatal)
            citation_data = None
            try:
                citation_data = await resolve_citation(
                    title=extracted["title"],
                    text=(extracted.get("extracted_text") or "")[:3000],
                )
                if citation_data:
                    supabase.table("citations").insert({
                        "item_id": item_id,
                        "authors": citation_data.get("authors"),
                        "year": citation_data.get("year"),
                        "venue": citation_data.get("venue"),
                        "doi": citation_data.get("doi"),
                        "arxiv_id": citation_data.get("arxiv_id"),
                        "abstract": citation_data.get("abstract"),
                        "bibtex": citation_data.get("bibtex"),
                        "pdf_storage_path": storage_path,
                    }).execute()
                    for author in citation_data.get("authors", []):
                        _link_or_create_person(supabase, user_id, author["name"], item_id)
            except Exception:
                logger.warning("Citation resolution failed for PDF %s", safe_filename, exc_info=True)

            # Fallback: extract authors directly from PDF
            if not citation_data or not citation_data.get("authors"):
                try:
                    pdf_authors = extract_authors_and_emails(pdf_bytes)
                    for author_info in pdf_authors:
                        person_data = {"role": "researcher"}
                        if author_info.get("affiliation"):
                            person_data["affiliation"] = author_info["affiliation"]
                        _link_or_create_person(supabase, user_id, author_info["name"], item_id, extra=person_data)
                except Exception:
                    logger.warning("PDF author extraction failed for %s", safe_filename, exc_info=True)

            # Log activity
            supabase.table("activity").insert({
                "user_id": user_id,
                "action": "save",
                "item_id": item_id,
            }).execute()

            created_items.append({"item": item, "chunks_created": chunks_created, "citation": citation_data})

        except Exception as e:
            logger.error("Failed to process PDF %s: %s", file.filename, str(e), exc_info=True)
            errors.append({"file": file.filename, "error": str(e)})

    return {
        "items": created_items,
        "count": len(created_items),
        "errors": errors,
    }


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

    # Download PDF (follow_redirects required for arXiv)
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        pdf_resp = await client.get(meta["pdf_url"])
        pdf_bytes = pdf_resp.content

    extracted = extract_from_pdf(pdf_bytes)

    # Upload PDF to storage (upsert to handle re-saves)
    storage_path = f"{user_id}/pdfs/arxiv_{meta['arxiv_id']}.pdf"
    try:
        supabase.storage.from_("documents").upload(storage_path, pdf_bytes)
    except Exception:
        # File already exists — update instead
        try:
            supabase.storage.from_("documents").update(storage_path, pdf_bytes)
        except Exception:
            logger.warning("PDF storage failed for %s, continuing", storage_path)

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

    # Chunk and embed (non-fatal — paper is still saved without embeddings)
    chunks = []
    try:
        chunks = await chunk_and_embed(extracted["extracted_text"], item["id"])
        if chunks:
            supabase.table("chunks").insert(chunks).execute()
    except Exception:
        logger.warning("Embedding failed for arXiv %s, paper saved without chunks", arxiv_id, exc_info=True)

    return {"item": item, "citation": citation_data, "chunks_created": len(chunks)}


@router.get("/book/lookup")
async def book_lookup(request: Request, q: str):
    """Search Open Library for book metadata."""
    await get_user_id(request)
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query is required")
    results = await search_books(q.strip(), limit=3)
    return {"results": results}


@router.post("/book")
async def ingest_book(req: IngestBookRequest, request: Request):
    """Create a book item with citation and author links."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Dedup by title (books have no URL)
    existing = (
        supabase.table("items")
        .select("id, title")
        .eq("user_id", user_id)
        .eq("type", "book")
        .eq("title", req.title)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"item": existing.data[0], "deduplicated": True}

    # Build author string for domain field (used as subtitle in UI)
    author_names = ", ".join(a["name"] for a in req.authors if a.get("name"))

    item_data = {
        "user_id": user_id,
        "title": req.title,
        "type": "book",
        "domain": author_names or None,
        "cover_image_url": req.cover_url,
        "reading_status": req.reading_status,
        "metadata": {
            "isbn": req.isbn,
            "publisher": req.publisher,
            "page_count": req.page_count,
        },
    }
    result = supabase.table("items").insert(item_data).execute()
    item = result.data[0]

    # Create citation record
    if req.authors or req.year:
        supabase.table("citations").insert({
            "item_id": item["id"],
            "authors": req.authors,
            "year": req.year,
        }).execute()

    # Link authors as people
    for author in req.authors:
        if author.get("name"):
            _link_or_create_person(supabase, user_id, author["name"], item["id"])

    # Auto-tag from Open Library subjects
    _auto_tag_from_subjects(supabase, user_id, item["id"], req.subjects)

    # Log activity
    supabase.table("activity").insert({
        "user_id": user_id,
        "action": "save",
        "item_id": item["id"],
    }).execute()

    return {"item": item}


@router.post("/paste")
async def ingest_paste(req: IngestPasteRequest, request: Request):
    """Create an item from pasted text content (no URL)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")

    # Auto-generate title from first line or first 60 chars
    title = req.title
    if not title:
        first_line = req.content.strip().split("\n")[0][:80]
        title = first_line if first_line else "Untitled"

    item_data = {
        "user_id": user_id,
        "title": title,
        "type": req.type,
        "extracted_text": req.content,
        "reading_status": "to_read",
    }

    result = supabase.table("items").insert(item_data).execute()
    item = result.data[0]
    item_id = item["id"]

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

    # Chunk and embed (skip gracefully if embedding service unavailable)
    chunks = []
    try:
        chunks = await chunk_and_embed(
            req.content, item_id,
            metadata={"type": req.type},
        )
        if chunks:
            supabase.table("chunks").insert(chunks).execute()
    except Exception:
        logger.debug("Embedding unavailable for paste item %s", item_id)

    # Log activity
    supabase.table("activity").insert({
        "user_id": user_id,
        "action": "save",
        "item_id": item_id,
    }).execute()

    return {"item": item, "chunks_created": len(chunks)}


@router.post("/image")
async def ingest_image(
    request: Request,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    type: str = Form("book"),
):
    """Upload an image, extract items via Claude Vision, create multiple library items."""
    import base64
    import os as _os
    import uuid as _uuid

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    MAX_SIZE = 10 * 1024 * 1024
    img_bytes = await file.read()
    if len(img_bytes) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Image exceeds 10MB limit")

    # Upload image to storage (optional — bucket may not exist)
    safe_filename = _os.path.basename(file.filename or "upload.png").replace("..", "")
    if not safe_filename:
        safe_filename = f"{_uuid.uuid4().hex}.png"
    storage_path = f"{user_id}/images/{safe_filename}"
    try:
        supabase.storage.from_("documents").upload(storage_path, img_bytes)
    except Exception as e:
        logger.debug("Storage upload skipped: %s", e)
        storage_path = None

    # Use Claude Vision to extract items from the image
    items_extracted = []
    api_key = _os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        import httpx
        b64_image = base64.b64encode(img_bytes).decode("utf-8")
        media_type = file.content_type or "image/png"

        try:
            vision_resp = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 1024,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": b64_image,
                                },
                            },
                            {
                                "type": "text",
                                "text": (
                                    "Extract all distinct items (books, papers, articles, etc.) visible in this image. "
                                    "For each item, return a JSON array of objects with 'title' and 'author' fields. "
                                    "Return ONLY the JSON array, no other text. Example: "
                                    '[{"title": "Book Name", "author": "Author Name"}]'
                                ),
                            },
                        ],
                    }],
                },
                timeout=30,
            )

            if vision_resp.status_code == 200:
                import json
                content = vision_resp.json()["content"][0]["text"]
                start = content.find("[")
                end = content.rfind("]") + 1
                if start >= 0 and end > start:
                    items_extracted = json.loads(content[start:end])
        except Exception as e:
            logger.warning("Vision extraction failed: %s", e)

    # Create items from extracted data
    created_items = []
    if items_extracted:
        for ext in items_extracted:
            ext_title = ext.get("title", "").strip()
            if not ext_title:
                continue

            # Dedup check
            existing = (
                supabase.table("items")
                .select("id, title")
                .eq("user_id", user_id)
                .eq("title", ext_title)
                .limit(1)
                .execute()
            )
            if existing.data:
                created_items.append(existing.data[0])
                continue

            item_data = {
                "user_id": user_id,
                "title": ext_title,
                "type": type,
                "domain": ext.get("author", ""),
                "reading_status": "to_read",
            }
            result = supabase.table("items").insert(item_data).execute()
            item = result.data[0]
            created_items.append(item)

            # Auto-link author
            author = ext.get("author", "").strip()
            if author:
                _link_or_create_person(supabase, user_id, author, item["id"])

            supabase.table("activity").insert({
                "user_id": user_id,
                "action": "save",
                "item_id": item["id"],
            }).execute()
    else:
        # Fallback: create single item from the image itself
        public_url = None
        if storage_path:
            try:
                public_url = supabase.storage.from_("documents").get_public_url(storage_path)
            except Exception:
                pass
        item_data = {
            "user_id": user_id,
            "title": title or safe_filename,
            "type": type,
            "cover_image_url": public_url,
            "metadata": {"image_storage_path": storage_path} if storage_path else None,
            "reading_status": "to_read",
        }
        result = supabase.table("items").insert(item_data).execute()
        created_items.append(result.data[0])

    return {"items": created_items, "extracted_count": len(items_extracted)}


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


# --- Helper functions ---

def _link_author_to_item(supabase, user_id: str, author_name: str, item_id: str):
    """Fuzzy-match extracted author against existing people and link."""
    from services.auth import _escape_ilike
    escaped = author_name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    people = (
        supabase.table("people")
        .select("id")
        .eq("user_id", user_id)
        .ilike("name", f"%{escaped}%")
        .limit(1)
        .execute()
    )
    if people.data:
        try:
            supabase.table("person_items").insert({
                "person_id": people.data[0]["id"],
                "item_id": item_id,
                "relation": "authored",
            }).execute()
        except Exception:
            pass  # Duplicate link, ignore


def _link_or_create_person(supabase, user_id: str, name: str, item_id: str, extra: dict | None = None):
    """Find or create a person, then link to item. Optional extra fields on create."""
    existing = (
        supabase.table("people")
        .select("id")
        .eq("user_id", user_id)
        .eq("name", name)
        .limit(1)
        .execute()
    )
    if existing.data:
        person_id = existing.data[0]["id"]
        # Update affiliation if provided and person doesn't have one
        if extra and extra.get("affiliation"):
            try:
                person_full = supabase.table("people").select("affiliation").eq("id", person_id).single().execute()
                if person_full.data and not person_full.data.get("affiliation"):
                    supabase.table("people").update({"affiliation": extra["affiliation"]}).eq("id", person_id).execute()
            except Exception:
                pass
    else:
        person_data = {
            "user_id": user_id,
            "name": name,
            "role": "researcher",
        }
        if extra:
            person_data.update({k: v for k, v in extra.items() if v})
        person_result = supabase.table("people").insert(person_data).execute()
        person_id = person_result.data[0]["id"]

    try:
        supabase.table("person_items").insert({
            "person_id": person_id,
            "item_id": item_id,
            "relation": "authored",
        }).execute()
    except Exception:
        pass  # Duplicate link, ignore


@router.post("/podcasts/sync")
async def sync_apple_podcasts(request: Request):
    """Import played episodes from local Apple Podcasts database.

    Reads the macOS Apple Podcasts SQLite DB, deduplicates against existing
    podcast items by title, and creates new items for untracked episodes.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    from services.apple_podcasts import get_played_episodes, find_transcript

    try:
        episodes = get_played_episodes(limit=300)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Get existing podcast titles for dedup
    existing = supabase.table("items").select("title").eq("user_id", user_id).eq("type", "podcast").execute()
    existing_titles = {r["title"].lower().strip() for r in (existing.data or [])}

    created = []
    skipped = 0
    for ep in episodes:
        # Dedup by episode title
        if ep.title.lower().strip() in existing_titles:
            skipped += 1
            continue

        # Try to extract transcript from local cache
        transcript = find_transcript(ep.transcript_id)

        item_data = {
            "user_id": user_id,
            "title": ep.title,
            "type": "podcast",
            "domain": ep.podcast_name,
            "cover_image_url": ep.artwork_url,
            "summary": ep.description,
            "reading_status": "read",  # Already listened
            "metadata": {
                "podcast_name": ep.podcast_name,
                "play_count": ep.play_count,
                "duration_seconds": ep.duration_seconds,
                "source": "apple_podcasts",
                "web_url": ep.web_url,
                "enclosure_url": ep.url,
                "has_transcript": transcript is not None,
            },
        }
        if transcript:
            item_data["extracted_text"] = transcript
        try:
            result = supabase.table("items").insert(item_data).execute()
            if result.data:
                created.append(result.data[0])
                existing_titles.add(ep.title.lower().strip())
        except Exception:
            skipped += 1  # Constraint violation or other DB error

    return {
        "synced": len(created),
        "skipped": skipped,
        "total_played": len(episodes),
        "items": [{"id": c["id"], "title": c["title"], "domain": c.get("domain")} for c in created],
    }


def _auto_tag_from_subjects(supabase, user_id: str, item_id: str, subjects: list[str]):
    """Map Open Library subjects to existing Stoa tags, create item_tags links."""
    if not subjects:
        return

    # Get existing tag vocabulary
    existing_tags = (
        supabase.table("tags")
        .select("id, name")
        .eq("user_id", user_id)
        .execute()
    )
    tag_map = {t["name"].lower(): t["id"] for t in (existing_tags.data or [])}

    matched = 0
    for subject in subjects:
        subject_lower = subject.lower().strip()
        # Check for exact or substring match against existing tags
        for tag_name, tag_id in tag_map.items():
            if tag_name in subject_lower or subject_lower in tag_name:
                try:
                    supabase.table("item_tags").insert({
                        "item_id": item_id,
                        "tag_id": tag_id,
                    }).execute()
                    matched += 1
                except Exception:
                    pass  # Duplicate, ignore
                break
        if matched >= 4:
            break
