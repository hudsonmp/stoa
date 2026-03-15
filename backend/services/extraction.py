"""Content extraction: articles via trafilatura, PDFs via PyMuPDF."""

import logging
import re
import unicodedata
from urllib.parse import urlparse

import httpx
import trafilatura
import fitz  # PyMuPDF

logger = logging.getLogger(__name__)


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
    """Extract structured markdown and metadata from a PDF using pymupdf4llm."""
    import pymupdf4llm
    import tempfile
    import os

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    meta = doc.metadata or {}
    page_count = len(doc)
    doc.close()

    # pymupdf4llm needs a file path, so write to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name

    try:
        # Extract as markdown with embedded images and table structure
        markdown_text = pymupdf4llm.to_markdown(
            tmp_path,
            embed_images=True,   # Embed images as base64 data URIs in markdown
            show_progress=False,
        )
    except Exception:
        # Fallback to basic extraction if pymupdf4llm fails
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = [page.get_text() for page in doc]
        markdown_text = "\n\n".join(pages)
        doc.close()
    finally:
        os.unlink(tmp_path)

    return {
        "title": meta.get("title") or "Untitled PDF",
        "author": meta.get("author"),
        "extracted_text": markdown_text,
        "page_count": page_count,
    }


def _normalize_name(name: str) -> str:
    """Normalize name for matching: strip diacritics, lowercase, collapse whitespace."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", ascii_name.strip().lower())


def _is_personal_email(email: str) -> bool:
    """Filter out group/departmental emails."""
    local = email.split("@")[0].lower()
    reject_patterns = [
        "info", "admin", "contact", "office", "dept", "department",
        "lab", "group", "team", "help", "support", "noreply", "no-reply",
        "webmaster", "postmaster", "secretary", "general",
    ]
    return not any(p in local for p in reject_patterns)


def _name_matches_email(name: str, email: str) -> float:
    """Score how well a name matches an email address (0.0 to 1.0)."""
    local = email.split("@")[0].lower().replace(".", " ").replace("-", " ").replace("_", " ")
    name_parts = _normalize_name(name).split()
    if not name_parts:
        return 0.0

    matches = 0
    for part in name_parts:
        if len(part) >= 2 and part in local:
            matches += 1
        elif len(part) >= 1 and part[0] in local:
            matches += 0.3

    return matches / len(name_parts)


def extract_authors_and_emails(pdf_bytes: bytes) -> list[dict]:
    """Extract author names and emails from the first page of a PDF.

    Returns list of {"name": str, "email": str|None, "affiliation": str|None}.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if len(doc) == 0:
        doc.close()
        return []

    first_page_text = doc[0].get_text()
    # Also check second page for papers with large title blocks
    second_page_text = doc[1].get_text() if len(doc) > 1 else ""
    doc.close()

    text = first_page_text + "\n" + second_page_text

    # 1. Extract all emails
    emails = re.findall(r"[\w.+-]+@[\w.-]+\.\w{2,}", text)
    emails = [e for e in emails if _is_personal_email(e)]

    # 2. Extract author block: text before "Abstract" or "Introduction"
    abstract_pos = None
    for marker in ["Abstract", "ABSTRACT", "Introduction", "INTRODUCTION", "1.", "I."]:
        idx = text.find(marker)
        if idx > 50:  # must be after some content
            if abstract_pos is None or idx < abstract_pos:
                abstract_pos = idx

    author_block = text[:abstract_pos] if abstract_pos else text[:2000]

    # 3. Extract affiliations from author block (lines with university/institute keywords)
    affiliation_lines = []
    for line in author_block.split("\n"):
        line_lower = line.strip().lower()
        if any(kw in line_lower for kw in ["university", "institute", "college", "lab", "department", "dept", "school of"]):
            affiliation_lines.append(line.strip())

    # 4. Try to extract author names from citation metadata if available
    # For now, use heuristic: lines in author block that look like names
    # (2-4 capitalized words, no digits, not too long)
    potential_names = []
    # Skip the first 1-2 non-empty lines (likely the title)
    lines = [l.strip() for l in author_block.split("\n") if l.strip()]
    title_skip = min(2, len(lines))  # skip first 2 lines (title + subtitle)
    for line in lines[title_skip:]:
        # Clean up common PDF artifacts
        line = re.sub(r"[∗†‡§¶\*\+\d]", "", line).strip()
        line = re.sub(r"\s*[,;]\s*$", "", line)
        if not line:
            continue
        # Check if line looks like a personal name (2-4 words, all capitalized,
        # reasonable length, no common academic/title words)
        words = line.split()
        if 2 <= len(words) <= 4 and 5 < len(line) < 35:
            if all(w[0].isupper() or w[0] in "dvl" for w in words if len(w) > 0):
                if not any(c.isdigit() for c in line):
                    line_lower = line.lower()
                    # Reject lines that contain non-name words
                    reject = ["university", "institute", "abstract", "department",
                              "http", "@", "arxiv", "ieee", "acm", "proceedings"]
                    if not any(kw in line_lower for kw in reject):
                        potential_names.append(line)

    # 5. Also try splitting comma/and-separated author lines
    expanded_names = []
    for name in potential_names:
        if ", " in name and " and " not in name.lower():
            # Could be "Last, First" format or "Name1, Name2"
            parts = [p.strip() for p in name.split(",")]
            if all(len(p.split()) <= 3 for p in parts):
                expanded_names.extend(parts)
            else:
                expanded_names.append(name)
        elif " and " in name.lower():
            parts = re.split(r"\s+and\s+", name, flags=re.IGNORECASE)
            expanded_names.extend(p.strip() for p in parts)
        else:
            expanded_names.append(name)

    # Deduplicate while preserving order
    seen = set()
    unique_names = []
    for n in expanded_names:
        key = _normalize_name(n)
        if key not in seen and len(key) > 3:
            seen.add(key)
            unique_names.append(n)

    # 6. Match emails to names
    unmatched_emails = list(emails)
    results = []

    for name in unique_names:
        best_email = None
        best_score = 0.0
        for email in unmatched_emails:
            score = _name_matches_email(name, email)
            if score > best_score:
                best_score = score
                best_email = email

        matched_email = None
        if best_email and best_score >= 0.3:
            matched_email = best_email
            unmatched_emails.remove(best_email)

        # Find closest affiliation
        affiliation = affiliation_lines[0] if affiliation_lines else None

        results.append({
            "name": name,
            "email": matched_email,
            "affiliation": affiliation,
        })

    return results


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
