"""Faculty email lookup: given a name + affiliation, try to find their email.

Ported from ~/find-open-courses/scrape_outreach.py with simplifications.
Strategy:
1. Search Google for "{name} {affiliation} email site:.edu"
2. Scrape faculty pages for email patterns
3. Fuzzy-match name to found emails
"""

import logging
import re
import unicodedata
from difflib import SequenceMatcher

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def _normalize(name: str) -> str:
    """Strip diacritics, lowercase, collapse whitespace."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", ascii_name.strip().lower())


def _extract_emails_from_html(html: str) -> list[str]:
    """Extract email addresses from HTML content."""
    # From text content
    emails = set(re.findall(r"[\w.+-]+@[\w.-]+\.\w{2,}", html))
    # From mailto: links
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("mailto:"):
            email = href.replace("mailto:", "").split("?")[0].strip()
            if "@" in email:
                emails.add(email)
    return list(emails)


def _is_personal_email(email: str) -> bool:
    """Filter out group/departmental/system emails."""
    local = email.split("@")[0].lower()
    reject = [
        "info", "admin", "contact", "office", "dept", "department",
        "lab", "group", "team", "help", "support", "noreply", "no-reply",
        "webmaster", "postmaster", "secretary", "general", "registrar",
        "admissions", "apply", "hr", "careers", "press", "media",
    ]
    return not any(p in local for p in reject)


def _name_similarity(name: str, email_local: str) -> float:
    """Score how well a person's name matches an email local part."""
    name_norm = _normalize(name)
    local = email_local.lower().replace(".", " ").replace("-", " ").replace("_", " ")

    # Direct substring match on last name
    parts = name_norm.split()
    if not parts:
        return 0.0

    last_name = parts[-1]
    first_name = parts[0] if len(parts) > 1 else ""

    score = 0.0
    # Last name in email (strongest signal)
    if last_name in local:
        score += 0.6
    # First name or initial in email
    if first_name and (first_name in local or first_name[0] in local.split()):
        score += 0.3
    # Fallback: sequence similarity
    if score == 0:
        score = SequenceMatcher(None, name_norm.replace(" ", ""), local.replace(" ", "")).ratio() * 0.5

    return min(score, 1.0)


async def resolve_faculty_email(name: str, affiliation: str | None = None) -> str | None:
    """Try to find a faculty member's email given their name and optional affiliation.

    Uses web scraping of faculty directory pages. Returns email or None.
    """
    if not name or len(name) < 3:
        return None

    # Build search queries for faculty pages
    search_terms = [name]
    if affiliation:
        search_terms.append(affiliation)

    # Try common faculty page URL patterns
    urls_to_try = []

    # If affiliation contains a university domain hint, try their directory
    if affiliation:
        aff_lower = affiliation.lower()
        # Extract potential domain from affiliation
        domain_hints = {
            "cmu": "cmu.edu", "carnegie mellon": "cmu.edu",
            "mit": "mit.edu", "stanford": "stanford.edu",
            "berkeley": "berkeley.edu", "ucsd": "ucsd.edu",
            "delft": "tudelft.nl", "melbourne": "unimelb.edu.au",
            "harvard": "harvard.edu", "princeton": "princeton.edu",
            "yale": "yale.edu", "nyu": "nyu.edu",
            "columbia": "columbia.edu", "cornell": "cornell.edu",
            "virginia tech": "vt.edu", "georgia tech": "gatech.edu",
        }
        for hint, domain in domain_hints.items():
            if hint in aff_lower:
                # Try Google Scholar profile (often has email)
                urls_to_try.append(f"https://scholar.google.com/citations?view_op=search_authors&mauthors={name.replace(' ', '+')}")
                # Try university directory
                last_name = name.split()[-1]
                urls_to_try.append(f"https://www.{domain}/search?q={name.replace(' ', '+')}")
                break

    # Try Semantic Scholar author page
    urls_to_try.append(f"https://api.semanticscholar.org/graph/v1/author/search?query={name.replace(' ', '+')}&limit=1")

    async with httpx.AsyncClient(
        timeout=15,
        follow_redirects=True,
        headers={"User-Agent": "Stoa/1.0 (academic research tool)"},
    ) as client:
        # Try Semantic Scholar API first (structured, no scraping)
        try:
            s2_resp = await client.get(
                f"https://api.semanticscholar.org/graph/v1/author/search",
                params={"query": name, "limit": 1, "fields": "name,url,externalIds"},
            )
            if s2_resp.status_code == 200:
                data = s2_resp.json()
                authors = data.get("data", [])
                if authors:
                    author_id = authors[0].get("authorId")
                    if author_id:
                        # Get author details including homepage
                        detail = await client.get(
                            f"https://api.semanticscholar.org/graph/v1/author/{author_id}",
                            params={"fields": "name,url,homepage,externalIds"},
                        )
                        if detail.status_code == 200:
                            author_data = detail.json()
                            homepage = author_data.get("homepage")
                            if homepage:
                                # Scrape homepage for email
                                try:
                                    page_resp = await client.get(homepage)
                                    if page_resp.status_code == 200:
                                        emails = _extract_emails_from_html(page_resp.text)
                                        personal = [e for e in emails if _is_personal_email(e)]
                                        for email in personal:
                                            if _name_similarity(name, email.split("@")[0]) >= 0.3:
                                                return email
                                except Exception:
                                    pass
        except Exception:
            logger.debug("Semantic Scholar lookup failed for %s", name)

        # Try scraping faculty pages
        for url in urls_to_try[:3]:  # limit to 3 URLs
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    emails = _extract_emails_from_html(resp.text)
                    personal = [e for e in emails if _is_personal_email(e)]
                    for email in personal:
                        if _name_similarity(name, email.split("@")[0]) >= 0.4:
                            return email
            except Exception:
                continue

    return None
