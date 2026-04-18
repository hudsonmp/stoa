"""Projects — Finder-style research project organiser.

Parallel to Collections; does NOT touch the collections table.
Schema: projects → folders (nested, arbitrary depth) → folder_items → items.
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from services.auth import get_supabase_service, get_user_id

router = APIRouter()

# ─────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Slugify a folder name for path segments (lowercase, hyphens, no special chars)."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "folder"


def _build_path(parent_path: str, name: str) -> str:
    """Construct a child path from parent path + folder name slug."""
    slug = _slugify(name)
    if parent_path == "/":
        return f"/{slug}"
    return f"{parent_path}/{slug}"


async def _assert_project_owner(project_id: str, user_id: str, supabase) -> dict:
    """Return the project or raise 404."""
    res = (
        supabase.table("projects")
        .select("id, user_id, name, description, color, created_at, updated_at")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return res.data[0]


async def _assert_folder_in_project(folder_id: str, project_id: str, supabase) -> dict:
    """Return the folder or raise 404."""
    res = (
        supabase.table("folders")
        .select("*")
        .eq("id", folder_id)
        .eq("project_id", project_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Folder not found in this project")
    return res.data[0]


def _get_root_folder(project_id: str, supabase) -> dict:
    """Return the root folder (parent_folder_id IS NULL) for a project."""
    res = (
        supabase.table("folders")
        .select("*")
        .eq("project_id", project_id)
        .is_("parent_folder_id", "null")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="Root folder missing — data integrity error")
    return res.data[0]


# ─────────────────────────────────────────────────────────────
# projects CRUD
# ─────────────────────────────────────────────────────────────

@router.get("")
async def list_projects(request: Request):
    """List all projects for the authenticated user, with item counts and last-touched-at."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    projects_res = (
        supabase.table("projects")
        .select("id, name, description, color, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    projects = projects_res.data or []

    if projects:
        project_ids = [p["id"] for p in projects]
        folders_res = (
            supabase.table("folders")
            .select("id, project_id")
            .in_("project_id", project_ids)
            .execute()
        )
        folder_map: dict[str, list[str]] = {}
        for f in (folders_res.data or []):
            folder_map.setdefault(f["project_id"], []).append(f["id"])

        all_folder_ids = [fid for fids in folder_map.values() for fid in fids]
        if all_folder_ids:
            fi_res = (
                supabase.table("folder_items")
                .select("folder_id")
                .in_("folder_id", all_folder_ids)
                .execute()
            )
            folder_to_project = {f["id"]: f["project_id"] for f in (folders_res.data or [])}
            item_counts: dict[str, int] = {}
            for row in (fi_res.data or []):
                pid = folder_to_project.get(row["folder_id"])
                if pid:
                    item_counts[pid] = item_counts.get(pid, 0) + 1
        else:
            item_counts = {}

        for p in projects:
            p["item_count"] = item_counts.get(p["id"], 0)

    return {"projects": projects}


@router.post("")
async def create_project(request: Request):
    """Create a new project. Root folder is auto-created by DB trigger."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    body = await request.json()

    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    result = (
        supabase.table("projects")
        .insert({
            "user_id": user_id,
            "name": name,
            "description": body.get("description") or None,
            "color": body.get("color") or None,
        })
        .execute()
    )
    project = result.data[0]
    root = _get_root_folder(project["id"], supabase)
    return {"project": project, "root_folder": root}


@router.get("/{project_id}")
async def get_project(project_id: str, request: Request):
    """Get a single project with its root folder."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    project = await _assert_project_owner(project_id, user_id, supabase)
    root = _get_root_folder(project_id, supabase)
    return {"project": project, "root_folder": root}


@router.patch("/{project_id}")
async def update_project(project_id: str, request: Request):
    """Rename/redescribe a project."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)

    body = await request.json()
    allowed = {"name", "description", "color"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("projects")
        .update(updates)
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    return {"project": result.data[0]}


@router.delete("/{project_id}")
async def delete_project(project_id: str, request: Request):
    """Delete a project and all its folders/items (cascades via FK)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)

    supabase.table("projects").delete().eq("id", project_id).eq("user_id", user_id).execute()
    return {"deleted": True, "id": project_id}


# ─────────────────────────────────────────────────────────────
# folders CRUD
# ─────────────────────────────────────────────────────────────

@router.get("/{project_id}/folders")
async def list_folders(project_id: str, request: Request, parent_id: Optional[str] = None):
    """List folders within a project.

    Omit parent_id or pass 'root' → children of the root folder.
    Pass parent_id=<uuid> → children of that folder.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)

    if parent_id is None or parent_id == "root":
        root = _get_root_folder(project_id, supabase)
        parent_id = root["id"]

    result = (
        supabase.table("folders")
        .select("id, project_id, parent_folder_id, name, path, sort_order, created_at")
        .eq("project_id", project_id)
        .eq("parent_folder_id", parent_id)
        .order("sort_order")
        .order("name")
        .execute()
    )
    return {"folders": result.data or []}


@router.get("/{project_id}/folders/tree")
async def get_folder_tree(project_id: str, request: Request):
    """Return the full folder tree for a project."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)

    folders_res = (
        supabase.table("folders")
        .select("id, project_id, parent_folder_id, name, path, sort_order, created_at")
        .eq("project_id", project_id)
        .order("sort_order")
        .order("name")
        .execute()
    )
    folders = folders_res.data or []

    folder_ids = [f["id"] for f in folders]
    if folder_ids:
        fi_res = (
            supabase.table("folder_items")
            .select("folder_id")
            .in_("folder_id", folder_ids)
            .execute()
        )
        count_map: dict[str, int] = {}
        for row in (fi_res.data or []):
            fid = row["folder_id"]
            count_map[fid] = count_map.get(fid, 0) + 1
    else:
        count_map = {}

    for f in folders:
        f["item_count"] = count_map.get(f["id"], 0)

    by_id = {f["id"]: {**f, "children": []} for f in folders}
    root_node = None
    for node in by_id.values():
        pid = node["parent_folder_id"]
        if pid is None:
            root_node = node
        elif pid in by_id:
            by_id[pid]["children"].append(node)

    return {"tree": root_node}


@router.post("/{project_id}/folders")
async def create_folder(project_id: str, request: Request):
    """Create a subfolder. Body: { name, parent_folder_id? (defaults to root) }"""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)

    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    parent_folder_id = body.get("parent_folder_id")
    if not parent_folder_id:
        root = _get_root_folder(project_id, supabase)
        parent_folder_id = root["id"]
    else:
        await _assert_folder_in_project(parent_folder_id, project_id, supabase)

    parent_res = (
        supabase.table("folders")
        .select("path")
        .eq("id", parent_folder_id)
        .execute()
    )
    if not parent_res.data:
        raise HTTPException(status_code=404, detail="Parent folder not found")
    parent_path = parent_res.data[0]["path"]
    new_path = _build_path(parent_path, name)

    siblings_res = (
        supabase.table("folders")
        .select("sort_order")
        .eq("parent_folder_id", parent_folder_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
    )
    sort_order = 0
    if siblings_res.data:
        sort_order = (siblings_res.data[0]["sort_order"] or 0) + 1

    try:
        result = (
            supabase.table("folders")
            .insert({
                "project_id": project_id,
                "parent_folder_id": parent_folder_id,
                "name": name,
                "path": new_path,
                "sort_order": sort_order,
            })
            .execute()
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail=f"A folder named '{name}' already exists here")
        raise

    return {"folder": result.data[0]}


@router.patch("/{project_id}/folders/{folder_id}")
async def update_folder(project_id: str, folder_id: str, request: Request):
    """Rename a folder and cascade-update descendant paths."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    folder = await _assert_folder_in_project(folder_id, project_id, supabase)

    if folder["parent_folder_id"] is None:
        raise HTTPException(status_code=400, detail="Cannot rename the root folder; rename the project instead")

    body = await request.json()
    name = body.get("name", "").strip()
    sort_order = body.get("sort_order")

    updates: dict = {}
    if name:
        updates["name"] = name
        parent_res = (
            supabase.table("folders")
            .select("path")
            .eq("id", folder["parent_folder_id"])
            .execute()
        )
        parent_path = parent_res.data[0]["path"] if parent_res.data else "/"
        new_path = _build_path(parent_path, name)
        old_path = folder["path"]
        updates["path"] = new_path

        all_folders_res = (
            supabase.table("folders")
            .select("id, path")
            .eq("project_id", project_id)
            .execute()
        )
        for f in (all_folders_res.data or []):
            if f["path"].startswith(old_path + "/"):
                updated_path = new_path + f["path"][len(old_path):]
                supabase.table("folders").update({"path": updated_path}).eq("id", f["id"]).execute()

    if sort_order is not None:
        updates["sort_order"] = sort_order

    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("folders")
        .update(updates)
        .eq("id", folder_id)
        .execute()
    )
    return {"folder": result.data[0]}


@router.post("/{project_id}/folders/{folder_id}/move")
async def move_folder(project_id: str, folder_id: str, request: Request):
    """Move a folder to a new parent within the same project."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    folder = await _assert_folder_in_project(folder_id, project_id, supabase)

    if folder["parent_folder_id"] is None:
        raise HTTPException(status_code=400, detail="Cannot move the root folder")

    body = await request.json()
    new_parent_id = body.get("parent_folder_id")
    if not new_parent_id:
        raise HTTPException(status_code=400, detail="parent_folder_id is required")

    new_parent = await _assert_folder_in_project(new_parent_id, project_id, supabase)

    if new_parent["path"].startswith(folder["path"] + "/") or new_parent["path"] == folder["path"]:
        raise HTTPException(status_code=400, detail="Cannot move a folder into itself or its own descendant")

    old_path = folder["path"]
    new_path = _build_path(new_parent["path"], folder["name"])

    supabase.table("folders").update({
        "parent_folder_id": new_parent_id,
        "path": new_path,
    }).eq("id", folder_id).execute()

    all_folders_res = (
        supabase.table("folders")
        .select("id, path")
        .eq("project_id", project_id)
        .execute()
    )
    for f in (all_folders_res.data or []):
        if f["path"].startswith(old_path + "/"):
            updated_path = new_path + f["path"][len(old_path):]
            supabase.table("folders").update({"path": updated_path}).eq("id", f["id"]).execute()

    result = supabase.table("folders").select("*").eq("id", folder_id).execute()
    return {"folder": result.data[0]}


@router.delete("/{project_id}/folders/{folder_id}")
async def delete_folder(project_id: str, folder_id: str, request: Request):
    """Delete a folder and all its descendants (cascades via FK)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    folder = await _assert_folder_in_project(folder_id, project_id, supabase)

    if folder["parent_folder_id"] is None:
        raise HTTPException(status_code=400, detail="Cannot delete the root folder; delete the project instead")

    supabase.table("folders").delete().eq("id", folder_id).execute()
    return {"deleted": True, "id": folder_id}


# ─────────────────────────────────────────────────────────────
# folder_items CRUD
# ─────────────────────────────────────────────────────────────

@router.get("/{project_id}/folders/{folder_id}/items")
async def list_folder_items(project_id: str, folder_id: str, request: Request):
    """List items in a folder with full item metadata."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    await _assert_folder_in_project(folder_id, project_id, supabase)

    fi_res = (
        supabase.table("folder_items")
        .select("item_id, sort_order, added_at")
        .eq("folder_id", folder_id)
        .order("sort_order")
        .execute()
    )
    if not fi_res.data:
        return {"items": []}

    item_ids = [r["item_id"] for r in fi_res.data]
    sort_map = {r["item_id"]: {"sort_order": r["sort_order"], "added_at": r["added_at"]} for r in fi_res.data}

    items_res = (
        supabase.table("items")
        .select("id, title, url, type, domain, favicon_url, cover_image_url, reading_status, metadata, created_at")
        .eq("user_id", user_id)
        .in_("id", item_ids)
        .execute()
    )
    items = items_res.data or []
    for item in items:
        item["sort_order"] = sort_map.get(item["id"], {}).get("sort_order", 0)
        item["added_at"] = sort_map.get(item["id"], {}).get("added_at")

    items.sort(key=lambda x: x.get("sort_order", 0))
    return {"items": items}


@router.post("/{project_id}/folders/{folder_id}/items")
async def add_item_to_folder(project_id: str, folder_id: str, request: Request):
    """Add an existing item to a folder."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    await _assert_folder_in_project(folder_id, project_id, supabase)

    body = await request.json()
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")

    item_res = (
        supabase.table("items")
        .select("id")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    existing = (
        supabase.table("folder_items")
        .select("folder_id")
        .eq("folder_id", folder_id)
        .eq("item_id", item_id)
        .execute()
    )
    if existing.data:
        return {"already_exists": True}

    last_res = (
        supabase.table("folder_items")
        .select("sort_order")
        .eq("folder_id", folder_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
    )
    sort_order = 0
    if last_res.data:
        sort_order = (last_res.data[0]["sort_order"] or 0) + 1

    supabase.table("folder_items").insert({
        "folder_id": folder_id,
        "item_id": item_id,
        "sort_order": sort_order,
    }).execute()

    return {"added": True, "folder_id": folder_id, "item_id": item_id}


@router.delete("/{project_id}/folders/{folder_id}/items/{item_id}")
async def remove_item_from_folder(project_id: str, folder_id: str, item_id: str, request: Request):
    """Remove an item from a folder (does NOT delete the item from the library)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    await _assert_folder_in_project(folder_id, project_id, supabase)

    supabase.table("folder_items").delete().eq("folder_id", folder_id).eq("item_id", item_id).execute()
    return {"removed": True, "folder_id": folder_id, "item_id": item_id}


@router.post("/{project_id}/folders/{folder_id}/items/{item_id}/move")
async def move_item_between_folders(project_id: str, folder_id: str, item_id: str, request: Request):
    """Move an item from this folder to a target folder within the same project."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    await _assert_project_owner(project_id, user_id, supabase)
    await _assert_folder_in_project(folder_id, project_id, supabase)

    body = await request.json()
    target_folder_id = body.get("target_folder_id")
    if not target_folder_id:
        raise HTTPException(status_code=400, detail="target_folder_id is required")

    await _assert_folder_in_project(target_folder_id, project_id, supabase)

    supabase.table("folder_items").delete().eq("folder_id", folder_id).eq("item_id", item_id).execute()

    existing = (
        supabase.table("folder_items")
        .select("folder_id")
        .eq("folder_id", target_folder_id)
        .eq("item_id", item_id)
        .execute()
    )
    if not existing.data:
        last_res = (
            supabase.table("folder_items")
            .select("sort_order")
            .eq("folder_id", target_folder_id)
            .order("sort_order", desc=True)
            .limit(1)
            .execute()
        )
        sort_order = 0
        if last_res.data:
            sort_order = (last_res.data[0]["sort_order"] or 0) + 1

        supabase.table("folder_items").insert({
            "folder_id": target_folder_id,
            "item_id": item_id,
            "sort_order": sort_order,
        }).execute()

    return {"moved": True, "from_folder": folder_id, "to_folder": target_folder_id, "item_id": item_id}


# ─────────────────────────────────────────────────────────────
# path resolution
# ─────────────────────────────────────────────────────────────

@router.get("/{project_id}/resolve")
async def resolve_path(project_id: str, request: Request, path: str = "/"):
    """Resolve a folder path to its folder_id.

    GET /projects/{project_id}/resolve?path=/requirement-engineering/papers
    Used by MCP tools for O(1) path-addressed folder lookup.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    project = await _assert_project_owner(project_id, user_id, supabase)

    folder_res = (
        supabase.table("folders")
        .select("*")
        .eq("project_id", project_id)
        .eq("path", path)
        .limit(1)
        .execute()
    )
    if not folder_res.data:
        raise HTTPException(status_code=404, detail=f"No folder at path '{path}'")

    folder = folder_res.data[0]
    return {
        "folder_id": folder["id"],
        "folder": folder,
        "project": {"id": project["id"], "name": project["name"]},
    }
