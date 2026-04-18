"""Project path resolution: "/projects/<project-slug>/<folder/path>" → scope.

Path format (MCP convention)
────────────────────────────
Paths addressed by MCP tools have the shape::

    /projects/<project-name-slug>[/<folder-sub-path>]

The leading "/projects" is a constant prefix that distinguishes project-scoped
requests from other addressable stores (e.g. collections). The second segment
is the project's `name` slugified (lowercase, spaces→hyphens, strip symbols).
Everything after that is the project-relative folder path as stored in
`folders.path`.

Examples::

    /projects/requirement-engineering                → project root
    /projects/requirement-engineering/papers         → project's "/papers" folder
    /projects/ce/rag/benchmarks                      → deep nesting

Resolution order
────────────────
1.  If the `projects` + `folders` tables are live (feat/projects shipped) we
    resolve strictly against them and return `folder_id` + every descendant's
    items via `folder_items`.
2.  Otherwise we fall back to resolving the second segment as a collection
    name (only when folder_rel == "/") and pulling items via
    `collection_items`. The agent gets a `resolution: "collection"` marker so
    it knows the path wasn't truly hierarchical.
3.  Unresolved paths return an empty scope with `resolution: "unresolved"`
    instead of raising — upstream tools can still report project stats.
"""

from __future__ import annotations

import hashlib
import re
from typing import Optional

from services.auth import get_supabase_service


PROJECTS_PREFIX = "/projects"


def slugify(name: str) -> str:
    """Slugify a name to match the convention used by the projects router."""
    s = (name or "").lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "project"


def normalize_path(project_path: str) -> str:
    """Canonicalize — lowercase, trim, single-slash, `/projects` prefix."""
    p = (project_path or "").strip()
    while "//" in p:
        p = p.replace("//", "/")
    if not p.startswith("/"):
        p = "/" + p
    p = p.rstrip("/") or "/"
    if not p.startswith(PROJECTS_PREFIX):
        p = PROJECTS_PREFIX + ("" if p == "/" else p)
    return p.lower()


def split_project_and_folder(project_path: str) -> tuple[Optional[str], str]:
    """Split "/projects/foo/bar/baz" → ("foo", "/bar/baz")."""
    norm = normalize_path(project_path)
    rest = norm[len(PROJECTS_PREFIX):].lstrip("/")
    if not rest:
        return None, "/"
    parts = rest.split("/", 1)
    project_slug = parts[0]
    folder_rel = "/" + parts[1] if len(parts) > 1 else "/"
    return project_slug, folder_rel


def path_hash(project_path: str) -> str:
    return hashlib.sha256(normalize_path(project_path).encode("utf-8")).hexdigest()[:16]


def _folders_exist(supabase) -> bool:
    try:
        supabase.table("folders").select("id").limit(1).execute()
        return True
    except Exception:
        return False


async def resolve_project_path(project_path: str, user_id: str) -> dict:
    """Resolve a project path into a full scope descriptor.

    Returns a stable shape even when projects aren't yet live:

        {
          path_key:      canonical normalized path string
          project_id:    uuid | None
          project_name:  str  | None
          folder_id:     uuid | None (scoped folder; root when folder_rel == "/")
          collection_id: uuid | None (only set when resolution="collection")
          item_ids:      list[str] (recursive)
          note_ids:      list[str] (notes linked to any scoped item)
          folder_tree:   list[{id, name, path, parent_id}]
          resolution:    "folder" | "collection" | "unresolved"
        }
    """
    supabase = get_supabase_service()
    path_key = normalize_path(project_path)
    project_slug, folder_rel = split_project_and_folder(project_path)

    # (1) folders path
    if project_slug and _folders_exist(supabase):
        project = _find_project_by_slug(supabase, project_slug, user_id)
        if project:
            folder = _folder_at_path(supabase, project["id"], folder_rel)
            if folder:
                subtree = _folder_subtree(supabase, project["id"], folder)
                scoped_folder_ids = [f["id"] for f in subtree]
                item_ids = _items_under_folders(supabase, scoped_folder_ids)
                note_ids = _notes_for_items(supabase, item_ids, user_id)
                return {
                    "path_key": path_key,
                    "project_id": project["id"],
                    "project_name": project["name"],
                    "folder_id": folder["id"],
                    "collection_id": None,
                    "item_ids": item_ids,
                    "note_ids": note_ids,
                    "folder_tree": subtree,
                    "resolution": "folder",
                }

    # (2) collection fallback
    if project_slug and folder_rel == "/":
        col_res = (
            supabase.table("collections")
            .select("id, name, description")
            .eq("user_id", user_id)
            .ilike("name", project_slug.replace("-", "%"))
            .limit(1)
            .execute()
        )
        if col_res.data:
            col = col_res.data[0]
            links = (
                supabase.table("collection_items")
                .select("item_id")
                .eq("collection_id", col["id"])
                .execute()
            )
            item_ids = [r["item_id"] for r in (links.data or [])]
            note_ids = _notes_for_items(supabase, item_ids, user_id)
            return {
                "path_key": path_key,
                "project_id": None,
                "project_name": col["name"],
                "folder_id": None,
                "collection_id": col["id"],
                "item_ids": item_ids,
                "note_ids": note_ids,
                "folder_tree": [{
                    "id": col["id"],
                    "name": col["name"],
                    "path": "/",
                    "parent_id": None,
                    "description": col.get("description") or "",
                }],
                "resolution": "collection",
            }

    return {
        "path_key": path_key,
        "project_id": None,
        "project_name": None,
        "folder_id": None,
        "collection_id": None,
        "item_ids": [],
        "note_ids": [],
        "folder_tree": [],
        "resolution": "unresolved",
    }


# ── internal helpers ─────────────────────────────────────────────────────────


def _find_project_by_slug(supabase, slug: str, user_id: str) -> Optional[dict]:
    """Project lookup: slugify candidate names client-side, match exact slug."""
    try:
        res = (
            supabase.table("projects")
            .select("id, name, description, color, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(500)
            .execute()
        )
    except Exception:
        return None
    slug = slug.lower()
    for p in (res.data or []):
        if slugify(p["name"]) == slug:
            return p
    return None


def _folder_at_path(supabase, project_id: str, folder_path: str) -> Optional[dict]:
    """Exact-match folders.path lookup (project-relative)."""
    res = (
        supabase.table("folders")
        .select("id, name, path, parent_folder_id")
        .eq("project_id", project_id)
        .eq("path", folder_path.lower())
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0]
    # Lax match (case-insensitive, slug-insensitive)
    alt = folder_path.lower()
    if alt != "/" and not alt.startswith("/"):
        alt = "/" + alt
    res = (
        supabase.table("folders")
        .select("id, name, path, parent_folder_id")
        .eq("project_id", project_id)
        .ilike("path", alt)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def _folder_subtree(supabase, project_id: str, root: dict) -> list[dict]:
    """All folders whose path starts with root's path (inclusive)."""
    res = (
        supabase.table("folders")
        .select("id, name, path, parent_folder_id")
        .eq("project_id", project_id)
        .execute()
    )
    folders = res.data or []
    root_path = root["path"]
    if root_path == "/":
        return folders
    return [f for f in folders if f["path"] == root_path or f["path"].startswith(root_path + "/")]


def _items_under_folders(supabase, folder_ids: list[str]) -> list[str]:
    if not folder_ids:
        return []
    res = (
        supabase.table("folder_items")
        .select("item_id")
        .in_("folder_id", folder_ids)
        .execute()
    )
    seen: set[str] = set()
    out: list[str] = []
    for r in (res.data or []):
        iid = r["item_id"]
        if iid not in seen:
            seen.add(iid)
            out.append(iid)
    return out


def _notes_for_items(supabase, item_ids: list[str], user_id: str) -> list[str]:
    """Notes attached to any of these items (via notes.item_id or ref:<id> tag)."""
    if not item_ids:
        return []
    ids: set[str] = set()

    direct = (
        supabase.table("notes")
        .select("id")
        .eq("user_id", user_id)
        .in_("item_id", item_ids)
        .execute()
    )
    for r in (direct.data or []):
        ids.add(r["id"])

    all_notes = (
        supabase.table("notes")
        .select("id, tags")
        .eq("user_id", user_id)
        .limit(5000)
        .execute()
    )
    want = {f"ref:{iid}" for iid in item_ids}
    for r in (all_notes.data or []):
        if r["id"] in ids:
            continue
        tags = r.get("tags") or []
        if any(t in want for t in tags):
            ids.add(r["id"])

    return list(ids)
