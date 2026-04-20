"""SHA-256 helpers for reconciliation.

Binary files (PDF, image) → hash full bytes.
Markdown notes            → hash body after YAML frontmatter, so that updated_at
                             drift in the frontmatter does not falsely flag a
                             content change during round-trip.
URL placeholders (.webloc, .gdoc.webloc, .github.webloc)
                          → hash the canonical URL key, not the plist bytes
                             (plist whitespace changes between macOS versions).
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Tuple


_FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)


def hash_bytes(data: bytes) -> str:
    """SHA-256 of raw bytes, returned as 64-char hex string."""
    return hashlib.sha256(data).hexdigest()


def hash_note_body(text: str) -> str:
    """SHA-256 of note body (content below YAML frontmatter).

    Falsified mtime/updated_at edits to frontmatter alone MUST NOT count as
    content changes; otherwise every Stoa write triggers a pull, and every
    pull triggers a frontmatter rewrite, causing an infinite ping-pong.
    """
    stripped = _FRONTMATTER_RE.sub("", text, count=1)
    return hashlib.sha256(stripped.encode("utf-8", errors="replace")).hexdigest()


def hash_url_placeholder(url: str) -> str:
    """Hash just the canonical URL for webloc-style placeholder files.

    Handles URL, GDoc, and GitHub repo items where the on-disk file is a
    metadata wrapper, not the content itself.
    """
    return hashlib.sha256((url or "").strip().encode("utf-8")).hexdigest()


def hash_file(path: Path) -> Tuple[str, int]:
    """Hash a file on disk. Returns (hex_digest, size_bytes).

    For notes (.md) hash body-only. For everything else hash raw bytes.
    """
    suffix = path.suffix.lower()
    if suffix == ".md":
        text = path.read_text(encoding="utf-8", errors="replace")
        return hash_note_body(text), path.stat().st_size
    data = path.read_bytes()
    return hash_bytes(data), len(data)
