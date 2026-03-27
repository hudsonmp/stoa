"""Citation management endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()


def _get_citation_data(item_id: str, user_id: str):
    """Shared helper: fetch citation + item title for a given item."""
    supabase = get_supabase_service()

    item_check = supabase.table("items").select("id, title").eq("id", item_id).eq("user_id", user_id).execute()
    if not item_check.data:
        raise HTTPException(status_code=404, detail="Item not found")

    result = supabase.table("citations").select("*").eq("item_id", item_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Citation not found")

    return result.data[0], item_check.data[0]["title"]


def _format_apa(citation: dict, title: str) -> str:
    """Generate APA 7th edition citation string."""
    authors = citation.get("authors") or []
    year = citation.get("year") or "n.d."
    venue = citation.get("venue") or ""
    doi = citation.get("doi") or ""

    # Format authors: Last, F. I., & Last, F. I.
    formatted_authors = []
    for a in authors:
        name = a.get("name", "Unknown")
        parts = name.split()
        if len(parts) >= 2:
            last = parts[-1]
            initials = " ".join(p[0] + "." for p in parts[:-1])
            formatted_authors.append(f"{last}, {initials}")
        else:
            formatted_authors.append(name)

    if len(formatted_authors) == 0:
        author_str = "Unknown"
    elif len(formatted_authors) == 1:
        author_str = formatted_authors[0]
    elif len(formatted_authors) == 2:
        author_str = f"{formatted_authors[0]}, & {formatted_authors[1]}"
    elif len(formatted_authors) <= 20:
        author_str = ", ".join(formatted_authors[:-1]) + f", & {formatted_authors[-1]}"
    else:
        author_str = ", ".join(formatted_authors[:19]) + f", ... {formatted_authors[-1]}"

    apa = f"{author_str} ({year}). {title}."
    if venue:
        apa += f" *{venue}*."
    if doi:
        apa += f" https://doi.org/{doi}"

    return apa


def _format_mla(citation: dict, title: str) -> str:
    """Generate MLA 9th edition citation string."""
    authors = citation.get("authors") or []
    year = citation.get("year") or ""
    venue = citation.get("venue") or ""
    doi = citation.get("doi") or ""

    # MLA: Last, First Middle. for first author; First Last for subsequent
    formatted_authors = []
    for i, a in enumerate(authors):
        name = a.get("name", "Unknown")
        parts = name.split()
        if i == 0 and len(parts) >= 2:
            first_names = " ".join(parts[:-1])
            formatted_authors.append(f"{parts[-1]}, {first_names}")
        else:
            formatted_authors.append(name)

    if len(formatted_authors) == 0:
        author_str = "Unknown"
    elif len(formatted_authors) == 1:
        author_str = formatted_authors[0]
    elif len(formatted_authors) == 2:
        author_str = f"{formatted_authors[0]}, and {formatted_authors[1]}"
    elif len(formatted_authors) == 3:
        author_str = f"{formatted_authors[0]}, {formatted_authors[1]}, and {formatted_authors[2]}"
    else:
        author_str = f"{formatted_authors[0]}, et al."

    mla = f'{author_str}. "{title}."'
    if venue:
        mla += f" *{venue}*"
    if year:
        mla += f", {year}"
    mla += "."
    if doi:
        mla += f" https://doi.org/{doi}."

    return mla


@router.get("/{item_id}/apa")
async def export_apa(item_id: str, request: Request):
    """Export a citation in APA 7th edition format."""
    user_id = await get_user_id(request)
    citation, title = _get_citation_data(item_id, user_id)
    return {"apa": _format_apa(citation, title)}


@router.get("/{item_id}/mla")
async def export_mla(item_id: str, request: Request):
    """Export a citation in MLA 9th edition format."""
    user_id = await get_user_id(request)
    citation, title = _get_citation_data(item_id, user_id)
    return {"mla": _format_mla(citation, title)}


@router.get("/{item_id}/bib")
async def export_bibtex(item_id: str, request: Request):
    """Export a citation as BibTeX."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Verify the item belongs to this user
    item_check = supabase.table("items").select("id").eq("id", item_id).eq("user_id", user_id).execute()
    if not item_check.data:
        raise HTTPException(status_code=404, detail="Item not found")

    result = supabase.table("citations").select("*").eq("item_id", item_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Citation not found")

    citation = result.data[0]

    # If there's stored bibtex, return it
    if citation.get("bibtex"):
        return {"bibtex": citation["bibtex"]}

    # Generate BibTeX
    authors = citation.get("authors") or []
    author_str = " and ".join(a.get("name", "Unknown") for a in authors)
    year = citation.get("year") or "n.d."
    title = ""

    # Get item title
    item_result = supabase.table("items").select("title").eq("id", item_id).execute()
    if item_result.data:
        title = item_result.data[0]["title"]

    # Create cite key
    first_author = authors[0]["name"].split()[-1].lower() if authors else "unknown"
    cite_key = f"{first_author}{year}"

    venue = citation.get("venue") or ""
    arxiv_id = citation.get("arxiv_id") or ""
    doi = citation.get("doi") or ""

    bibtex = f"""@article{{{cite_key},
  author = {{{author_str}}},
  title = {{{title}}},
  year = {{{year}}},"""

    if venue:
        bibtex += f"\n  journal = {{{venue}}},"
    if doi:
        bibtex += f"\n  doi = {{{doi}}},"
    if arxiv_id:
        bibtex += f"\n  eprint = {{{arxiv_id}}},"
        bibtex += "\n  archiveprefix = {arXiv},"

    bibtex += "\n}"

    return {"bibtex": bibtex}


@router.post("/{item_id}/enrich")
async def enrich_citation(item_id: str, request: Request):
    """Resolve and populate citation metadata for an existing item."""
    from services.citation_resolver import resolve_citation

    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Verify item ownership
    item_res = (
        supabase.table("items")
        .select("id, title, url, extracted_text")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    item = item_res.data

    # Check if citation already exists
    existing_cit = supabase.table("citations").select("id").eq("item_id", item_id).execute()
    if existing_cit.data:
        raise HTTPException(status_code=409, detail="Citation already exists for this item")

    citation = await resolve_citation(
        url=item.get("url"),
        title=item.get("title"),
        text=(item.get("extracted_text") or "")[:3000],
    )
    if not citation:
        raise HTTPException(status_code=404, detail="Could not resolve citation metadata")

    supabase.table("citations").insert({
        "item_id": item_id,
        "authors": citation.get("authors"),
        "year": citation.get("year"),
        "venue": citation.get("venue"),
        "doi": citation.get("doi"),
        "arxiv_id": citation.get("arxiv_id"),
        "abstract": citation.get("abstract"),
        "bibtex": citation.get("bibtex"),
    }).execute()

    return {"citation": citation}


class BibTeXImportRequest(BaseModel):
    bibtex: str


@router.post("/import")
async def import_bibtex(req: BibTeXImportRequest, request: Request):
    """Bulk import citations from BibTeX."""
    user_id = await get_user_id(request)
    try:
        import bibtexparser
    except ImportError:
        raise HTTPException(status_code=500, detail="bibtexparser not installed")

    library = bibtexparser.parse(req.bibtex)
    supabase = get_supabase_service()

    imported = []
    for entry in library.entries:
        title = entry.fields_dict.get("title", None)
        title_val = title.value if title else "Untitled"

        authors_raw = entry.fields_dict.get("author", None)
        authors = []
        if authors_raw:
            for a in authors_raw.value.split(" and "):
                authors.append({"name": a.strip()})

        year_raw = entry.fields_dict.get("year", None)
        year = int(year_raw.value) if year_raw else None

        venue_raw = entry.fields_dict.get("journal", None) or entry.fields_dict.get("booktitle", None)
        venue = venue_raw.value if venue_raw else None

        doi_raw = entry.fields_dict.get("doi", None)
        doi = doi_raw.value if doi_raw else None

        # Create item
        item_result = supabase.table("items").insert({
            "user_id": user_id,
            "title": title_val,
            "type": "paper",
            "reading_status": "to_read",
        }).execute()
        item = item_result.data[0]

        # Create citation
        supabase.table("citations").insert({
            "item_id": item["id"],
            "authors": authors,
            "year": year,
            "venue": venue,
            "doi": doi,
            "bibtex": bibtexparser.write_string(bibtexparser.Library([entry])),
        }).execute()

        imported.append(item)

    return {"imported": len(imported), "items": imported}
