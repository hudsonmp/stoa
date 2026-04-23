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
from pathlib import Path
from typing import Any, Dict, List

from .fs_layout import VAULT_HIDDEN, ANNOTATIONS_DIR, COMMENTS_DIR


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
