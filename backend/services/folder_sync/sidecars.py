"""Sidecar file I/O for .stoa/annotations/ and .stoa/comments/.

Annotations are W3C Web Annotation model shape (approx):
    { "id": "...", "target": {...selectors...}, "body": "...", "color": "...",
      "created_at": "...", "page_number": n, "note": "..." }

The sidecar is a JSON array. The vault filesystem MUST hold ONLY bytes +
these sidecars — never Stoa-specific metadata burned into the primary file.
This is the invariant that lets Hudson open the PDF in Preview.app and see
the unmodified paper.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from .fs_layout import (
    VAULT_HIDDEN,
    ANNOTATIONS_DIR,
    COMMENTS_DIR,
    INK_DIR,
    ink_dir,
    ink_png_path,
    ink_pkd_path,
    ink_meta_path,
    parse_ink_png_relpath,
)


def _safe_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)


def annotations_path(vault_root: Path, item_id: str) -> Path:
    return vault_root / VAULT_HIDDEN / ANNOTATIONS_DIR / f"{item_id}.json"


def comments_path(vault_root: Path, note_id: str) -> Path:
    return vault_root / VAULT_HIDDEN / COMMENTS_DIR / f"note-{note_id}.json"


def write_annotations(vault_root: Path, item_id: str, highlights: List[Dict[str, Any]]) -> None:
    """Write highlights for an item as a W3C-shape annotation array.

    Input `highlights` is project_highlights rows (selectors, text, color, etc.)
    Non-destructive: even 0 highlights writes [] so other tools see an empty
    list rather than a missing file.
    """
    out: List[Dict[str, Any]] = []
    for h in highlights or []:
        ann: Dict[str, Any] = {
            "id": h.get("id"),
            "type": "Annotation",
            "body": [
                {"type": "TextualBody", "value": h.get("text") or "", "purpose": "commenting"},
            ],
            "target": {},
            "color": h.get("color") or "yellow",
            "created_at": h.get("created_at"),
        }
        # W3C selectors: project_highlights.selectors is the authoritative list.
        selectors = h.get("selectors")
        if selectors:
            ann["target"]["selector"] = selectors
        if h.get("page_number") is not None:
            ann["target"]["page"] = h["page_number"]
        if h.get("context"):
            ann["target"]["context"] = h["context"]
        if h.get("note"):
            ann["body"].append(
                {"type": "TextualBody", "value": h["note"], "purpose": "describing"}
            )
        out.append(ann)

    _safe_write(annotations_path(vault_root, item_id), json.dumps(out, indent=2, ensure_ascii=False))


def read_annotations(vault_root: Path, item_id: str) -> List[Dict[str, Any]]:
    p = annotations_path(vault_root, item_id)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def write_comments(vault_root: Path, note_id: str, comments: List[Dict[str, Any]]) -> None:
    _safe_write(comments_path(vault_root, note_id), json.dumps(comments or [], indent=2, ensure_ascii=False))


def read_comments(vault_root: Path, note_id: str) -> List[Dict[str, Any]]:
    p = comments_path(vault_root, note_id)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


# ─── iPad ink sidecars ────────────────────────────────────────────────────────
# The iPad app writes three files per (item_id, page_index) triple:
#   .stoa/ink/<item_id>/p<n>.pkd        — PKDrawing.dataRepresentation() (vector)
#   .stoa/ink/<item_id>/p<n>.png        — rasterized, transparent, PDF-point-sized
#   .stoa/ink/<item_id>/p<n>.meta.json  — {page_width_pt,page_height_pt,scale,sha_*,pk_version}
# The Mac daemon treats all three as one logical sync-manifest unit.
# The PNG is what the web renders; .pkd is re-editable vector source-of-truth
# but stays local-only at Tier 1.


@dataclass
class InkSidecar:
    """One ink sidecar unit on disk — .pkd + .png + .meta.json for a single page."""

    item_id: str
    page_index: int          # 0-based
    pkd_path: Path           # may not exist (png-only is still valid at render time)
    png_path: Path           # authoritative "something exists" indicator
    meta_path: Path
    page_width_pt: Optional[float] = None
    page_height_pt: Optional[float] = None
    scale: Optional[float] = None
    pk_version: Optional[int] = None
    sha_pkd: Optional[str] = None
    sha_png: Optional[str] = None

    @classmethod
    def at(cls, vault_root: Path, item_id: str, page_index: int) -> "InkSidecar":
        """Construct paths only — doesn't read the disk."""
        return cls(
            item_id=item_id,
            page_index=page_index,
            pkd_path=ink_pkd_path(vault_root, item_id, page_index),
            png_path=ink_png_path(vault_root, item_id, page_index),
            meta_path=ink_meta_path(vault_root, item_id, page_index),
        )

    @classmethod
    def from_png_relpath(cls, vault_root: Path, relpath: str) -> Optional["InkSidecar"]:
        parsed = parse_ink_png_relpath(relpath)
        if parsed is None:
            return None
        item_id, page_index = parsed
        return cls.at(vault_root, item_id, page_index)

    def exists(self) -> bool:
        """At minimum the PNG must exist for this unit to be rendered."""
        return self.png_path.exists()

    def load_meta(self) -> Dict[str, Any]:
        """Read meta.json if present. Missing or malformed → {} so callers can
        still surface the PNG with page-dim defaults pulled from the PDF."""
        if not self.meta_path.exists():
            return {}
        try:
            data = json.loads(self.meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        if not isinstance(data, dict):
            return {}
        self.page_width_pt = data.get("page_width_pt")
        self.page_height_pt = data.get("page_height_pt")
        self.scale = data.get("scale")
        self.pk_version = data.get("pk_version")
        self.sha_pkd = data.get("sha_pkd")
        self.sha_png = data.get("sha_png")
        return data


def iter_ink_sidecars(vault_root: Path):
    """Yield all `InkSidecar` units currently on disk under `.stoa/ink/`.

    Walks `.stoa/ink/<item_id>/p<n>.png`; treats the PNG as the anchor
    (no PNG → no row). Callers read `.pkd`/meta lazily.
    """
    root = vault_root / VAULT_HIDDEN / INK_DIR
    if not root.is_dir():
        return
    for item_dir in sorted(root.iterdir()):
        if not item_dir.is_dir():
            continue
        item_id = item_dir.name
        for png in sorted(item_dir.iterdir()):
            if not png.is_file() or not png.name.endswith(".png"):
                continue
            base = png.name[:-4]   # strip .png
            if not base.startswith("p"):
                continue
            try:
                page_num = int(base[1:])
            except ValueError:
                continue
            if page_num < 1:
                continue
            yield InkSidecar.at(vault_root, item_id, page_num - 1)


def write_item_manifest(vault_root: Path, item_id: str, title: str, rel_pdf_path: str) -> None:
    """Mac daemon writes a small per-item JSON under `.stoa/items/<item_id>.json`
    so the iPad app can map a PDF file URL back to its Stoa item_id without
    hitting the network. Idempotent.
    """
    from .fs_layout import ITEMS_DIR
    path = vault_root / VAULT_HIDDEN / ITEMS_DIR / f"{item_id}.json"
    payload = {
        "item_id": item_id,
        "title": title,
        "path": rel_pdf_path,
    }
    _safe_write(path, json.dumps(payload, indent=2, ensure_ascii=False))
