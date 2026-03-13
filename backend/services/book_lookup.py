"""Book metadata lookup via Open Library API."""

from typing import Optional

import httpx

OL_SEARCH = "https://openlibrary.org/search.json"
OL_COVER = "https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg"


async def search_books(query: str, limit: int = 3) -> list[dict]:
    """Search Open Library for books by title, author, or ISBN.

    Returns normalized book metadata for each match.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            OL_SEARCH,
            params={"q": query, "limit": limit, "fields": "title,author_name,isbn,cover_i,subject,first_publish_year,publisher,number_of_pages_median"},
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        docs = data.get("docs", [])

        results = []
        for doc in docs:
            isbn_list = doc.get("isbn") or []
            isbn = isbn_list[0] if isbn_list else None

            cover_url = None
            if isbn:
                cover_url = OL_COVER.format(isbn=isbn)
            elif doc.get("cover_i"):
                cover_url = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-M.jpg"

            authors = doc.get("author_name") or []
            subjects = doc.get("subject") or []

            results.append({
                "title": doc.get("title", "Unknown"),
                "authors": [{"name": a} for a in authors],
                "isbn": isbn,
                "cover_url": cover_url,
                "year": doc.get("first_publish_year"),
                "publisher": (doc.get("publisher") or [None])[0] if doc.get("publisher") else None,
                "page_count": doc.get("number_of_pages_median"),
                "subjects": subjects[:10],  # Cap at 10 to avoid noise
            })

        return results


async def lookup_isbn(isbn: str) -> Optional[dict]:
    """Look up a specific book by ISBN."""
    results = await search_books(f"isbn:{isbn}", limit=1)
    return results[0] if results else None
