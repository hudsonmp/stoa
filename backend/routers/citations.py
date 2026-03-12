"""Citation management endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()


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
