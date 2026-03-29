#!/usr/bin/env python3
"""Stoa MCP Server — search, RAG, and manage the milieu knowledge base via Claude Code.

All tools route through the FastAPI backend (no direct Supabase).
"""

import os
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

mcp = FastMCP(
    "stoa",
    instructions="Stoa is Hudson's personal knowledge base and milieu curation system. "
    "Use these tools to search his library of saved articles, papers, books, and podcasts, "
    "query his intellectual milieu (people and their connections), and perform RAG over his "
    "entire knowledge base.",
)

STOA_API = os.getenv("STOA_API_URL", "http://localhost:8000")


def _get_user_id() -> str:
    user_id = os.getenv("STOA_USER_ID", "")
    if not user_id:
        raise ValueError("STOA_USER_ID not set.")
    return user_id


def _headers() -> dict:
    return {"X-User-Id": _get_user_id(), "Content-Type": "application/json"}


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=30, headers=_headers())


# ── Search ────────────────────────────────────────────────────────────


@mcp.tool()
async def search_library(
    query: str,
    type: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> list[dict]:
    """Search Hudson's saved library using hybrid semantic + full-text search.

    Args:
        query: Search query (e.g., "context engineering", "self-directed learning")
        type: Filter by content type: book, blog, paper, podcast, page, tweet, video
        tags: Filter by tags
    """
    async with _client() as c:
        resp = await c.post(f"{STOA_API}/search", json={
            "query": query, "type": type, "tags": tags or [], "limit": 10,
        })
        return resp.json().get("results", [])


@mcp.tool()
async def search_all(query: str) -> dict:
    """Search across both items and notes.

    Args:
        query: Search string
    """
    items, notes = [], []
    async with _client() as c:
        try:
            r = await c.post(f"{STOA_API}/search", json={"query": query, "limit": 10})
            if r.status_code < 400:
                items = r.json().get("results", [])
        except Exception:
            pass
        try:
            r = await c.get(f"{STOA_API}/notes/search", params={"q": query})
            if r.status_code < 400:
                notes = r.json().get("notes", [])
        except Exception:
            pass
    return {"items": items, "notes": notes}


@mcp.tool()
async def rag_query(question: str) -> dict:
    """Ask a question over Hudson's entire knowledge base using RAG.

    Args:
        question: Natural language question
    """
    async with _client() as c:
        resp = await c.post(f"{STOA_API}/rag/query", json={"question": question})
        return resp.json()


# ── Items ─────────────────────────────────────────────────────────────


@mcp.tool()
async def get_item(item_id: Optional[str] = None, url: Optional[str] = None) -> dict:
    """Get a single item with highlights, notes, and related items.

    Args:
        item_id: UUID of the item
        url: URL of the item (alternative to item_id)
    """
    async with _client() as c:
        if url and not item_id:
            r = await c.get(f"{STOA_API}/items/by-url", params={"url": url})
            if r.status_code >= 400:
                return {"error": f"No item found for URL: {url}"}
            item_id = r.json()["item"]["id"]
        resp = await c.get(f"{STOA_API}/items/{item_id}")
        if resp.status_code >= 400:
            return {"error": resp.text}
        return resp.json()


@mcp.tool()
async def add_item(
    url: str,
    type: str = "blog",
    tags: Optional[list[str]] = None,
    collection: Optional[str] = None,
) -> dict:
    """Save a new item (URL) to Hudson's library.

    Args:
        url: The URL to save
        type: Content type (blog, paper, book, podcast, page, tweet, video)
        tags: Tags to apply
        collection: Collection name to add to
    """
    async with _client() as c:
        # Resolve collection name → id
        collection_id = None
        if collection:
            cols = await c.get(f"{STOA_API}/items/collections")
            if cols.status_code < 400:
                for col in cols.json().get("collections", []):
                    if col["name"].lower() == collection.lower():
                        collection_id = col["id"]
                        break

        resp = await c.post(f"{STOA_API}/ingest", json={
            "url": url, "type": type, "tags": tags or [],
            "person_ids": [], "collection_id": collection_id,
        })
        return resp.json()


@mcp.tool()
async def get_reading_list(
    status: str = "to_read",
    type: Optional[str] = None,
) -> list[dict]:
    """Get items by reading status.

    Args:
        status: One of "to_read", "reading", "read"
        type: Filter by content type
    """
    async with _client() as c:
        params = {"status": status}
        if type:
            params["type"] = type
        resp = await c.get(f"{STOA_API}/items", params=params)
        if resp.status_code >= 400:
            return []
        return resp.json().get("items", [])


@mcp.tool()
async def log_book(title_or_isbn: str) -> dict:
    """Log a physical book Hudson is reading. Searches Open Library for metadata.

    Args:
        title_or_isbn: Book title (e.g., "Zero to One") or ISBN
    """
    async with _client() as c:
        lookup = await c.get(f"{STOA_API}/ingest/book/lookup", params={"q": title_or_isbn})
        results = lookup.json().get("results", [])
        if not results:
            return {"error": f"No book found matching '{title_or_isbn}'"}
        best = results[0]
        resp = await c.post(f"{STOA_API}/ingest/book", json={
            "title": best["title"], "authors": best["authors"],
            "isbn": best.get("isbn"), "cover_url": best.get("cover_url"),
            "year": best.get("year"), "publisher": best.get("publisher"),
            "page_count": best.get("page_count"),
            "subjects": best.get("subjects", []),
            "reading_status": "reading",
        })
        return resp.json()


@mcp.tool()
async def add_citation(
    arxiv_id: Optional[str] = None,
    doi: Optional[str] = None,
    bibtex: Optional[str] = None,
) -> dict:
    """Add a research paper to the library.

    Args:
        arxiv_id: arXiv paper ID (e.g., "2301.00234")
        doi: DOI identifier (e.g., "10.1145/3544548.3581388")
        bibtex: Raw BibTeX entry
    """
    async with _client() as c:
        if arxiv_id:
            resp = await c.post(f"{STOA_API}/ingest/arxiv/{arxiv_id}")
            return resp.json()
        elif doi:
            resp = await c.post(f"{STOA_API}/ingest", json={
                "url": f"https://doi.org/{doi}", "type": "paper",
                "tags": [], "person_ids": [],
            })
            return resp.json()
        elif bibtex:
            resp = await c.post(f"{STOA_API}/citations/import", json={"bibtex": bibtex})
            return resp.json()
        return {"error": "Provide arxiv_id, doi, or bibtex"}


# ── Highlights ────────────────────────────────────────────────────────


@mcp.tool()
async def get_highlights(
    item_id: Optional[str] = None,
    url: Optional[str] = None,
) -> list[dict]:
    """Get saved highlights, optionally filtered by item.

    Args:
        item_id: Get highlights for a specific item
        url: Get highlights for an item by URL
    """
    async with _client() as c:
        if url and not item_id:
            resp = await c.get(f"{STOA_API}/highlights", params={"url": url})
        elif item_id:
            resp = await c.get(f"{STOA_API}/highlights", params={"item_id": item_id})
        else:
            resp = await c.get(f"{STOA_API}/highlights")
        if resp.status_code >= 400:
            return []
        return resp.json().get("highlights", [])


# ── Notes ─────────────────────────────────────────────────────────────


@mcp.tool()
async def get_notes(
    item_id: Optional[str] = None,
    person_id: Optional[str] = None,
) -> list[dict]:
    """Get notes, optionally filtered by item or person.

    Args:
        item_id: Get notes for a specific item
        person_id: Get notes about a specific person
    """
    async with _client() as c:
        params = {}
        if item_id:
            params["item_id"] = item_id
        if person_id:
            params["person_id"] = person_id
        resp = await c.get(f"{STOA_API}/notes", params=params)
        if resp.status_code >= 400:
            return []
        return resp.json().get("notes", [])


@mcp.tool()
async def create_note(
    content: str,
    title: Optional[str] = None,
    note_type: str = "marginalia",
    tags: Optional[list[str]] = None,
    item_id: Optional[str] = None,
    item_ids: Optional[list[str]] = None,
) -> dict:
    """Create a note in Hudson's knowledge base.

    Args:
        content: Note content (plain text or HTML)
        title: Optional note title
        note_type: One of "marginalia", "synthesis", "journal"
        tags: Optional tags
        item_id: Optional single item to link to
        item_ids: Optional list of item IDs to link (for synthesis notes)
    """
    async with _client() as c:
        resp = await c.post(f"{STOA_API}/notes", json={
            "content": content, "title": title, "note_type": note_type,
            "tags": tags or [], "item_id": item_id, "item_ids": item_ids or [],
        })
        if resp.status_code >= 400:
            return {"error": resp.text}
        return resp.json()


@mcp.tool()
async def get_note(note_id: str) -> dict:
    """Get a single note with its linked items.

    Args:
        note_id: UUID of the note
    """
    async with _client() as c:
        resp = await c.get(f"{STOA_API}/notes/{note_id}")
        if resp.status_code >= 400:
            return {"error": resp.text}
        return resp.json().get("note", {})


@mcp.tool()
async def search_notes(query: str) -> list[dict]:
    """Search notes by title and content.

    Args:
        query: Search string (min 2 chars)
    """
    async with _client() as c:
        resp = await c.get(f"{STOA_API}/notes/search", params={"q": query})
        if resp.status_code >= 400:
            return []
        return resp.json().get("notes", [])


# ── People ────────────────────────────────────────────────────────────


@mcp.tool()
async def get_people() -> list[dict]:
    """List all people in Hudson's intellectual milieu."""
    async with _client() as c:
        resp = await c.get(f"{STOA_API}/people")
        if resp.status_code >= 400:
            return []
        return resp.json().get("people", [])


@mcp.tool()
async def get_person(name: str) -> dict:
    """Get details about a person, including their items and connections.

    Args:
        name: Person's name (fuzzy match)
    """
    async with _client() as c:
        # List people and fuzzy match
        resp = await c.get(f"{STOA_API}/people")
        if resp.status_code >= 400:
            return {"error": "Failed to fetch people"}
        people = resp.json().get("people", [])
        match = None
        for p in people:
            if name.lower() in p["name"].lower():
                match = p
                break
        if not match:
            return {"error": f"No person found matching '{name}'"}

        detail = await c.get(f"{STOA_API}/people/{match['id']}")
        if detail.status_code >= 400:
            return match
        return detail.json()


@mcp.tool()
async def add_person(
    name: str,
    twitter: Optional[str] = None,
    website: Optional[str] = None,
    affiliation: Optional[str] = None,
    role: str = "intellectual hero",
    notes: Optional[str] = None,
) -> dict:
    """Add a person to Hudson's intellectual milieu.

    Args:
        name: Person's name
        twitter: Twitter/X handle
        website: Personal website URL
        affiliation: Organization (e.g., "CMU HCII", "Anthropic")
        role: "mentor", "peer", "intellectual hero", "researcher"
        notes: Personal notes about this person
    """
    async with _client() as c:
        resp = await c.post(f"{STOA_API}/people", json={
            "name": name, "twitter_handle": twitter, "website_url": website,
            "affiliation": affiliation, "role": role, "notes": notes,
        })
        if resp.status_code >= 400:
            return {"error": resp.text}
        return resp.json()


@mcp.tool()
async def link_person_to_item(
    person_name: str,
    item_url: str,
    relation: str = "authored",
) -> dict:
    """Link a person to an item (e.g., mark as author).

    Args:
        person_name: Person's name (fuzzy match)
        item_url: URL of the item to link
        relation: Relationship type (authored, referenced, mentioned)
    """
    async with _client() as c:
        # Resolve person
        people_resp = await c.get(f"{STOA_API}/people")
        people = people_resp.json().get("people", [])
        person = None
        for p in people:
            if person_name.lower() in p["name"].lower():
                person = p
                break
        if not person:
            return {"error": f"No person found matching '{person_name}'"}

        # Resolve item
        item_resp = await c.get(f"{STOA_API}/items/by-url", params={"url": item_url})
        if item_resp.status_code >= 400:
            return {"error": f"No item found for URL: {item_url}"}
        item_id = item_resp.json()["item"]["id"]

        # Link
        resp = await c.post(f"{STOA_API}/people/{person['id']}/items", json={
            "item_id": item_id, "relation": relation,
        })
        if resp.status_code >= 400:
            return {"error": resp.text}
        return {"linked": True, "person": person["name"], "item_id": item_id}


# ── Collections ───────────────────────────────────────────────────────


@mcp.tool()
async def list_collections() -> list[dict]:
    """List all collections."""
    async with _client() as c:
        resp = await c.get(f"{STOA_API}/items/collections")
        if resp.status_code >= 400:
            return []
        return resp.json().get("collections", [])


@mcp.tool()
async def create_collection(name: str, description: str = "") -> dict:
    """Create a new collection.

    Args:
        name: Collection name
        description: Optional description
    """
    async with _client() as c:
        resp = await c.post(f"{STOA_API}/items/collections", json={
            "name": name, "description": description,
        })
        if resp.status_code >= 400:
            return {"error": resp.text}
        return resp.json()


@mcp.tool()
async def add_to_collection(collection_name: str, item_url: str) -> dict:
    """Add an item to a collection by name and URL.

    Args:
        collection_name: Name of the collection
        item_url: URL of the item to add
    """
    async with _client() as c:
        # Resolve collection
        cols_resp = await c.get(f"{STOA_API}/items/collections")
        cols = cols_resp.json().get("collections", [])
        col = None
        for co in cols:
            if co["name"].lower() == collection_name.lower():
                col = co
                break
        if not col:
            return {"error": f"No collection found matching '{collection_name}'"}

        # Resolve item
        item_resp = await c.get(f"{STOA_API}/items/by-url", params={"url": item_url})
        if item_resp.status_code >= 400:
            return {"error": f"No item found for URL: {item_url}"}
        item_id = item_resp.json()["item"]["id"]

        # Add
        resp = await c.post(
            f"{STOA_API}/items/collections/{col['id']}/items",
            json={"item_id": item_id},
        )
        if resp.status_code >= 400:
            return {"error": resp.text}
        return {"added": True, "collection": col["name"], "item_id": item_id}


@mcp.tool()
async def get_collection_items(collection_name: str) -> list[dict]:
    """Get all items in a collection.

    Args:
        collection_name: Name of the collection
    """
    async with _client() as c:
        cols_resp = await c.get(f"{STOA_API}/items/collections")
        cols = cols_resp.json().get("collections", [])
        col = None
        for co in cols:
            if co["name"].lower() == collection_name.lower():
                col = co
                break
        if not col:
            return []

        resp = await c.get(f"{STOA_API}/items/collections/{col['id']}/items")
        if resp.status_code >= 400:
            return []
        return resp.json().get("items", [])


# ── Milieu Graph ──────────────────────────────────────────────────────


@mcp.tool()
async def get_milieu_graph() -> dict:
    """Get Hudson's intellectual milieu: all people and their connections."""
    async with _client() as c:
        people_resp = await c.get(f"{STOA_API}/people")
        people = people_resp.json().get("people", []) if people_resp.status_code < 400 else []
        return {"people": people}


# ── Review ────────────────────────────────────────────────────────────


@mcp.tool()
async def get_review_queue() -> list[dict]:
    """Get highlights due for spaced repetition review."""
    async with _client() as c:
        resp = await c.get(f"{STOA_API}/review")
        if resp.status_code >= 400:
            return []
        return resp.json().get("reviews", [])


if __name__ == "__main__":
    mcp.run()
