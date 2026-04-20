"""Vault filesystem layout + item-type routing.

Mapping (see feat/folder-sync spec):

    PDF           → "<slug title>.pdf"
    image         → "<slug title>.<ext>"
    URL           → "<slug title>.webloc"        (macOS plist pointing at URL)
    GDoc          → "<slug title>.gdoc.webloc"
    GitHub repo   → "<owner>_<repo>.github.webloc"
    Email thread  → "<slug subject>.email.md"    (rendered markdown)
    Project note  → "<slug title>.md"            (with frontmatter)
    Evergreen     → "_evergreen/<slug title>.md"

Folders in Stoa map 1:1 to subdirectories on disk via folder path. Root
folder (path "/") maps to the vault root.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional


VAULT_HIDDEN = ".stoa"
EVERGREEN_DIR = "_evergreen"
SYNC_LOCK = "sync.lock"
MANIFEST_JSON = "manifest.json"
ANNOTATIONS_DIR = "annotations"
COMMENTS_DIR = "comments"
# iPad Apple-Pencil ink, per-item/per-page; .pkd stays local, .png uploads to storage.
INK_DIR = "ink"
ITEMS_DIR = "items"  # Mac daemon writes <item_id>.json here so iPad can map file URL → item_id


_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

# Filesystem-hostile characters on macOS (/ and NUL) plus Windows reserved
# (< > : " | ? * and trailing dots/spaces).
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def slugify_filename(name: str, fallback: str = "untitled") -> str:
    """Sanitize a string for safe use as a single filename segment.

    Keeps spaces, unicode letters, hyphens, apostrophes — unlike URL slugs
    these files live in a human-browsable vault. Preview.app shows titles.
    """
    if not name:
        return fallback
    cleaned = _UNSAFE.sub("", name).strip().strip(".")
    # Collapse runs of whitespace to a single space.
    cleaned = re.sub(r"\s+", " ", cleaned)
    # Windows-reserved base names.
    if cleaned.upper() in _WINDOWS_RESERVED:
        cleaned = f"_{cleaned}"
    # macOS hard limit: 255 bytes per filename component.
    if len(cleaned.encode("utf-8")) > 200:
        cleaned = cleaned.encode("utf-8")[:200].decode("utf-8", errors="ignore").rstrip()
    return cleaned or fallback


def folder_relpath(folder_path: str) -> Path:
    """Convert a Stoa folder.path ('/' or '/lit-review/hci') to a vault-relative
    POSIX path. Root is empty path."""
    if folder_path in (None, "", "/"):
        return Path("")
    return Path(folder_path.lstrip("/"))


def item_filename(item: dict) -> str:
    """Compute the on-disk filename for an item dict from `items` table."""
    itype = (item.get("type") or "").lower()
    title = item.get("title") or "untitled"
    url = item.get("url") or ""
    slug = slugify_filename(title)

    if itype in ("paper", "pdf"):
        return f"{slug}.pdf"

    if itype == "image":
        # Best-effort extension from stored filename metadata, else .png.
        meta = item.get("metadata") or {}
        orig = meta.get("filename") or ""
        ext = Path(orig).suffix.lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"):
            ext = ".png"
        return f"{slug}{ext}"

    if itype == "gdoc":
        return f"{slug}.gdoc.webloc"

    if itype == "github_repo":
        slug_gh = (item.get("github_slug") or "").replace("/", "_")
        if not slug_gh:
            slug_gh = slug
        return f"{slug_gh}.github.webloc"

    if itype == "email_thread":
        return f"{slug}.email.md"

    # URL / blog / page / writing / book — use .webloc as a browsable pointer.
    if url:
        return f"{slug}.webloc"

    # Typeless or note-like → markdown fallback.
    return f"{slug}.md"


def note_filename(note: dict) -> str:
    """On-disk filename for a project note, respecting evergreen flag."""
    slug = slugify_filename(note.get("title") or "untitled")
    fname = f"{slug}.md"
    if note.get("evergreen"):
        return str(Path(EVERGREEN_DIR) / fname)
    return fname


def classify_file(relpath: str) -> str:
    """Reverse mapping: relative POSIX path → item-kind hint.

    Returns one of: 'pdf','image','url','gdoc','github_repo','email_thread',
    'note','evergreen_note','unknown'. This is a hint — the ingest pipeline
    is authoritative for final type.
    """
    rp = relpath.lower()
    if rp.endswith(".pdf"):
        return "pdf"
    if rp.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic")):
        return "image"
    if rp.endswith(".gdoc.webloc"):
        return "gdoc"
    if rp.endswith(".github.webloc"):
        return "github_repo"
    if rp.endswith(".email.md"):
        return "email_thread"
    if rp.endswith(".webloc"):
        return "url"
    if rp.endswith(".md"):
        if rp.startswith(f"{EVERGREEN_DIR}/") or f"/{EVERGREEN_DIR}/" in rp:
            return "evergreen_note"
        return "note"
    return "unknown"


def is_hidden_or_system(relpath: str) -> bool:
    """True if the path is inside .stoa/, a dotfile, or a conflict file we wrote."""
    parts = Path(relpath).parts
    if not parts:
        return True
    if parts[0] == VAULT_HIDDEN:
        return True
    if parts[0].startswith(".DS_Store") or any(p.startswith(".") and p != EVERGREEN_DIR for p in parts):
        return True
    return False


def build_webloc_plist(url: str) -> bytes:
    """Build a minimal macOS .webloc XML plist pointing at `url`."""
    # Escape & and < in URL — enough for URLs.
    safe = (url or "").replace("&", "&amp;").replace("<", "&lt;")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        '<dict>\n'
        '\t<key>URL</key>\n'
        f'\t<string>{safe}</string>\n'
        '</dict>\n'
        '</plist>\n'
    ).encode("utf-8")


def ink_dir(vault_root: Path, item_id: str) -> Path:
    """Absolute path to the ink directory for an item: .stoa/ink/<item_id>/"""
    return vault_root / VAULT_HIDDEN / INK_DIR / item_id


def ink_page_basename(page_index: int) -> str:
    """Zero-padded page basename: page_index=0 → 'p001', page_index=42 → 'p043'.

    We use 1-based display (p001 = first page) to match human page numbering
    in UIs and file browsers. page_index=0 internally ↔ p001 on disk.
    """
    return f"p{page_index + 1:03d}"


def ink_png_path(vault_root: Path, item_id: str, page_index: int) -> Path:
    return ink_dir(vault_root, item_id) / f"{ink_page_basename(page_index)}.png"


def ink_pkd_path(vault_root: Path, item_id: str, page_index: int) -> Path:
    return ink_dir(vault_root, item_id) / f"{ink_page_basename(page_index)}.pkd"


def ink_meta_path(vault_root: Path, item_id: str, page_index: int) -> Path:
    return ink_dir(vault_root, item_id) / f"{ink_page_basename(page_index)}.meta.json"


def items_manifest_path(vault_root: Path, item_id: str) -> Path:
    """Per-item manifest written by the Mac daemon so iPad can resolve file URL → item_id.

    Contents: {"item_id": "...", "title": "...", "path": "vault-relative.pdf"}
    """
    return vault_root / VAULT_HIDDEN / ITEMS_DIR / f"{item_id}.json"


def parse_ink_png_relpath(rel: str) -> Optional[tuple[str, int]]:
    """Reverse ink layout: .stoa/ink/<item_id>/pNNN.png → (item_id, page_index).

    Returns None for anything that isn't an ink PNG. page_index is 0-based.
    """
    parts = Path(rel).parts
    if len(parts) != 4:
        return None
    if parts[0] != VAULT_HIDDEN or parts[1] != INK_DIR:
        return None
    item_id = parts[2]
    fname = parts[3]
    if not fname.startswith("p") or not fname.endswith(".png"):
        return None
    try:
        page_num = int(fname[1:-4])
    except ValueError:
        return None
    if page_num < 1:
        return None
    return item_id, page_num - 1


def parse_webloc_url(data: bytes) -> Optional[str]:
    """Extract the URL from a .webloc XML plist."""
    try:
        text = data.decode("utf-8", errors="replace")
    except Exception:
        return None
    m = re.search(r"<key>URL</key>\s*<string>([^<]+)</string>", text)
    if m:
        return m.group(1).replace("&amp;", "&").replace("&lt;", "<")
    return None
