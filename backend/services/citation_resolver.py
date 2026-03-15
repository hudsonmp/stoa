"""Citation resolution: Semantic Scholar + CrossRef APIs.

Resolution chain: URL identifiers → DOI → arXiv → title search.
Stops at first successful resolution.
"""

import re
from typing import Optional

import httpx

# Regex patterns for identifier extraction
DOI_PATTERN = re.compile(r'10\.\d{4,9}/[-._;()/:A-Za-z0-9]+')
ARXIV_PATTERN = re.compile(r'(\d{4}\.\d{4,5})(v\d+)?')

S2_BASE = "https://api.semanticscholar.org/graph/v1"
CROSSREF_BASE = "https://api.crossref.org/works"

S2_FIELDS = "title,authors,year,venue,externalIds,citationCount,abstract,embedding.specter_v2"


def extract_doi_from_text(text: str) -> Optional[str]:
    """Extract first DOI from text (typically first page of a paper)."""
    match = DOI_PATTERN.search(text)
    if match:
        doi = match.group(0).rstrip('.')
        return doi
    return None


def extract_doi_from_url(url: str) -> Optional[str]:
    """Extract DOI from URL path (e.g., doi.org/10.1234/...)."""
    if "doi.org/" in url:
        match = DOI_PATTERN.search(url)
        if match:
            return match.group(0).rstrip('.')
    return None


def extract_arxiv_id_from_url(url: str) -> Optional[str]:
    """Extract arXiv ID from URL."""
    if "arxiv.org" not in url:
        return None
    match = ARXIV_PATTERN.search(url)
    return match.group(1) if match else None


async def resolve_via_crossref(doi: str) -> Optional[dict]:
    """Resolve citation metadata via CrossRef API."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{CROSSREF_BASE}/{doi}",
            headers={"User-Agent": "Stoa/1.0 (mailto:hudson@hudsonmp.com)"},
        )
        if resp.status_code != 200:
            return None

        data = resp.json().get("message", {})

        authors = []
        for a in data.get("author", []):
            name = f"{a.get('given', '')} {a.get('family', '')}".strip()
            if name:
                authors.append({"name": name})

        year = None
        date_parts = data.get("published", {}).get("date-parts", [[]])
        if date_parts and date_parts[0]:
            year = date_parts[0][0]

        venue = None
        containers = data.get("container-title", [])
        if containers:
            venue = containers[0]

        # Generate BibTeX
        bibtex = _generate_bibtex(
            authors=authors,
            title=data.get("title", [""])[0] if data.get("title") else "",
            year=year,
            venue=venue,
            doi=doi,
        )

        return {
            "authors": authors,
            "year": year,
            "venue": venue,
            "doi": doi,
            "abstract": data.get("abstract"),
            "bibtex": bibtex,
            "citation_count": data.get("is-referenced-by-count"),
        }


async def resolve_via_semantic_scholar(
    paper_id: str, id_type: str = "DOI"
) -> Optional[dict]:
    """Resolve via Semantic Scholar. id_type: DOI, ArXiv, CorpusId, or direct paperId."""
    if id_type == "DOI":
        query_id = f"DOI:{paper_id}"
    elif id_type == "ArXiv":
        query_id = f"ArXiv:{paper_id}"
    else:
        query_id = paper_id

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{S2_BASE}/paper/{query_id}",
            params={"fields": S2_FIELDS},
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        return _normalize_s2_result(data)


async def search_by_title(title: str) -> Optional[dict]:
    """Search Semantic Scholar by title, return best match."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{S2_BASE}/paper/search",
            params={"query": title, "limit": 3, "fields": S2_FIELDS},
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        papers = data.get("data", [])
        if not papers:
            return None

        # Simple title similarity: pick the first result (S2 ranks by relevance)
        best = papers[0]
        return _normalize_s2_result(best)


def _normalize_s2_result(data: dict) -> dict:
    """Normalize Semantic Scholar response to our citation format."""
    authors = [{"name": a.get("name", "")} for a in data.get("authors", [])]
    external_ids = data.get("externalIds") or {}

    doi = external_ids.get("DOI")
    arxiv_id = external_ids.get("ArXiv")

    bibtex = _generate_bibtex(
        authors=authors,
        title=data.get("title", ""),
        year=data.get("year"),
        venue=data.get("venue"),
        doi=doi,
    )

    # Extract SPECTER2 embedding if available (768 dims)
    # S2 API returns: {"embedding": {"model": "specter_v2", "vector": [...]}}
    specter_embedding = None
    embedding_data = data.get("embedding") or {}
    if (
        isinstance(embedding_data, dict)
        and embedding_data.get("model") == "specter_v2"
        and embedding_data.get("vector")
    ):
        specter_embedding = embedding_data["vector"]

    result = {
        "authors": authors,
        "year": data.get("year"),
        "venue": data.get("venue") or None,
        "doi": doi,
        "arxiv_id": arxiv_id,
        "abstract": data.get("abstract"),
        "bibtex": bibtex,
        "citation_count": data.get("citationCount"),
        "s2_paper_id": data.get("paperId"),
    }
    if specter_embedding:
        result["specter_embedding"] = specter_embedding
    return result


async def resolve_citation(
    url: Optional[str] = None,
    title: Optional[str] = None,
    text: Optional[str] = None,
) -> Optional[dict]:
    """Main resolution chain. Try multiple strategies, return first success.

    Args:
        url: Item URL (may contain DOI or arXiv ID)
        title: Item title (fallback for title search)
        text: First ~3000 chars of extracted text (for DOI extraction)
    """
    # Strategy 1: Extract arXiv ID from URL
    if url:
        arxiv_id = extract_arxiv_id_from_url(url)
        if arxiv_id:
            result = await resolve_via_semantic_scholar(arxiv_id, id_type="ArXiv")
            if result:
                result.setdefault("arxiv_id", arxiv_id)
                return result

    # Strategy 2: Extract DOI from URL
    if url:
        doi = extract_doi_from_url(url)
        if doi:
            result = await resolve_via_crossref(doi)
            if result:
                return result

    # Strategy 3: Extract DOI from extracted text (first page)
    if text:
        doi = extract_doi_from_text(text[:3000])
        if doi:
            result = await resolve_via_crossref(doi)
            if result:
                return result

    # Strategy 4: Search by title via Semantic Scholar
    if title:
        result = await search_by_title(title)
        if result:
            return result

    return None


def _generate_bibtex(
    authors: list[dict],
    title: str,
    year: Optional[int],
    venue: Optional[str],
    doi: Optional[str],
) -> str:
    """Generate a BibTeX entry from citation metadata."""
    # Cite key: first author last name + year
    cite_key = "unknown"
    if authors:
        last_name = authors[0]["name"].split()[-1].lower() if authors[0]["name"] else "unknown"
        cite_key = f"{last_name}{year or ''}"

    author_str = " and ".join(a["name"] for a in authors if a["name"])

    lines = [f"@article{{{cite_key},"]
    if title:
        lines.append(f"  title = {{{title}}},")
    if author_str:
        lines.append(f"  author = {{{author_str}}},")
    if year:
        lines.append(f"  year = {{{year}}},")
    if venue:
        lines.append(f"  journal = {{{venue}}},")
    if doi:
        lines.append(f"  doi = {{{doi}}},")
    lines.append("}")

    return "\n".join(lines)
