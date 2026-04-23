"""Filesystem sync API.

Routes mirror the feat/folder-sync spec:
  POST  /sync/projects/{id}/enable             {sync_path}
  POST  /sync/projects/{id}/disable
  POST  /sync/projects/{id}/pull
  POST  /sync/projects/{id}/push
  POST  /sync/projects/{id}/clone              {sync_path}
  GET   /sync/projects/{id}/status
  POST  /sync/projects/{id}/resolve-conflict   {item_id, choice}

All routes scope the caller by user_id and validate the target path is:
  (a) absolute or `~`-relative,
  (b) not a sensitive system directory (/, /etc, /System, ...),
  (c) readable + writable by the backend process.

Backend-and-files-colocated is assumed (Hudson's dev setup). Production
multi-device flow is out of scope; the `/clone` endpoint is the bridge for
second-device setup.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id
from services.folder_sync import SyncEngine, get_engine, shutdown_all
from services.folder_sync.engine import register_engine, unregister_engine
from services.folder_sync import fs_layout, manifest as manifest_mod

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── schemas ──────────────────────────────────────────────────────────────

class EnableRequest(BaseModel):
    sync_path: str


class CloneRequest(BaseModel):
    sync_path: str


class ResolveConflictRequest(BaseModel):
    item_id: Optional[str] = None
    note_id: Optional[str] = None
    choice: str  # "local" | "stoa" | "both"


# ─── helpers ──────────────────────────────────────────────────────────────

_BLOCKED_PATHS = (
    "/", "/etc", "/bin", "/sbin", "/System", "/Library", "/usr",
    "/private/etc", "/private/var",
)


def _validate_path(raw: str) -> Path:
    """Expand ~, resolve, and reject obviously-wrong locations."""
    if not raw or not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="sync_path required")
    p = Path(raw).expanduser()
    # Resolve only if it exists; otherwise resolve the parent for validation.
    if p.exists():
        p = p.resolve()
    else:
        p = p.absolute()
    resolved_str = str(p)
    if any(resolved_str == b or resolved_str.startswith(b + "/") for b in _BLOCKED_PATHS if b != "/"):
        raise HTTPException(status_code=400, detail=f"Refusing to sync to system path {resolved_str}")
    if resolved_str == "/":
        raise HTTPException(status_code=400, detail="Refusing to sync to filesystem root")
    return p


async def _assert_project_owner(request: Request, project_id: str) -> tuple[str, object, dict]:
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    res = (
        supabase.table("projects")
        .select("id, user_id, name, sync_path, sync_enabled, last_synced_at")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return user_id, supabase, res.data[0]


# ─── routes ────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/enable")
async def enable_sync(project_id: str, body: EnableRequest, request: Request):
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    vault = _validate_path(body.sync_path)
    vault.mkdir(parents=True, exist_ok=True)
    # Writable probe.
    probe = vault / ".stoa" / ".probe"
    try:
        probe.parent.mkdir(parents=True, exist_ok=True)
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Vault not writable: {exc}")

    # Persist config.
    supabase.table("projects").update({
        "sync_path": str(vault),
        "sync_enabled": True,
    }).eq("id", project_id).eq("user_id", user_id).execute()

    # Create engine + initial reconcile + start watcher.
    engine = SyncEngine(project_id=project_id, user_id=user_id, sync_path=str(vault), supabase=supabase)
    engine.ensure_vault()
    if not engine.acquire_lock():
        raise HTTPException(status_code=409, detail="Another process is currently syncing this vault.")
    try:
        initial_scan = engine.scan()
    finally:
        engine.release_lock()
    engine.watch()
    register_engine(engine)

    return {
        "enabled": True,
        "sync_path": str(vault),
        "initial_scan": initial_scan.as_dict(),
        "status": engine.status(),
    }


@router.post("/projects/{project_id}/disable")
async def disable_sync(project_id: str, request: Request):
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    engine = get_engine(project_id)
    if engine is not None:
        engine.shutdown()
        unregister_engine(project_id)
    supabase.table("projects").update({"sync_enabled": False}).eq(
        "id", project_id
    ).eq("user_id", user_id).execute()
    return {"disabled": True}


@router.post("/projects/{project_id}/pull")
async def pull_sync(project_id: str, request: Request):
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    engine = _ensure_engine(user_id, supabase, project)
    if not engine.acquire_lock():
        raise HTTPException(status_code=409, detail="Sync in progress.")
    try:
        scan_result = engine.scan()
    finally:
        engine.release_lock()
    return {"scan": scan_result.as_dict(), "status": engine.status()}


@router.post("/projects/{project_id}/push")
async def push_sync(project_id: str, request: Request):
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    engine = _ensure_engine(user_id, supabase, project)
    if not engine.acquire_lock():
        raise HTTPException(status_code=409, detail="Sync in progress.")
    try:
        push_result = engine.push()
    finally:
        engine.release_lock()
    return {"push": push_result.as_dict(), "status": engine.status()}


@router.post("/projects/{project_id}/clone")
async def clone_vault(project_id: str, body: CloneRequest, request: Request):
    """Second-device flow: reconstruct the vault from Supabase state.

    Pulls items + project_notes + highlights from DB, materializes their on-disk
    representations (bytes from project-sync storage where available), and
    initializes the manifest so the new vault is in sync.
    """
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    vault = _validate_path(body.sync_path)
    if vault.exists() and any(vault.iterdir()):
        # Allow cloning into a non-empty folder only if .stoa/ already exists
        # (re-clone after device move); otherwise refuse to overwrite user data.
        if not (vault / ".stoa").exists() and not (vault / ".stoa" / "manifest.json").exists():
            raise HTTPException(status_code=400, detail="Target folder is not empty; pick an empty folder.")
    vault.mkdir(parents=True, exist_ok=True)

    engine = SyncEngine(project_id=project_id, user_id=user_id, sync_path=str(vault), supabase=supabase)
    engine.ensure_vault()
    if not engine.acquire_lock():
        raise HTTPException(status_code=409, detail="Sync in progress.")
    try:
        push_result = engine.push()
    finally:
        engine.release_lock()

    supabase.table("projects").update({
        "sync_path": str(vault),
        "sync_enabled": True,
    }).eq("id", project_id).eq("user_id", user_id).execute()
    engine.watch()
    register_engine(engine)
    return {"cloned": True, "sync_path": str(vault), "push": push_result.as_dict(), "status": engine.status()}


@router.get("/projects/{project_id}/status")
async def sync_status(project_id: str, request: Request):
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    engine = get_engine(project_id)
    if engine is None and project.get("sync_enabled") and project.get("sync_path"):
        # Lazy resurrect an engine (e.g. after --reload restarts) so /status
        # still reports accurate state. Do not start watcher automatically —
        # the user must push/pull or re-enable.
        engine = SyncEngine(
            project_id=project_id,
            user_id=user_id,
            sync_path=project["sync_path"],
            supabase=supabase,
        )
    if engine is None:
        return {
            "project_id": project_id,
            "enabled": bool(project.get("sync_enabled")),
            "sync_path": project.get("sync_path"),
            "last_synced_at": project.get("last_synced_at"),
            "watcher_running": False,
            "conflict_count": 0,
            "entry_count": 0,
        }
    base = engine.status()
    base["enabled"] = bool(project.get("sync_enabled"))
    return base


@router.post("/projects/{project_id}/resolve-conflict")
async def resolve_conflict(project_id: str, body: ResolveConflictRequest, request: Request):
    user_id, supabase, project = await _assert_project_owner(request, project_id)
    if body.choice not in ("local", "stoa", "both"):
        raise HTTPException(status_code=400, detail="choice must be local|stoa|both")
    target = body.item_id or body.note_id
    if not target:
        raise HTTPException(status_code=400, detail="item_id or note_id required")
    engine = _ensure_engine(user_id, supabase, project)
    result = engine.resolve_conflict(target, body.choice)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "unknown"))
    return {"resolved": result.get("resolved"), "status": engine.status()}


# ─── internal helpers ──────────────────────────────────────────────────────

def _ensure_engine(user_id: str, supabase, project: dict) -> SyncEngine:
    project_id = project["id"]
    sync_path = project.get("sync_path")
    if not project.get("sync_enabled") or not sync_path:
        raise HTTPException(status_code=400, detail="Sync not enabled for this project.")
    engine = get_engine(project_id)
    if engine is None:
        engine = SyncEngine(project_id=project_id, user_id=user_id, sync_path=sync_path, supabase=supabase)
        register_engine(engine)
    return engine
