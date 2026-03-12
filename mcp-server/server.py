#!/usr/bin/env python3
"""Stoa MCP Server — search, RAG, and manage the milieu knowledge base via Claude Code."""

import os
import sys
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
# For direct Supabase access when API is not running
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")


def _supabase():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


@mcp.tool()
async def search_library(
    query: str,
    type: Optional[str] = None,
    tags: Optional[list[str]] = None,
    person: Optional[str] = None,
) -> list[dict]:
    """Search Hudson's saved library using hybrid semantic + full-text search.

    Args:
        query: Search query (e.g., "context engineering", "self-directed learning")
        type: Filter by content type: book, blog, paper, podcast, page, tweet, video
        tags: Filter by tags
        person: Filter by person name (author)

    Returns:
        List of matching items with title, URL, type, and relevant excerpts
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{STOA_API}/search",
            json={
                "query": query,
                "user_id": _get_user_id(),
                "type": type,
                "tags": tags or [],
                "person_id": None,
                "limit": 10,
            },
        )
        return resp.json().get("results", [])


@mcp.tool()
def get_highlights(
    item_id: Optional[str] = None,
    person: Optional[str] = None,
    tag: Optional[str] = None,
) -> list[dict]:
    """Get saved highlights from Hudson's library.

    Args:
        item_id: Get highlights for a specific item
        person: Get highlights from items by this person
        tag: Get highlights from items with this tag

    Returns:
        List of highlights with text, context, note, and source info
    """
    sb = _supabase()
    query = sb.table("highlights").select("*, items(title, url, type)")

    if item_id:
        query = query.eq("item_id", item_id)

    query = query.eq("user_id", _get_user_id()).order("created_at", desc=True).limit(20)
    result = query.execute()
    return result.data or []


@mcp.tool()
def get_notes(
    item_id: Optional[str] = None,
    person: Optional[str] = None,
) -> list[dict]:
    """Get Hudson's notes, optionally filtered by item or person.

    Args:
        item_id: Get notes for a specific item
        person: Get notes about a specific person (by name)
    """
    sb = _supabase()
    query = sb.table("notes").select("*").eq("user_id", _get_user_id())

    if item_id:
        query = query.eq("item_id", item_id)

    result = query.order("updated_at", desc=True).limit(20).execute()
    return result.data or []


@mcp.tool()
async def add_item(
    url: str,
    tags: Optional[list[str]] = None,
    person: Optional[str] = None,
    collection: Optional[str] = None,
    type: str = "blog",
) -> dict:
    """Save a new item (URL) to Hudson's library.

    Args:
        url: The URL to save
        tags: Tags to apply
        person: Person name to link as author
        collection: Collection name to add to
        type: Content type (blog, paper, book, podcast, page, tweet, video)
    """
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{STOA_API}/ingest",
            json={
                "url": url,
                "user_id": _get_user_id(),
                "type": type,
                "tags": tags or [],
                "person_ids": [],
            },
        )
        return resp.json()


@mcp.tool()
async def add_citation(
    arxiv_id: Optional[str] = None,
    doi: Optional[str] = None,
    bibtex: Optional[str] = None,
) -> dict:
    """Add a research paper to the library.

    Provide one of: arxiv_id, doi, or bibtex string.

    Args:
        arxiv_id: arXiv paper ID (e.g., "2301.00234")
        doi: DOI identifier
        bibtex: Raw BibTeX entry
    """
    if arxiv_id:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{STOA_API}/ingest/arxiv/{arxiv_id}",
                params={"user_id": _get_user_id()},
            )
            return resp.json()
    elif bibtex:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{STOA_API}/citations/import",
                json={"bibtex": bibtex, "user_id": _get_user_id()},
            )
            return resp.json()
    else:
        return {"error": "Provide arxiv_id, doi, or bibtex"}


@mcp.tool()
def add_person(
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
        role: Relationship type: "mentor", "peer", "intellectual hero", "researcher"
        notes: Personal notes about this person
    """
    sb = _supabase()
    result = sb.table("people").insert({
        "user_id": _get_user_id(),
        "name": name,
        "twitter_handle": twitter,
        "website_url": website,
        "affiliation": affiliation,
        "role": role,
        "notes": notes,
    }).execute()
    return result.data[0] if result.data else {"error": "Failed to add person"}


@mcp.tool()
async def rag_query(question: str) -> dict:
    """Ask a question over Hudson's entire knowledge base using RAG.

    Retrieves relevant content from saved items and synthesizes an answer.

    Args:
        question: Natural language question (e.g., "What has Henrik Karlsson written about social graphs?")

    Returns:
        Answer with citations to source items
    """
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{STOA_API}/rag/query",
            json={"question": question, "user_id": _get_user_id()},
        )
        return resp.json()


@mcp.tool()
def get_reading_list(collection: Optional[str] = None) -> list[dict]:
    """Get items from Hudson's reading list or a specific collection.

    Args:
        collection: Collection name (e.g., "Friday Evening Reading"). If None, returns all to_read items.
    """
    sb = _supabase()

    if collection:
        result = (
            sb.table("collections")
            .select("id")
            .eq("user_id", _get_user_id())
            .eq("name", collection)
            .execute()
        )
        if not result.data:
            return []
        col_id = result.data[0]["id"]
        items = (
            sb.table("collection_items")
            .select("items(*)")
            .eq("collection_id", col_id)
            .order("sort_order")
            .execute()
        )
        return [ci["items"] for ci in items.data] if items.data else []
    else:
        result = (
            sb.table("items")
            .select("*")
            .eq("user_id", _get_user_id())
            .eq("reading_status", "to_read")
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return result.data or []


@mcp.tool()
def get_review_queue() -> list[dict]:
    """Get highlights due for spaced repetition review."""
    sb = _supabase()
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    result = (
        sb.table("review_queue")
        .select("*, highlights(text, context, note)")
        .eq("user_id", _get_user_id())
        .lte("next_review_at", now)
        .order("next_review_at")
        .limit(10)
        .execute()
    )
    return result.data or []


@mcp.tool()
def get_milieu_graph() -> dict:
    """Get Hudson's intellectual milieu: all people and their connections.

    Returns a graph of people in the milieu with their roles, affiliations,
    and connections to each other.
    """
    sb = _supabase()
    user_id = _get_user_id()

    people = (
        sb.table("people")
        .select("id, name, affiliation, role, tags, notes")
        .eq("user_id", user_id)
        .execute()
    )

    connections = (
        sb.table("person_connections")
        .select("from_person_id, to_person_id, relation, notes")
        .eq("user_id", user_id)
        .execute()
    )

    return {
        "people": people.data or [],
        "connections": connections.data or [],
    }


@mcp.tool()
def get_person(name: str) -> dict:
    """Get details about a person in Hudson's milieu, including their saved content.

    Args:
        name: Person's name (fuzzy match)
    """
    sb = _supabase()
    user_id = _get_user_id()

    # Fuzzy match on name
    result = (
        sb.table("people")
        .select("*")
        .eq("user_id", user_id)
        .ilike("name", f"%{name}%")
        .execute()
    )

    if not result.data:
        return {"error": f"No person found matching '{name}'"}

    person = result.data[0]

    # Get their items
    items = (
        sb.table("person_items")
        .select("relation, items(id, title, url, type, reading_status)")
        .eq("person_id", person["id"])
        .execute()
    )

    # Get connections
    connections = (
        sb.table("person_connections")
        .select("to_person_id, relation, notes, people!person_connections_to_person_id_fkey(name)")
        .eq("from_person_id", person["id"])
        .execute()
    )

    return {
        "person": person,
        "items": items.data or [],
        "connections": connections.data or [],
    }


def _get_user_id() -> str:
    """Get the configured user ID."""
    return os.getenv("STOA_USER_ID", "")


if __name__ == "__main__":
    mcp.run()
