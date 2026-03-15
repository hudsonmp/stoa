"""Content extraction: articles via trafilatura, PDFs via PyMuPDF."""

import re
import unicodedata
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
        # Extract as markdown — don't embed images (causes 80-96% bloat)
        # Images are referenced as placeholders; the PDF view has the real images
        markdown_text = pymupdf4llm.to_markdown(
            tmp_path,
            write_images=False,
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

    # Clean up common pymupdf4llm artifacts
    markdown_text = _clean_pdf_markdown(markdown_text)

    # Detect if the paper is two-column layout
    is_two_column = _detect_two_column(pdf_bytes)

    # Title: use PDF metadata, fall back to extracting from markdown text
    title = meta.get("title") or _extract_title_from_text(markdown_text)

    return {
        "title": title,
        "author": meta.get("author"),
        "extracted_text": markdown_text,
        "page_count": page_count,
        "is_two_column": is_two_column,
    }


def _detect_two_column(pdf_bytes: bytes) -> bool:
    """Detect if a PDF uses a two-column layout by analyzing text block positions."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if len(doc) < 2:
            doc.close()
            return False
        # Check page 2 (body pages, skip title page)
        page = doc[min(1, len(doc) - 1)]
        page_width = page.rect.width
        blocks = page.get_text("dict")["blocks"]
        text_blocks = [b for b in blocks if b.get("type") == 0]
        doc.close()

        if len(text_blocks) < 6:
            return False

        midpoint = page_width / 2
        left = sum(1 for b in text_blocks if b["bbox"][0] < midpoint - 20)
        right = sum(1 for b in text_blocks if b["bbox"][0] > midpoint - 20)
        return left >= 3 and right >= 3
    except Exception:
        return False


def _extract_title_from_text(markdown: str) -> str:
    """Extract paper title from markdown when PDF metadata is missing."""
    _SKIP_HEADERS = {
        'OPEN ACCESS', 'RESEARCH-ARTICLE', 'ORIGINAL ARTICLE',
        'VIEW ALL', 'RESEARCH ARTICLE', 'REVIEW ARTICLE',
    }
    for line in markdown.split('\n'):
        line = line.strip()
        # Skip image placeholders and empty lines
        if 'intentionally omitted' in line or not line:
            continue
        # Skip very short lines (journal name, page markers)
        if len(line) < 10:
            continue
        # Use first substantial ## header as title
        if line.startswith('## '):
            title = line[3:].strip()
            if title.upper() not in _SKIP_HEADERS and len(title) > 10:
                return title
        # Use first # header as title
        if line.startswith('# ') and not line.startswith('# Table'):
            title = line[2:].strip()
            if title.upper() not in _SKIP_HEADERS and len(title) > 10:
                return title
    return "Untitled PDF"


def _clean_pdf_markdown(text: str) -> str:
    """Clean common artifacts from pymupdf4llm markdown output."""

    # --- Phase 0: Strip ACM Digital Library wrapper page ---
    # ACM DL PDFs downloaded from the web viewer prepend a metadata page with
    # navigation, citation counts, download stats, and Open Access badges.
    if 'Latest updates:' in text[:500] or 'Total Citations:' in text[:1000]:
        lines = text.split('\n')
        # Strategy: find the line containing the ACM reference format block
        # or the repeated paper title that marks the start of the actual paper.
        # The DL wrapper typically ends with "EISSN:" or a DOI line, followed
        # by the paper title repeated as a ## header.
        cut_line = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            # Look for EISSN (marks end of DL metadata) or ACM Reference Format
            if 'EISSN:' in stripped or 'ISSN:' in stripped:
                # The actual paper content starts shortly after this
                # Find the next ## header after this line
                for j in range(i + 1, min(i + 10, len(lines))):
                    if lines[j].strip().startswith('## ') or lines[j].strip().startswith('# '):
                        header_text = lines[j].strip().lstrip('#').strip()
                        if len(header_text) > 15:  # Must be a real title, not a short label
                            cut_line = j
                            break
                if cut_line > 0:
                    break
        if cut_line > 5:
            text = '\n'.join(lines[cut_line:])

    # --- Phase 1: Strip Private Use Area characters (ACM DL font ligatures) ---
    text = re.sub(r'[\uE000-\uF8FF]', '', text)

    # --- Phase 2: Character-level fixes ---

    # Remove stray page numbers on their own line (e.g., "1\n", "12\n")
    text = re.sub(r"^\d{1,3}\s*$", "", text, flags=re.MULTILINE)

    # Remove stray single-character lines (!, -, etc.)
    text = re.sub(r"^[!\-–—]\s*$", "", text, flags=re.MULTILINE)

    # Clean footnote markers: _[∗]_ _[†]_ _[1]_ → remove entirely or simplify
    text = re.sub(r"\s*_?\[[\*†‡§∗¶]+\]_?", "", text)

    # Clean affiliation blockquote markers: > _∗_ or > _†_ → just the text
    text = re.sub(r"^>\s*_?[∗†‡§¶\*]+_?\s*", "", text, flags=re.MULTILINE)

    # Clean numeric footnote refs in author names: [1] [2] etc. in first 500 chars
    # (but keep [1] references in body text which are citation refs)
    header = text[:800]
    body = text[800:]
    header = re.sub(r"\s*\[\d+\]\s*", " ", header)
    header = re.sub(r"\s*_\[,\]_\s*", ", ", header)  # _[,]_ separator → comma
    text = header + body

    # Fix broken diacritics from PDF extraction (e.g., Maur´ıcio → Maurício)
    # Common pattern: acute/grave/circumflex followed by the base letter
    _DIACRITIC_MAP = {
        # ASCII-style diacritics (from older PDF encodings)
        "´a": "\u00e1", "´e": "\u00e9", "´i": "\u00ed", "´ı": "\u00ed",
        "´o": "\u00f3", "´u": "\u00fa", "´y": "\u00fd",
        "´A": "\u00c1", "´E": "\u00c9", "´I": "\u00cd", "´O": "\u00d3",
        "´U": "\u00da",
        "`a": "\u00e0", "`e": "\u00e8", "`i": "\u00ec", "`o": "\u00f2", "`u": "\u00f9",
        "~a": "\u00e3", "~n": "\u00f1", "~o": "\u00f5",
        "~A": "\u00c3", "~N": "\u00d1", "~O": "\u00d5",
        "^a": "\u00e2", "^e": "\u00ea", "^i": "\u00ee", "^o": "\u00f4", "^u": "\u00fb",
        '"a': "\u00e4", '"e': "\u00eb", '"i': "\u00ef", '"o': "\u00f6", '"u': "\u00fc",
        '"A': "\u00c4", '"O': "\u00d6", '"U': "\u00dc",
        "¸c": "\u00e7", "¸C": "\u00c7",
        # Unicode diacritic marks (from newer PDF encodings)
        "\u00A8a": "\u00e4", "\u00A8e": "\u00eb", "\u00A8o": "\u00f6",
        "\u00A8u": "\u00fc", "\u00A8i": "\u00ef",
        "\u00A8A": "\u00c4", "\u00A8O": "\u00d6", "\u00A8U": "\u00dc",
        "\u02DAa": "\u00e5", "\u02DAA": "\u00c5",  # ring above: ˚a → å
        "\u00B4a": "\u00e1", "\u00B4e": "\u00e9", "\u00B4i": "\u00ed",
        "\u00B4o": "\u00f3", "\u00B4u": "\u00fa",
    }
    for raw, fixed in _DIACRITIC_MAP.items():
        text = text.replace(raw, fixed)

    # --- Phase 3: Fix ligature-broken words ---
    # PDF fonts encode fi/fl/ff/ffi/ffl/ft as ligature glyphs that sometimes
    # get dropped during extraction, producing broken words.
    _LIGATURE_FIXES = [
        # fi ligature
        ("specifc", "specific"), ("Specifc", "Specific"), ("SPECIFC", "SPECIFIC"),
        ("confdenc", "confidenc"), ("Confdenc", "Confidenc"),
        ("identifcat", "identificat"), ("Identifcat", "Identificat"),
        ("signicant", "significant"), ("Signicant", "Significant"),
        ("scientifc", "scientific"), ("Scientifc", "Scientific"),
        ("beneft", "benefit"), ("Beneft", "Benefit"),
        ("defne", "define"), ("Defne", "Define"),
        ("defnit", "definit"), ("Defnit", "Definit"),
        ("certifcat", "certificat"),
        # fl ligature
        ("refect", "reflect"), ("Refect", "Reflect"),
        ("confct", "conflict"), ("Confct", "Conflict"),
        ("infuenc", "influenc"), ("Infuenc", "Influenc"),
        # ff ligature
        ("diferent", "different"), ("Diferent", "Different"),
        ("afect", "affect"), ("Afect", "Affect"),
        ("efectiv", "effectiv"), ("Efectiv", "Effectiv"),
        ("oferr", "offerr"),
        # ffi ligature
        ("efcien", "efficien"), ("Efcien", "Efficien"),
        ("difcult", "difficult"), ("Difcult", "Difficult"),
        # ft ligature (ACM DL wrapper fonts)
        ("soware", "software"), ("Soware", "Software"),
    ]
    for broken, fixed in _LIGATURE_FIXES:
        text = text.replace(broken, fixed)

    # --- Phase 4: Structural cleanup ---

    # Clean remaining _[,]_ and _[;]_ separators in body text
    text = re.sub(r"\s*_\[,\]_\s*", ", ", text)
    text = re.sub(r"\s*_\[;\]_\s*", "; ", text)

    # Clean redundant bold inside headers: ## **Title** → ## Title
    text = re.sub(r"^(#{1,6})\s+\*\*(.+?)\*\*\s*$", r"\1 \2", text, flags=re.MULTILINE)

    # Clean picture placeholder text and separator markers
    text = re.sub(r"^----- (?:Start|End) of picture text -----$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^==> picture \[\d+ x \d+\] intentionally omitted <==$", "", text, flags=re.MULTILINE)

    # Strip "Page X of Y" markers
    text = re.sub(r"^Page \d+ of \d+\s*$", "", text, flags=re.MULTILINE)

    # Strip ACM article page markers (e.g., "FSE072:3", "103:2")
    text = re.sub(r"^[A-Z]{2,10}\d{2,5}:\d{1,3}\s*$", "", text, flags=re.MULTILINE)

    # --- Phase 5: Strip running headers/footers ---
    # Deduplicate lines appearing 3+ times that are >20 chars (running headers)
    lines = text.split('\n')
    line_counts: dict[str, int] = {}
    for line in lines:
        stripped = line.strip()
        if len(stripped) > 20:
            line_counts[stripped] = line_counts.get(stripped, 0) + 1
    repeated = {k for k, v in line_counts.items() if v >= 3}
    if repeated:
        lines = [l for l in lines if l.strip() not in repeated]
        text = '\n'.join(lines)

    # --- Phase 6: Final cleanup ---

    # Collapse excessive blank lines (3+ → 2)
    text = re.sub(r"\n{4,}", "\n\n\n", text)

    # Remove leading/trailing whitespace on lines
    text = "\n".join(line.rstrip() for line in text.split("\n"))

    return text.strip()



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
