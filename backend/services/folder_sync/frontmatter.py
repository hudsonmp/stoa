"""YAML frontmatter read/write for project notes.

Spec (both sync + editor agents must share this shape):

    ---
    id: <uuid>
    item_id: <uuid | null>
    project_id: <uuid | null>
    folder_id: <uuid | null>
    evergreen: bool
    tags: [list]
    anchor_selectors: [...]
    links_out: [uuid list]
    created_at: <iso>
    updated_at: <iso>
    content_hash: <sha256>
    ---
    # Title
    Body...
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Tuple

import yaml


_FM_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


FRONTMATTER_KEYS = (
    "id",
    "item_id",
    "project_id",
    "folder_id",
    "evergreen",
    "tags",
    "anchor_selectors",
    "links_out",
    "created_at",
    "updated_at",
    "content_hash",
)


def split(text: str) -> Tuple[Dict[str, Any], str]:
    """Split a note file into (frontmatter_dict, body_str). Missing fm → ({}, text)."""
    if not text:
        return {}, ""
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
        if not isinstance(fm, dict):
            fm = {}
    except yaml.YAMLError:
        fm = {}
    body = text[m.end():]
    return fm, body


def build(note: Dict[str, Any], body: str, content_hash: Optional[str] = None) -> str:
    """Render a note dict + body as frontmatter-wrapped markdown.

    The caller supplies the body (possibly already containing "# Title" from
    the Stoa editor). Frontmatter keys follow the spec ordering for git-diff
    readability; unknown keys are passed through at the end.
    """
    fm: Dict[str, Any] = {}
    for k in FRONTMATTER_KEYS:
        if k == "content_hash":
            fm[k] = content_hash
            continue
        if k in note:
            fm[k] = note[k]

    # Normalize tags to a flat list.
    if fm.get("tags") is None:
        fm["tags"] = []
    # Drop None-valued scalars that YAML would render as `null` and pollute diff.
    fm = {k: v for k, v in fm.items() if not (v is None and k != "content_hash")}

    yaml_text = yaml.safe_dump(
        fm,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    ).strip()
    # Ensure body ends with a single trailing newline.
    if not body.endswith("\n"):
        body = body + "\n"
    return f"---\n{yaml_text}\n---\n{body}"
