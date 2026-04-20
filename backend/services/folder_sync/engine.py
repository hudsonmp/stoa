"""SyncEngine: per-project scan + reconcile + watch.

One engine instance is created per enabled project. Engines are kept in a
module-level registry keyed by project_id so subsequent API calls reuse
the watcher. Engines are thread-safe only for the public methods; internal
reconciliation uses an instance-level lock to avoid races between the
watcher callback and a manual /pull invocation.

Validity threats flagged:
  * Single uvicorn worker is assumed. If `--workers N` with N>1, each worker
    starts its own watcher → duplicate ingests. We log a warning if we detect
    a second watcher for the same project in the same OS process.
  * `--reload` in dev kills the engine on every code edit. The router's
    /status endpoint re-initializes lazily from the DB manifest, so Hudson
    can recover by clicking "Resume sync" in the UI.
  * macOS FSEvents coalesces events; atomic renames (mv A B) sometimes arrive
    as delete(A) + create(B). We dedupe by SHA: if a created file's hash
    matches a just-deleted manifest entry, we treat it as a rename.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import fs_layout, hashing, sidecars, icloud, frontmatter as fm_mod, conflict as conflict_mod
from .manifest import (
    Manifest,
    ManifestEntry,
    fetch_db_entries,
    upsert_db_entry,
    mark_db_deleted,
)

logger = logging.getLogger(__name__)


# ─── Module-level registry ──────────────────────────────────────────────────

_ENGINES: Dict[str, "SyncEngine"] = {}
_REGISTRY_LOCK = threading.Lock()


def get_engine(project_id: str) -> Optional["SyncEngine"]:
    with _REGISTRY_LOCK:
        return _ENGINES.get(project_id)


def register_engine(engine: "SyncEngine") -> None:
    with _REGISTRY_LOCK:
        existing = _ENGINES.get(engine.project_id)
        if existing and existing is not engine:
            logger.warning(
                "Replacing existing engine for project %s; prior watcher shutdown",
                engine.project_id,
            )
            try:
                existing.shutdown()
            except Exception:
                pass
        _ENGINES[engine.project_id] = engine


def unregister_engine(project_id: str) -> None:
    with _REGISTRY_LOCK:
        _ENGINES.pop(project_id, None)


def shutdown_all() -> None:
    with _REGISTRY_LOCK:
        engines = list(_ENGINES.values())
        _ENGINES.clear()
    for e in engines:
        try:
            e.shutdown()
        except Exception:
            pass


# ─── Scan result ────────────────────────────────────────────────────────────

@dataclass
class ScanResult:
    scanned: int = 0
    pushed_to_stoa: int = 0          # local-only files uploaded to Stoa
    pushed_to_disk: int = 0          # Stoa-only items written to disk
    updated: int = 0
    conflicts: int = 0
    soft_deleted: int = 0
    errors: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "scanned": self.scanned,
            "pushed_to_stoa": self.pushed_to_stoa,
            "pushed_to_disk": self.pushed_to_disk,
            "updated": self.updated,
            "conflicts": self.conflicts,
            "soft_deleted": self.soft_deleted,
            "errors": self.errors,
        }


# ─── SyncEngine ─────────────────────────────────────────────────────────────

class SyncEngine:
    """Per-project sync engine.

    Not thread-safe to construct concurrently — router funnels `enable` through
    a DB check so two enables produce one engine. Runtime methods use a lock.
    """

    def __init__(self, project_id: str, user_id: str, sync_path: str, supabase: Any) -> None:
        self.project_id = project_id
        self.user_id = user_id
        self.vault_root = Path(sync_path).expanduser().resolve()
        self.supabase = supabase
        self._lock = threading.Lock()
        self._observer = None
        self._watcher_callback: Optional[Callable[[str], None]] = None
        self._pending_watch_events: Dict[str, float] = {}    # path -> last_event_ts
        self._debounce_window = 0.5                          # seconds

    # ─── lifecycle ────────────────────────────────────────────────

    def ensure_vault(self) -> None:
        """Create vault + .stoa/ subdirs if missing."""
        self.vault_root.mkdir(parents=True, exist_ok=True)
        (self.vault_root / fs_layout.VAULT_HIDDEN).mkdir(exist_ok=True)
        (self.vault_root / fs_layout.VAULT_HIDDEN / fs_layout.ANNOTATIONS_DIR).mkdir(exist_ok=True)
        (self.vault_root / fs_layout.VAULT_HIDDEN / fs_layout.COMMENTS_DIR).mkdir(exist_ok=True)

    def acquire_lock(self) -> bool:
        """Create .stoa/sync.lock. Returns False if another process holds it."""
        lock_path = self.vault_root / fs_layout.VAULT_HIDDEN / fs_layout.SYNC_LOCK
        if lock_path.exists():
            # Stale-lock detection: lock older than 5 min is assumed dead.
            try:
                mtime = lock_path.stat().st_mtime
                if time.time() - mtime < 300:
                    return False
            except OSError:
                pass
        try:
            lock_path.write_text(str(os.getpid()), encoding="utf-8")
            return True
        except OSError:
            return False

    def release_lock(self) -> None:
        lock_path = self.vault_root / fs_layout.VAULT_HIDDEN / fs_layout.SYNC_LOCK
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass

    def shutdown(self) -> None:
        """Stop the watcher and release locks. Safe to call multiple times."""
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=5)
            except Exception:
                pass
            self._observer = None
        self.release_lock()

    # ─── scan + reconcile ─────────────────────────────────────────

    def scan(self) -> ScanResult:
        """Walk the vault, reconcile each file against the manifest + DB.

        Two-phase:
          Phase A: walk vault → detect local files not in Stoa (new) OR changed.
          Phase B: walk DB items+notes in this project → detect anything in
                   Stoa but missing from disk (pushed on first enable).
        """
        self.ensure_vault()
        result = ScanResult()

        with self._lock:
            manifest = Manifest.read_disk(self.project_id, self.vault_root)
            # Merge DB entries into the local manifest (source-of-truth reconciliation).
            db_entries = fetch_db_entries(self.supabase, self.project_id)
            for row in db_entries:
                path = row["local_path"]
                existing = manifest.entries.get(path)
                if existing is None or (existing.last_synced_at or "") < (row.get("last_synced_at") or ""):
                    manifest.entries[path] = ManifestEntry(
                        local_path=row["local_path"],
                        content_hash=row["content_hash"],
                        item_id=row.get("item_id"),
                        note_id=row.get("note_id"),
                        last_synced_at=row.get("last_synced_at"),
                        last_mtime=row.get("last_mtime"),
                        last_size=row.get("last_size"),
                        deleted_at=row.get("deleted_at"),
                        conflict=row.get("conflict", False),
                        conflict_reason=row.get("conflict_reason"),
                    )

            # ── Phase A ──
            seen_paths: set = set()
            for abs_path in self._iter_vault_files():
                try:
                    rel = str(abs_path.relative_to(self.vault_root))
                except ValueError:
                    continue
                if fs_layout.is_hidden_or_system(rel):
                    continue
                seen_paths.add(rel)
                try:
                    self._reconcile_disk_file(abs_path, rel, manifest, result)
                    result.scanned += 1
                except Exception as exc:
                    logger.exception("reconcile disk file failed: %s", rel)
                    result.errors.append(f"{rel}: {exc}")

            # ── Phase A.5: detect local deletes BEFORE Phase B ──
            # Otherwise Phase B re-materializes items that the user just removed.
            soft_deleted_item_ids: set = set()
            soft_deleted_note_ids: set = set()
            for path, entry in list(manifest.entries.items()):
                if entry.deleted_at:
                    continue
                if path in seen_paths:
                    continue
                if not (entry.item_id or entry.note_id):
                    continue
                # File deleted locally → soft-delete in Stoa, tombstone manifest.
                self._soft_delete(entry)
                entry.deleted_at = datetime.now(timezone.utc).isoformat()
                mark_db_deleted(self.supabase, self.project_id, path)
                if entry.item_id:
                    soft_deleted_item_ids.add(entry.item_id)
                if entry.note_id:
                    soft_deleted_note_ids.add(entry.note_id)
                result.soft_deleted += 1

            # ── Phase B ──
            try:
                self._reconcile_stoa_to_disk(
                    manifest, seen_paths, result,
                    skip_item_ids=soft_deleted_item_ids,
                    skip_note_ids=soft_deleted_note_ids,
                )
            except Exception as exc:
                logger.exception("reconcile stoa→disk failed for project %s", self.project_id)
                result.errors.append(f"stoa->disk: {exc}")

            manifest.last_sync_at = datetime.now(timezone.utc).isoformat()
            manifest.write_disk()

            # Update projects.last_synced_at
            try:
                self.supabase.table("projects").update({
                    "last_synced_at": manifest.last_sync_at,
                }).eq("id", self.project_id).execute()
            except Exception:
                logger.warning("failed to update projects.last_synced_at", exc_info=True)

        return result

    # ─── Phase A helpers ──────────────────────────────────────────

    def _iter_vault_files(self):
        """Yield all files under the vault root, skipping .stoa/."""
        for root, dirs, files in os.walk(self.vault_root):
            rel_root = Path(root).relative_to(self.vault_root)
            # prune .stoa and hidden dirs in-place so os.walk doesn't recurse
            dirs[:] = [d for d in dirs if d != fs_layout.VAULT_HIDDEN and not d.startswith(".")]
            for f in files:
                # Skip Apple placeholder files — caller materializes as needed.
                if f.startswith(".") and f.endswith(".icloud"):
                    yield Path(root) / f
                    continue
                if f.startswith("."):
                    continue
                yield Path(root) / f

    def _reconcile_disk_file(
        self,
        abs_path: Path,
        rel: str,
        manifest: Manifest,
        result: ScanResult,
    ) -> None:
        # Handle iCloud placeholder.
        if icloud.is_placeholder(abs_path):
            materialized, ok = icloud.ensure_materialized(abs_path)
            if not ok:
                result.errors.append(f"{rel}: icloud placeholder not downloaded")
                return
            abs_path = materialized
            rel = str(abs_path.relative_to(self.vault_root))

        if not abs_path.is_file():
            return

        disk_hash, size = hashing.hash_file(abs_path)
        try:
            mtime_iso = datetime.fromtimestamp(abs_path.stat().st_mtime, tz=timezone.utc).isoformat()
        except OSError:
            mtime_iso = None

        existing = manifest.get(rel)

        if existing is None:
            # Attempt rename detection: is there a manifest entry with same SHA but
            # a different path that's now missing?
            renamed_from = self._detect_rename(disk_hash, manifest)
            if renamed_from is not None:
                self._apply_rename(renamed_from, rel, disk_hash, size, mtime_iso, manifest)
                result.updated += 1
                return

            # Genuinely new file on disk → ingest into Stoa.
            new_entry = self._ingest_local_file(abs_path, rel, disk_hash, size, mtime_iso)
            if new_entry is not None:
                manifest.upsert(new_entry)
                upsert_db_entry(self.supabase, self.project_id, self.user_id, new_entry)
                result.pushed_to_stoa += 1
            return

        if existing.deleted_at is not None:
            # Was tombstoned — the user restored the file. Re-push to Stoa.
            existing.deleted_at = None
            existing.content_hash = disk_hash
            existing.last_synced_at = datetime.now(timezone.utc).isoformat()
            existing.last_mtime = mtime_iso
            existing.last_size = size
            upsert_db_entry(self.supabase, self.project_id, self.user_id, existing)
            result.pushed_to_stoa += 1
            return

        if existing.content_hash == disk_hash:
            # No change on disk. Stoa-side changes are handled in phase B.
            return

        # Disk changed. Check for conflict with Stoa side.
        db_hash = self._current_stoa_hash(existing)
        is_conflict, reason = conflict_mod.should_conflict(
            existing.content_hash, disk_hash, db_hash or disk_hash
        )
        if is_conflict:
            self._write_conflict_file(abs_path, rel, disk_hash, manifest, reason, result)
            return

        # Disk won cleanly → push to Stoa.
        existing.content_hash = disk_hash
        existing.last_synced_at = datetime.now(timezone.utc).isoformat()
        existing.last_mtime = mtime_iso
        existing.last_size = size
        self._push_disk_to_stoa(abs_path, rel, existing)
        upsert_db_entry(self.supabase, self.project_id, self.user_id, existing)
        result.updated += 1

    def _detect_rename(self, disk_hash: str, manifest: Manifest) -> Optional[ManifestEntry]:
        """Find a manifest entry whose content_hash matches and whose file no
        longer exists on disk — that's a rename."""
        for entry in manifest.entries.values():
            if entry.deleted_at:
                continue
            if entry.content_hash != disk_hash:
                continue
            src_abs = self.vault_root / entry.local_path
            if not src_abs.exists():
                return entry
        return None

    def _apply_rename(
        self,
        old_entry: ManifestEntry,
        new_rel: str,
        disk_hash: str,
        size: int,
        mtime_iso: Optional[str],
        manifest: Manifest,
    ) -> None:
        # Rename in DB + manifest. Stoa-side item title/filename update happens
        # via items.title if desired — out of scope for v1; we just retarget
        # the manifest path mapping.
        mark_db_deleted(self.supabase, self.project_id, old_entry.local_path)
        manifest.remove(old_entry.local_path)
        renamed = ManifestEntry(
            local_path=new_rel,
            content_hash=disk_hash,
            item_id=old_entry.item_id,
            note_id=old_entry.note_id,
            last_synced_at=datetime.now(timezone.utc).isoformat(),
            last_mtime=mtime_iso,
            last_size=size,
        )
        manifest.upsert(renamed)
        upsert_db_entry(self.supabase, self.project_id, self.user_id, renamed)

    def _write_conflict_file(
        self,
        abs_path: Path,
        rel: str,
        disk_hash: str,
        manifest: Manifest,
        reason: str,
        result: ScanResult,
    ) -> None:
        """Move the local changes aside as a (conflict) file and flag in DB."""
        conflict_name = conflict_mod.conflict_filename(rel)
        new_abs = abs_path.with_name(Path(conflict_name).name)
        try:
            abs_path.rename(new_abs)
        except OSError:
            return
        entry = manifest.entries.get(rel)
        if entry is not None:
            entry.conflict = True
            entry.conflict_reason = reason
            upsert_db_entry(self.supabase, self.project_id, self.user_id, entry)
        result.conflicts += 1

    # ─── Phase B helpers ──────────────────────────────────────────

    def _reconcile_stoa_to_disk(
        self,
        manifest: Manifest,
        seen_paths: set,
        result: ScanResult,
        skip_item_ids: Optional[set] = None,
        skip_note_ids: Optional[set] = None,
    ) -> None:
        """Walk every item + note in this project; write anything missing from disk.

        skip_item_ids / skip_note_ids: IDs we just soft-deleted in this scan — do
        not re-materialize them on disk.
        """
        skip_item_ids = skip_item_ids or set()
        skip_note_ids = skip_note_ids or set()
        # 1. Items in this project (via folder_items join → folders → items).
        folders = (
            self.supabase.table("folders")
            .select("id, path, name, parent_folder_id")
            .eq("project_id", self.project_id)
            .execute()
        )
        folder_rows = folders.data or []
        folder_paths = {f["id"]: f["path"] for f in folder_rows}

        if folder_rows:
            fi = (
                self.supabase.table("folder_items")
                .select("folder_id, item_id")
                .in_("folder_id", [f["id"] for f in folder_rows])
                .execute()
            )
            fi_rows = fi.data or []
            item_ids = list({r["item_id"] for r in fi_rows})
            items = {}
            if item_ids:
                ir = (
                    self.supabase.table("items")
                    .select("id, title, url, type, domain, metadata, github_slug, extracted_text, reading_status, deleted_at")
                    .in_("id", item_ids)
                    .execute()
                )
                for i in (ir.data or []):
                    if not i.get("deleted_at"):
                        items[i["id"]] = i

            for r in fi_rows:
                item = items.get(r["item_id"])
                if not item:
                    continue
                if item["id"] in skip_item_ids:
                    continue
                folder_rel = fs_layout.folder_relpath(folder_paths.get(r["folder_id"], "/"))
                fname = fs_layout.item_filename(item)
                rel = str(folder_rel / fname) if str(folder_rel) else fname
                if rel in seen_paths:
                    continue
                # Item is in Stoa but not on disk — materialize.
                try:
                    entry = self._write_stoa_item_to_disk(item, rel, folder_rel)
                    if entry is not None:
                        manifest.upsert(entry)
                        upsert_db_entry(self.supabase, self.project_id, self.user_id, entry)
                        result.pushed_to_disk += 1
                        seen_paths.add(rel)
                except Exception as exc:
                    logger.exception("write item to disk failed: %s", rel)
                    result.errors.append(f"{rel}: {exc}")

        # 2. Project notes (project_notes scoped to this project_id).
        notes_res = (
            self.supabase.table("project_notes")
            .select("id, title, content, tags, item_id, folder_id, evergreen, "
                    "anchor_selectors, created_at, updated_at, deleted_at")
            .eq("project_id", self.project_id)
            .execute()
        )
        for n in (notes_res.data or []):
            if n.get("deleted_at"):
                continue
            if n["id"] in skip_note_ids:
                continue
            folder_rel = fs_layout.folder_relpath(folder_paths.get(n.get("folder_id"), "/"))
            fname = fs_layout.note_filename(n)
            if n.get("evergreen"):
                rel = fname  # evergreen goes at vault root/_evergreen/
            else:
                rel = str(folder_rel / fname) if str(folder_rel) else fname

            if rel in seen_paths:
                continue

            try:
                entry = self._write_stoa_note_to_disk(n, rel)
                if entry is not None:
                    manifest.upsert(entry)
                    upsert_db_entry(self.supabase, self.project_id, self.user_id, entry)
                    result.pushed_to_disk += 1
                    seen_paths.add(rel)
            except Exception as exc:
                logger.exception("write note to disk failed: %s", rel)
                result.errors.append(f"{rel}: {exc}")

    # ─── Stoa→disk writers ────────────────────────────────────────

    def _write_stoa_item_to_disk(
        self,
        item: Dict[str, Any],
        rel: str,
        folder_rel: Path,
    ) -> Optional[ManifestEntry]:
        """Write an item's bytes/placeholder to disk. Returns the manifest entry."""
        abs_path = self.vault_root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)

        itype = (item.get("type") or "").lower()
        url = item.get("url") or ""

        if itype in ("paper", "pdf"):
            data = self._fetch_item_bytes(item)
            if data is None:
                logger.warning("no bytes for item %s; skipping disk write", item["id"])
                return None
            abs_path.write_bytes(data)
            # Mirror into project-sync storage (authoritative binary copy).
            self._push_bytes_to_storage(item["id"], rel, data)
            h = hashing.hash_bytes(data)
            size = len(data)
        elif itype == "image":
            data = self._fetch_item_bytes(item)
            if data is None:
                return None
            abs_path.write_bytes(data)
            self._push_bytes_to_storage(item["id"], rel, data)
            h = hashing.hash_bytes(data)
            size = len(data)
        elif itype == "email_thread":
            md = self._render_email_thread(item)
            data = md.encode("utf-8")
            abs_path.write_bytes(data)
            h = hashing.hash_bytes(data)
            size = len(data)
        elif itype in ("gdoc", "github_repo") or url:
            data = fs_layout.build_webloc_plist(url)
            abs_path.write_bytes(data)
            h = hashing.hash_url_placeholder(url)
            size = len(data)
        else:
            logger.debug("item %s type=%s has no disk representation", item["id"], itype)
            return None

        now = datetime.now(timezone.utc).isoformat()
        # Also materialize highlights as sidecar.
        self._write_highlights_sidecar(item["id"])
        return ManifestEntry(
            local_path=rel,
            content_hash=h,
            item_id=item["id"],
            last_synced_at=now,
            last_mtime=now,
            last_size=size,
        )

    def _write_stoa_note_to_disk(self, note: Dict[str, Any], rel: str) -> ManifestEntry:
        abs_path = self.vault_root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)

        # Materialize any sidebar comments for this note.
        try:
            self._write_comments_sidecar(note["id"])
        except Exception:
            logger.debug("comments sidecar write skipped for note %s", note.get("id"))

        body = note.get("content") or ""
        # Build frontmatter WITHOUT the content_hash first, then hash the body, then
        # rewrite frontmatter with the hash in place.
        fm_note = {
            "id": note.get("id"),
            "item_id": note.get("item_id"),
            "project_id": self.project_id,
            "folder_id": note.get("folder_id"),
            "evergreen": bool(note.get("evergreen", False)),
            "tags": note.get("tags") or [],
            "anchor_selectors": note.get("anchor_selectors"),
            "created_at": note.get("created_at"),
            "updated_at": note.get("updated_at"),
        }
        body_hash = hashing.hash_note_body(body)
        full = fm_mod.build(fm_note, body, content_hash=body_hash)
        abs_path.write_text(full, encoding="utf-8")

        now = datetime.now(timezone.utc).isoformat()
        return ManifestEntry(
            local_path=rel,
            content_hash=body_hash,
            note_id=note.get("id"),
            last_synced_at=now,
            last_mtime=now,
            last_size=len(full.encode("utf-8")),
        )

    def _write_comments_sidecar(self, note_id: str) -> None:
        """Export sidebar comments (note_comments) for a project note as sidecar JSON."""
        try:
            res = (
                self.supabase.table("note_comments")
                .select("*")
                .eq("project_note_id", note_id)
                .execute()
            )
        except Exception:
            return
        rows = res.data or []
        # Group by parent_id: roots at top, replies nested.
        roots = [r for r in rows if not r.get("parent_id")]
        replies_by_parent: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            pid = r.get("parent_id")
            if pid:
                replies_by_parent.setdefault(pid, []).append(r)

        payload: List[Dict[str, Any]] = []
        for root in roots:
            entry = {
                "id": root["id"],
                "body": root.get("body"),
                "range": root.get("range_selector"),
                "author": root.get("user_id"),
                "created_at": root.get("created_at"),
                "resolved": root.get("resolved", False),
                "replies": [
                    {
                        "id": rep["id"],
                        "body": rep.get("body"),
                        "author": rep.get("user_id"),
                        "created_at": rep.get("created_at"),
                    }
                    for rep in replies_by_parent.get(root["id"], [])
                ],
            }
            payload.append(entry)
        sidecars.write_comments(self.vault_root, note_id, payload)

    def _write_highlights_sidecar(self, item_id: str) -> None:
        """Export project_highlights for this item as annotation sidecar."""
        res = (
            self.supabase.table("project_highlights")
            .select("*")
            .eq("project_id", self.project_id)
            .eq("item_id", item_id)
            .execute()
        )
        sidecars.write_annotations(self.vault_root, item_id, res.data or [])

    def _fetch_item_bytes(self, item: Dict[str, Any]) -> Optional[bytes]:
        """Resolve an item's binary bytes, preferring Supabase storage.

        Order: project-sync storage → documents storage → fetch by URL.
        """
        meta = item.get("metadata") or {}
        storage_path = meta.get("pdf_storage_path")
        if storage_path:
            try:
                return self.supabase.storage.from_("documents").download(storage_path)
            except Exception:
                pass
        # Fallback: item.url
        url = item.get("url")
        if url and url.lower().endswith(".pdf"):
            import httpx
            try:
                with httpx.Client(verify=False, timeout=60, follow_redirects=True) as c:
                    r = c.get(url)
                    if r.status_code == 200:
                        return r.content
            except Exception:
                pass
        return None

    def _push_bytes_to_storage(self, item_id: str, rel_path: str, data: bytes) -> None:
        """Mirror bytes to project-sync/<project_id>/<item_id><ext>."""
        suffix = Path(rel_path).suffix or ""
        key = f"{self.project_id}/{item_id}{suffix}"
        try:
            try:
                self.supabase.storage.from_("project-sync").upload(key, data)
            except Exception:
                self.supabase.storage.from_("project-sync").update(key, data)
        except Exception as exc:
            logger.debug("project-sync upload skipped for %s: %s", key, exc)

    def _render_email_thread(self, item: Dict[str, Any]) -> str:
        meta = item.get("metadata") or {}
        participants = meta.get("participants") or []
        lines = [f"# {item.get('title') or 'Email thread'}", "", "---"]
        lines.append(f"participants: {', '.join(participants[:20])}")
        lines.append(f"thread_id: {meta.get('thread_id','')}")
        lines.append("---")
        messages = item.get("messages") or []
        for m in messages:
            lines.append("")
            lines.append(f"## {m.get('from','?')} — {m.get('date','')}")
            lines.append(m.get("body") or "")
        return "\n".join(lines) + "\n"

    # ─── local→Stoa ingest ────────────────────────────────────────

    def _ingest_local_file(
        self,
        abs_path: Path,
        rel: str,
        disk_hash: str,
        size: int,
        mtime_iso: Optional[str],
    ) -> Optional[ManifestEntry]:
        """Create a Stoa item (or project_note) from a local file not yet in Stoa.

        Routes by classify_file → ingest helper. Links the newly created item
        into the project's folder that corresponds to rel's parent directory.
        """
        kind = fs_layout.classify_file(rel)
        now = datetime.now(timezone.utc).isoformat()

        if kind == "pdf":
            item_id = self._ingest_pdf(abs_path, rel)
            if not item_id:
                return None
            self._push_bytes_to_storage(item_id, rel, abs_path.read_bytes())
            return ManifestEntry(
                local_path=rel, content_hash=disk_hash, item_id=item_id,
                last_synced_at=now, last_mtime=mtime_iso, last_size=size,
            )

        if kind == "image":
            item_id = self._ingest_image(abs_path, rel)
            if not item_id:
                return None
            self._push_bytes_to_storage(item_id, rel, abs_path.read_bytes())
            return ManifestEntry(
                local_path=rel, content_hash=disk_hash, item_id=item_id,
                last_synced_at=now, last_mtime=mtime_iso, last_size=size,
            )

        if kind in ("url", "gdoc", "github_repo"):
            url = fs_layout.parse_webloc_url(abs_path.read_bytes())
            if not url:
                return None
            item_id = self._ingest_url_from_webloc(url, rel, kind)
            if not item_id:
                return None
            # For URL-backed items we re-hash by canonical URL.
            return ManifestEntry(
                local_path=rel,
                content_hash=hashing.hash_url_placeholder(url),
                item_id=item_id,
                last_synced_at=now, last_mtime=mtime_iso, last_size=size,
            )

        if kind in ("note", "evergreen_note"):
            note_id = self._ingest_note(abs_path, rel, evergreen=(kind == "evergreen_note"))
            if not note_id:
                return None
            return ManifestEntry(
                local_path=rel,
                content_hash=hashing.hash_note_body(abs_path.read_text(encoding="utf-8")),
                note_id=note_id,
                last_synced_at=now, last_mtime=mtime_iso, last_size=size,
            )

        logger.debug("skipping unclassifiable file %s", rel)
        return None

    def _folder_for_rel(self, rel: str) -> Optional[str]:
        """Find or create the folder whose path matches rel's parent directory."""
        parent = Path(rel).parent
        if str(parent) in (".", ""):
            # Root folder.
            r = (
                self.supabase.table("folders")
                .select("id")
                .eq("project_id", self.project_id)
                .is_("parent_folder_id", "null")
                .limit(1)
                .execute()
            )
            return r.data[0]["id"] if r.data else None

        # Evergreen: don't map to a folder, stays as a note flag.
        if parent.parts and parent.parts[0] == fs_layout.EVERGREEN_DIR:
            r = (
                self.supabase.table("folders")
                .select("id")
                .eq("project_id", self.project_id)
                .is_("parent_folder_id", "null")
                .limit(1)
                .execute()
            )
            return r.data[0]["id"] if r.data else None

        # Build canonical path "/a/b/c" from parent parts (assumes already slugified).
        canonical = "/" + "/".join(parent.parts)
        r = (
            self.supabase.table("folders")
            .select("id")
            .eq("project_id", self.project_id)
            .eq("path", canonical)
            .limit(1)
            .execute()
        )
        if r.data:
            return r.data[0]["id"]
        # Not found — create folder hierarchy on the fly.
        return self._ensure_folder_chain(parent)

    def _ensure_folder_chain(self, parent_path: Path) -> Optional[str]:
        """Walk parent path segments and create folders as needed."""
        # Root.
        root = (
            self.supabase.table("folders")
            .select("id, path")
            .eq("project_id", self.project_id)
            .is_("parent_folder_id", "null")
            .limit(1)
            .execute()
        )
        if not root.data:
            return None
        parent_id = root.data[0]["id"]
        cur_path = ""
        for segment in parent_path.parts:
            cur_path = cur_path + "/" + segment
            lookup = (
                self.supabase.table("folders")
                .select("id")
                .eq("project_id", self.project_id)
                .eq("path", cur_path)
                .limit(1)
                .execute()
            )
            if lookup.data:
                parent_id = lookup.data[0]["id"]
                continue
            ins = (
                self.supabase.table("folders")
                .insert({
                    "project_id": self.project_id,
                    "parent_folder_id": parent_id,
                    "name": segment,
                    "path": cur_path,
                    "sort_order": 0,
                })
                .execute()
            )
            if ins.data:
                parent_id = ins.data[0]["id"]
            else:
                return None
        return parent_id

    def _link_item_to_folder(self, item_id: str, folder_id: Optional[str]) -> None:
        if not folder_id:
            return
        try:
            # Idempotent insert.
            existing = (
                self.supabase.table("folder_items")
                .select("folder_id")
                .eq("folder_id", folder_id)
                .eq("item_id", item_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                return
            self.supabase.table("folder_items").insert({
                "folder_id": folder_id,
                "item_id": item_id,
                "sort_order": 0,
            }).execute()
        except Exception:
            logger.debug("link item to folder failed", exc_info=True)

    def _ingest_pdf(self, abs_path: Path, rel: str) -> Optional[str]:
        """Create a `paper` item from a local PDF. Mirrors routers.ingest.ingest_pdf."""
        from services.extraction import extract_from_pdf
        try:
            pdf_bytes = abs_path.read_bytes()
        except OSError:
            return None
        extracted = extract_from_pdf(pdf_bytes)

        storage_path = f"{self.user_id}/pdfs/{Path(rel).stem}.pdf"
        try:
            self.supabase.storage.from_("documents").upload(storage_path, pdf_bytes)
        except Exception:
            try:
                self.supabase.storage.from_("documents").update(storage_path, pdf_bytes)
            except Exception:
                logger.debug("documents bucket upload skipped")

        item_data = {
            "user_id": self.user_id,
            "title": Path(rel).stem,
            "type": "paper",
            "extracted_text": extracted.get("extracted_text") or "",
            "metadata": {
                "page_count": extracted.get("page_count"),
                "pdf_storage_path": storage_path,
                "is_two_column": extracted.get("is_two_column", False),
                "sync_source": "folder_sync",
                "sync_path": rel,
            },
            "reading_status": "to_read",
        }
        result = self.supabase.table("items").insert(item_data).execute()
        if not result.data:
            return None
        item_id = result.data[0]["id"]
        self._link_item_to_folder(item_id, self._folder_for_rel(rel))
        return item_id

    def _ingest_image(self, abs_path: Path, rel: str) -> Optional[str]:
        try:
            img_bytes = abs_path.read_bytes()
        except OSError:
            return None
        # Minimal metadata — image ingester uses Claude Vision; we skip here for speed.
        item_data = {
            "user_id": self.user_id,
            "title": Path(rel).stem,
            "type": "image",
            "domain": "folder_sync",
            "reading_status": "to_read",
            "metadata": {
                "filename": Path(rel).name,
                "sync_source": "folder_sync",
                "sync_path": rel,
                "size_bytes": len(img_bytes),
            },
        }
        result = self.supabase.table("items").insert(item_data).execute()
        if not result.data:
            return None
        item_id = result.data[0]["id"]
        self._link_item_to_folder(item_id, self._folder_for_rel(rel))
        return item_id

    def _ingest_url_from_webloc(self, url: str, rel: str, kind: str) -> Optional[str]:
        """Create a URL/GDoc/GitHub item from a parsed .webloc."""
        type_map = {"url": "blog", "gdoc": "gdoc", "github_repo": "github_repo"}
        item_type = type_map.get(kind, "blog")
        item_data: Dict[str, Any] = {
            "user_id": self.user_id,
            "url": url,
            "title": Path(rel).name.split(".")[0],
            "type": item_type,
            "reading_status": "to_read",
            "metadata": {"sync_source": "folder_sync", "sync_path": rel},
        }
        if item_type == "github_repo":
            # owner_repo.github.webloc → slug
            stem = Path(rel).name.split(".")[0]
            item_data["github_slug"] = stem.replace("_", "/", 1)
        result = self.supabase.table("items").insert(item_data).execute()
        if not result.data:
            return None
        item_id = result.data[0]["id"]
        self._link_item_to_folder(item_id, self._folder_for_rel(rel))
        return item_id

    def _ingest_note(self, abs_path: Path, rel: str, evergreen: bool) -> Optional[str]:
        text = abs_path.read_text(encoding="utf-8", errors="replace")
        fm, body = fm_mod.split(text)
        existing_id = fm.get("id")

        title = Path(rel).stem
        # Prefer fm title only if explicitly present
        data: Dict[str, Any] = {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "folder_id": self._folder_for_rel(rel),
            "title": title,
            "content": body,
            "tags": fm.get("tags") or [],
            "evergreen": bool(evergreen or fm.get("evergreen")),
        }
        if fm.get("anchor_selectors"):
            data["anchor_selectors"] = fm["anchor_selectors"]
        if fm.get("item_id"):
            data["item_id"] = fm["item_id"]

        if existing_id:
            # Update-in-place — let Stoa match by the UUID the file asserts it owns.
            upd = self.supabase.table("project_notes").update(data).eq(
                "id", existing_id
            ).eq("user_id", self.user_id).execute()
            if upd.data:
                return existing_id
        result = self.supabase.table("project_notes").insert(data).execute()
        return result.data[0]["id"] if result.data else None

    def _push_disk_to_stoa(self, abs_path: Path, rel: str, entry: ManifestEntry) -> None:
        """After disk-won reconciliation, push the new bytes into Stoa.

        For items: replace extracted_text (PDFs) or the url webloc → item.url.
        For notes: replace project_notes.content with the parsed body.
        """
        if entry.item_id:
            kind = fs_layout.classify_file(rel)
            if kind == "pdf":
                try:
                    from services.extraction import extract_from_pdf
                    data = abs_path.read_bytes()
                    extracted = extract_from_pdf(data)
                    self.supabase.table("items").update({
                        "extracted_text": extracted.get("extracted_text") or "",
                    }).eq("id", entry.item_id).eq("user_id", self.user_id).execute()
                    self._push_bytes_to_storage(entry.item_id, rel, data)
                except Exception:
                    logger.warning("pdf re-ingest failed for %s", rel, exc_info=True)
            elif kind == "image":
                data = abs_path.read_bytes()
                self._push_bytes_to_storage(entry.item_id, rel, data)
            elif kind in ("url", "gdoc", "github_repo"):
                url = fs_layout.parse_webloc_url(abs_path.read_bytes())
                if url:
                    self.supabase.table("items").update({"url": url}).eq(
                        "id", entry.item_id
                    ).eq("user_id", self.user_id).execute()
        elif entry.note_id:
            text = abs_path.read_text(encoding="utf-8", errors="replace")
            _fm, body = fm_mod.split(text)
            self.supabase.table("project_notes").update({
                "content": body,
            }).eq("id", entry.note_id).eq("user_id", self.user_id).execute()

    def _current_stoa_hash(self, entry: ManifestEntry) -> Optional[str]:
        """Recompute what Stoa's current byte hash WOULD be if we wrote the DB
        state to disk right now. Used for conflict detection."""
        if entry.item_id:
            item_res = (
                self.supabase.table("items")
                .select("id, type, url, extracted_text, metadata")
                .eq("id", entry.item_id)
                .limit(1)
                .execute()
            )
            if not item_res.data:
                return None
            item = item_res.data[0]
            itype = (item.get("type") or "").lower()
            if itype in ("paper", "pdf", "image"):
                data = self._fetch_item_bytes(item)
                return hashing.hash_bytes(data) if data is not None else None
            if item.get("url"):
                return hashing.hash_url_placeholder(item["url"])
            return None
        if entry.note_id:
            n = (
                self.supabase.table("project_notes")
                .select("content")
                .eq("id", entry.note_id)
                .limit(1)
                .execute()
            )
            if not n.data:
                return None
            return hashing.hash_note_body(n.data[0].get("content") or "")
        return None

    def _soft_delete(self, entry: ManifestEntry) -> None:
        """Soft-delete the underlying item/note (mark deleted_at, keep row)."""
        now = datetime.now(timezone.utc).isoformat()
        if entry.item_id:
            self.supabase.table("items").update({"deleted_at": now}).eq(
                "id", entry.item_id
            ).eq("user_id", self.user_id).execute()
        if entry.note_id:
            self.supabase.table("project_notes").update({"deleted_at": now}).eq(
                "id", entry.note_id
            ).eq("user_id", self.user_id).execute()

    # ─── push-only ────────────────────────────────────────────────

    def push(self) -> ScanResult:
        """Force-write Stoa state to disk, overwriting local."""
        self.ensure_vault()
        result = ScanResult()
        with self._lock:
            manifest = Manifest.read_disk(self.project_id, self.vault_root)
            seen: set = set()
            self._reconcile_stoa_to_disk(manifest, seen, result)
            manifest.last_sync_at = datetime.now(timezone.utc).isoformat()
            manifest.write_disk()
        return result

    # ─── conflict resolution ──────────────────────────────────────

    def resolve_conflict(self, item_id_or_note_id: str, choice: str) -> Dict[str, Any]:
        """Resolve a conflicted entry. choice ∈ {"local","stoa","both"}.

        local  → discard Stoa, re-ingest the (conflict) file back onto the canonical path.
        stoa   → discard the local (conflict) file, restore from Stoa.
        both   → keep both; clear the conflict flag and leave the (conflict) file.
        """
        with self._lock:
            manifest = Manifest.read_disk(self.project_id, self.vault_root)
            target: Optional[ManifestEntry] = None
            for e in manifest.entries.values():
                if e.item_id == item_id_or_note_id or e.note_id == item_id_or_note_id:
                    target = e
                    break
            if target is None:
                return {"ok": False, "error": "not found"}

            if choice == "stoa":
                # Remove any conflict variants from disk (*.conflict*.ext)
                self._delete_conflict_siblings(target.local_path)
                target.conflict = False
                target.conflict_reason = None
                upsert_db_entry(self.supabase, self.project_id, self.user_id, target)
                manifest.upsert(target)
                manifest.write_disk()
                return {"ok": True, "resolved": "stoa"}

            if choice == "local":
                # Find most recent conflict sibling for this path and swap it in.
                sib = self._most_recent_conflict_sibling(target.local_path)
                if sib is None:
                    return {"ok": False, "error": "no conflict sibling found"}
                canonical_abs = self.vault_root / target.local_path
                try:
                    sib.replace(canonical_abs)
                except OSError as exc:
                    return {"ok": False, "error": str(exc)}
                disk_hash, size = hashing.hash_file(canonical_abs)
                target.content_hash = disk_hash
                target.last_synced_at = datetime.now(timezone.utc).isoformat()
                target.last_size = size
                target.conflict = False
                target.conflict_reason = None
                self._push_disk_to_stoa(canonical_abs, target.local_path, target)
                upsert_db_entry(self.supabase, self.project_id, self.user_id, target)
                manifest.upsert(target)
                manifest.write_disk()
                return {"ok": True, "resolved": "local"}

            if choice == "both":
                target.conflict = False
                target.conflict_reason = None
                upsert_db_entry(self.supabase, self.project_id, self.user_id, target)
                manifest.upsert(target)
                manifest.write_disk()
                return {"ok": True, "resolved": "both"}

            return {"ok": False, "error": f"unknown choice {choice}"}

    def _delete_conflict_siblings(self, rel: str) -> None:
        abs_path = self.vault_root / rel
        stem = Path(rel).stem
        parent = abs_path.parent
        if not parent.exists():
            return
        for p in parent.iterdir():
            if p.is_file() and p.name.startswith(f"{stem} (conflict "):
                try:
                    p.unlink()
                except OSError:
                    pass

    def _most_recent_conflict_sibling(self, rel: str) -> Optional[Path]:
        abs_path = self.vault_root / rel
        stem = Path(rel).stem
        parent = abs_path.parent
        if not parent.exists():
            return None
        best: Optional[Path] = None
        best_mtime = -1.0
        for p in parent.iterdir():
            if p.is_file() and p.name.startswith(f"{stem} (conflict "):
                try:
                    m = p.stat().st_mtime
                    if m > best_mtime:
                        best, best_mtime = p, m
                except OSError:
                    continue
        return best

    # ─── status ────────────────────────────────────────────────────

    def status(self) -> Dict[str, Any]:
        manifest = Manifest.read_disk(self.project_id, self.vault_root)
        conflicts = [
            {
                "local_path": e.local_path,
                "item_id": e.item_id,
                "note_id": e.note_id,
                "reason": e.conflict_reason,
            }
            for e in manifest.entries.values()
            if e.conflict and not e.deleted_at
        ]
        total = sum(1 for e in manifest.entries.values() if not e.deleted_at)
        return {
            "project_id": self.project_id,
            "sync_path": str(self.vault_root),
            "last_sync_at": manifest.last_sync_at,
            "entry_count": total,
            "conflict_count": len(conflicts),
            "conflicts": conflicts,
            "watcher_running": self._observer is not None and self._observer.is_alive(),
        }

    # ─── watcher ──────────────────────────────────────────────────

    def watch(self) -> None:
        """Start a filesystem watcher. Idempotent."""
        if self._observer is not None and self._observer.is_alive():
            return
        from watchdog.observers import Observer
        from .watcher import DebouncedEventHandler

        handler = DebouncedEventHandler(
            vault_root=self.vault_root,
            on_settle=self._on_watcher_event,
        )
        observer = Observer()
        observer.schedule(handler, str(self.vault_root), recursive=True)
        observer.daemon = True
        observer.start()
        self._observer = observer

    def _on_watcher_event(self, _rel_path: str) -> None:
        """Re-run scan. We could scope by path but full scan is bounded by vault size.

        For Hudson's workload (hundreds of PDFs, not millions) a full scan is
        a few seconds. If this becomes a bottleneck, scope by the single path.
        """
        try:
            self.scan()
        except Exception:
            logger.exception("watcher-triggered scan failed")
