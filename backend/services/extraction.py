"""Content extraction: articles via trafilatura, PDFs via PyMuPDF."""

import re
from urllib.parse import urlparse

import httpx
import trafilatura
import fitz  # PyMuPDF


async def extract_from_url(url: str) -> dict:
    """Extract article content and metadata from a URL."""
    from services.url_validator import validate_url

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        resp = await client.get(url, headers={"User-Agent": "Stoa/1.0"})
        # Re-validate final URL after redirects to prevent redirect-based SSRF
        validate_url(str(resp.url))
        html = resp.text

    extracted = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
        output_format="txt",
    )

    metadata = trafilatura.extract(
        html,
        include_comments=False,
        output_format="xmltei",
    )

    meta = trafilatura.metadata.extract_metadata(html) if hasattr(trafilatura, 'metadata') else None

    title = None
    author = None
    date = None
    if meta:
        title = getattr(meta, 'title', None)
        author = getattr(meta, 'author', None)
        date = getattr(meta, 'date', None)

    # Fallback title extraction from HTML
    if not title:
        match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        if match:
            title = match.group(1).strip()

    parsed = urlparse(url)
    domain = parsed.netloc.replace("www.", "")

    # Extract favicon
    favicon_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=64"

    return {
        "title": title or domain,
        "author": author,
        "date": date,
        "domain": domain,
        "favicon_url": favicon_url,
        "extracted_text": extracted or "",
        "url": url,
    }


def extract_from_pdf(pdf_bytes: bytes) -> dict:
    """Extract text and metadata from a PDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    meta = doc.metadata or {}

    pages = []
    for page in doc:
        pages.append(page.get_text())

    full_text = "\n\n".join(pages)

    return {
        "title": meta.get("title") or "Untitled PDF",
        "author": meta.get("author"),
        "extracted_text": full_text,
        "page_count": len(doc),
    }


async def fetch_arxiv_metadata(arxiv_id: str) -> dict:
    """Fetch paper metadata from arXiv API."""
    clean_id = arxiv_id.replace("arxiv:", "").replace("arXiv:", "")

    # Validate arXiv ID format to prevent parameter injection
    if not re.match(r'^\d{4}\.\d{4,5}(v\d+)?$', clean_id):
        raise ValueError(f"Invalid arXiv ID format: {clean_id}")

    api_url = f"http://export.arxiv.org/api/query?id_list={clean_id}"

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(api_url)

    xml = resp.text
    print(f"[arXiv DEBUG] response length: {len(xml)}, has <entry>: {'<entry>' in xml}")

    def extract_tag(tag: str, text: str) -> str | None:
        match = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", text, re.DOTALL)
        return match.group(1).strip() if match else None

    # Extract from <entry> block to avoid matching feed-level tags
    entry_match = re.search(r"<entry>(.*?)</entry>", xml, re.DOTALL)
    entry_xml = entry_match.group(1) if entry_match else xml

    title = extract_tag("title", entry_xml)
    summary = extract_tag("summary", entry_xml)
    print(f"[arXiv DEBUG] title: {repr(title)}, entry_xml length: {len(entry_xml)}")

    # Extract authors from entry
    authors = re.findall(r"<name>(.*?)</name>", entry_xml)

    # Extract published date from entry
    published = extract_tag("published", entry_xml)
    year = int(published[:4]) if published else None

    # PDF URL
    pdf_url = f"https://arxiv.org/pdf/{clean_id}.pdf"

    return {
        "arxiv_id": clean_id,
        "title": title,
        "authors": [{"name": a} for a in authors],
        "abstract": summary,
        "year": year,
        "pdf_url": pdf_url,
        "url": f"https://arxiv.org/abs/{clean_id}",
    }
