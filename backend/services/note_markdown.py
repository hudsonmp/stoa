"""Python-side note markdown serializer — mirror of webapp/src/lib/note-serializer.ts.

Single source of truth
──────────────────────
The .md format is defined by this module + the frontend `note-serializer.ts`.
Both sides emit identical YAML frontmatter keys in identical order, and both
invert the same markdown subset (headings 1-4, paragraphs, lists incl. task,
tables, code fences, inline + block math via $…$ / $$…$$, wikilinks `[[T]]`,
footnotes `[^n]`/`[^n]:`, bold/italic/inline-code).

Consumed by:
  - `/project-notes/{id}/markdown` — on-demand export
  - Folder-sync engine (future) — vault reconciliation read/write path

Not serialized:
  - Comments (stored separately at `.stoa/comments/note-<id>.json`)
  - Base64 images (replaced with `stoa://image-<id>` placeholders)
"""

from __future__ import annotations

import hashlib
import html as html_mod
import json
import re
from html.parser import HTMLParser
from typing import Any, Optional


# ─── Frontmatter keys (must match webapp ordered list) ───────────────────────

FRONTMATTER_KEYS = [
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
]


def _stringify_scalar(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "[" + ", ".join(json.dumps(x) for x in v) + "]"
    if isinstance(v, dict):
        return json.dumps(v)
    return str(v)


def stringify_frontmatter(fm: dict[str, Any]) -> str:
    lines = ["---"]
    for key in FRONTMATTER_KEYS:
        if key not in fm:
            continue
        lines.append(f"{key}: {_stringify_scalar(fm[key])}")
    lines.append("---")
    return "\n".join(lines)


# ─── HTML → markdown (mirror of htmlToMarkdown in TS) ────────────────────────


class _HtmlToMd(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.footnotes: list[tuple[str, str]] = []
        self._stack: list[str] = []
        self._list_stack: list[dict[str, Any]] = []
        # Attribute snapshots for open elements (latest overrides)
        self._attrs_stack: list[dict[str, str]] = []
        self._table: Optional[list[list[str]]] = None
        self._row: Optional[list[str]] = None
        self._cell: Optional[list[str]] = None
        # Footnote-def capture buffer
        self._fn_def_id: Optional[str] = None
        self._fn_def_buf: list[str] = []
        # Suppression stack: while > 0, handle_data is dropped (used for nodes
        # whose inner text is just a visual placeholder — math, footnote-ref,
        # wikilink — since we emit the canonical form from attrs).
        self._suppress: int = 0

    # ── helpers
    def _attr(self, attrs: list[tuple[str, Optional[str]]], key: str) -> str:
        for k, v in attrs:
            if k == key:
                return v or ""
        return ""

    def _write(self, s: str) -> None:
        if self._fn_def_id is not None:
            self._fn_def_buf.append(s)
            return
        if self._cell is not None:
            self._cell.append(s)
            return
        self.out.append(s)

    def _escape(self, text: str) -> str:
        # Inside inline containers (headings, list items, cells), keep newlines
        # as soft breaks. Elsewhere, normalize.
        return text.replace("\\", "\\\\")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attr_map = {k: (v or "") for k, v in attrs}
        self._attrs_stack.append(attr_map)

        data_type = attr_map.get("data-type", "")
        if data_type == "math-inline":
            self._write(f"${attr_map.get('data-latex', '')}$")
            self._suppress += 1
            return
        if data_type == "math-block":
            self._write(f"\n\n$${attr_map.get('data-latex', '')}$$\n\n")
            self._suppress += 1
            return
        if data_type == "wikilink":
            self._write(f"[[{attr_map.get('data-target', '')}]]")
            self._suppress += 1
            return
        if data_type == "mention":
            # text content will write "@Label"; nothing to do here
            return
        if data_type == "footnote-ref":
            self._write(f"[^{attr_map.get('data-fn-id', '1')}]")
            self._suppress += 1
            return
        if data_type == "footnote-def":
            self._fn_def_id = attr_map.get("data-fn-id", "1")
            self._fn_def_buf = []
            return

        self._stack.append(tag)
        if tag in ("h1", "h2", "h3", "h4"):
            lvl = int(tag[1])
            self._write("\n\n" + "#" * lvl + " ")
        elif tag == "p":
            # Leading newline before paragraphs
            if self.out and not self.out[-1].endswith("\n\n"):
                self._write("\n\n")
        elif tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("_")
        elif tag == "u":
            self._write("<u>")
        elif tag == "code" and "pre" not in self._stack:
            self._write("`")
        elif tag == "pre":
            lang = ""
            # Next code child's class may carry language
            self._write("\n\n```")
            # emit lang if found on a contained code element (we'll detect on starttag below)
            # Add placeholder; we will fix it when we see <code class="language-x">
            self._write(lang)
            self._write("\n")
        elif tag == "blockquote":
            self._write("\n\n> ")
        elif tag == "ul":
            self._list_stack.append({"kind": "ul", "counter": 1, "task": False})
            self._write("\n\n")
        elif tag == "ol":
            self._list_stack.append({"kind": "ol", "counter": 1, "task": False})
            self._write("\n\n")
        elif tag == "li":
            lst = self._list_stack[-1] if self._list_stack else None
            is_task = (
                attr_map.get("data-type") == "taskItem"
                or attr_map.get("data-checked") is not None
            )
            if lst and is_task:
                lst["task"] = True
            checked = attr_map.get("data-checked") == "true"
            if lst and lst["kind"] == "ol":
                bullet = f"{lst['counter']}. "
                lst["counter"] += 1
            else:
                bullet = "- "
            if is_task:
                self._write(f"{bullet}[{'x' if checked else ' '}] ")
            else:
                self._write(bullet)
        elif tag == "a":
            # Link text is captured in data; href written on endtag
            self._stack[-1] = f"a:{attr_map.get('href', '')}"
            # Buffer open marker
            self._write("[")
        elif tag == "img":
            alt = attr_map.get("alt", "")
            src = attr_map.get("src", "")
            self._write(f"![{alt}]({src})")
        elif tag == "br":
            self._write("  \n")
        elif tag == "hr":
            self._write("\n\n---\n\n")
        elif tag == "table":
            self._table = []
        elif tag == "tr":
            if self._table is not None:
                self._row = []
        elif tag in ("th", "td"):
            self._cell = []
        elif tag == "sup" and data_type != "footnote-ref":
            self._write("<sup>")

    def handle_endtag(self, tag: str) -> None:
        # Pop attr snapshot
        if self._attrs_stack:
            popped = self._attrs_stack.pop()
        else:
            popped = {}

        if popped.get("data-type") in ("math-inline", "math-block", "wikilink", "footnote-ref"):
            if self._suppress > 0:
                self._suppress -= 1
            return
        if popped.get("data-type") == "mention":
            return

        if popped.get("data-type") == "footnote-def" and self._fn_def_id is not None:
            body = "".join(self._fn_def_buf).strip()
            self.footnotes.append((self._fn_def_id, body))
            self._fn_def_id = None
            self._fn_def_buf = []
            return

        # Pop tag from stack (may have been prefixed for anchors)
        top = self._stack.pop() if self._stack else ""

        if tag in ("h1", "h2", "h3", "h4"):
            self._write("\n\n")
        elif tag == "p":
            self._write("\n\n")
        elif tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("_")
        elif tag == "u":
            self._write("</u>")
        elif tag == "code" and "pre" not in self._stack:
            self._write("`")
        elif tag == "pre":
            self._write("\n```\n\n")
        elif tag == "blockquote":
            self._write("\n\n")
        elif tag in ("ul", "ol"):
            if self._list_stack:
                self._list_stack.pop()
            self._write("\n")
        elif tag == "li":
            self._write("\n")
        elif tag == "a":
            href = top.split(":", 1)[1] if top.startswith("a:") else ""
            if href and not href.startswith("#"):
                self._write(f"]({href})")
            else:
                self._write("]")
        elif tag == "table":
            if self._table:
                self._render_table(self._table)
            self._table = None
        elif tag == "tr":
            if self._table is not None and self._row is not None:
                self._table.append(self._row)
            self._row = None
        elif tag in ("th", "td"):
            if self._cell is not None and self._row is not None:
                self._row.append("".join(self._cell).strip().replace("|", "\\|"))
            self._cell = None
        elif tag == "sup":
            self._write("</sup>")

    def handle_data(self, data: str) -> None:
        if self._suppress > 0:
            return
        if self._cell is not None:
            self._cell.append(data)
            return
        if self._fn_def_id is not None:
            self._fn_def_buf.append(data)
            return
        self._write(data)

    def _render_table(self, rows: list[list[str]]) -> None:
        if not rows:
            return
        header = rows[0]
        body = rows[1:]
        sep = ["---" for _ in header]
        self._write("\n\n| " + " | ".join(header) + " |\n")
        self._write("| " + " | ".join(sep) + " |\n")
        for r in body:
            self._write("| " + " | ".join(r) + " |\n")
        self._write("\n")


def html_to_markdown(html: str) -> str:
    if not html or not html.strip():
        return ""
    parser = _HtmlToMd()
    parser.feed(html)
    md = "".join(parser.out)
    # Normalise trailing whitespace
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    if parser.footnotes:
        md += "\n\n"
        for fn_id, body in parser.footnotes:
            md += f"[^{fn_id}]: {body}\n"
    return md + "\n"


# ─── Full note → markdown ────────────────────────────────────────────────────


def note_to_markdown(note: dict[str, Any]) -> str:
    """Serialise a project_notes row to a round-trippable `.md` string."""
    fm = _build_frontmatter(note)
    title = (note.get("title") or "").strip()
    content_html = note.get("content") or ""
    body = html_to_markdown(content_html)
    title_line = f"# {title}\n\n" if title and title != "Untitled" else ""
    return f"{stringify_frontmatter(fm)}\n{title_line}{body}"


def _build_frontmatter(note: dict[str, Any]) -> dict[str, Any]:
    tags = note.get("tags") or []
    body_for_hash = (note.get("content") or "").strip()
    content_hash = hashlib.sha256(body_for_hash.encode("utf-8")).hexdigest()

    return {
        "id": note.get("id"),
        "item_id": note.get("item_id"),
        "project_id": note.get("project_id"),
        "folder_id": note.get("folder_id"),
        "evergreen": bool(note.get("evergreen", False)),
        "tags": tags,
        "anchor_selectors": note.get("anchor_selectors"),
        "links_out": [],  # populated by caller if needed
        "created_at": note.get("created_at"),
        "updated_at": note.get("updated_at"),
        "content_hash": content_hash,
    }
