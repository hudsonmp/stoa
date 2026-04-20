"""Manifest I/O.

Two stores are kept coherent:
  1. Postgres `sync_manifest` (authoritative across devices; RLS-scoped).
  2. `.stoa/manifest.json` inside the vault (offline-first local copy).

On every write to the DB we rewrite the JSON (atomic). On engine startup we
read the JSON, union it with the DB, and resolve by taking the newer
`last_synced_at`. This lets Hudson move a vault to a new device, run
`/sync/projects/{id}/clone`, and get back to coherence without explicit
mutual merge logic.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from .fs_layout import VAULT_HIDDEN, MANIFEST_JSON


@dataclass
class ManifestEntry:
    local_path: str
    content_hash: str
    item_id: Optional[str] = None
    note_id: Optional[str] = None
    last_synced_at: Optional[str] = None
    last_mtime: Optional[str] = None
    last_size: Optional[int] = None
    deleted_at: Optional[str] = None
    conflict: bool = False
    conflict_reason: Optional[str] = None

    def to_json(self) -> Dict:
        return {k: v for k, v in asdict(self).items() if v is not None or k in ("conflict",)}


@dataclass
class Manifest:
    project_id: str
    vault_root: Path
    entries: Dict[str, ManifestEntry] = field(default_factory=dict)   # keyed by local_path
    last_sync_at: Optional[str] = None

    # ─── filesystem side ──────────────────────────────────────────────

    @property
    def json_path(self) -> Path:
        return self.vault_root / VAULT_HIDDEN / MANIFEST_JSON

    def write_disk(self) -> None:
        """Atomically write the JSON manifest to .stoa/manifest.json."""
        self.json_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "project_id": self.project_id,
            "last_sync_at": self.last_sync_at,
            "entries": [e.to_json() for e in self.entries.values()],
            "schema": 1,
        }
        tmp = self.json_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.json_path)

    @classmethod
    def read_disk(cls, project_id: str, vault_root: Path) -> "Manifest":
        jp = vault_root / VAULT_HIDDEN / MANIFEST_JSON
        if not jp.exists():
            return cls(project_id=project_id, vault_root=vault_root)
        try:
            payload = json.loads(jp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return cls(project_id=project_id, vault_root=vault_root)
        entries = {}
        for e in payload.get("entries", []):
            try:
                entry = ManifestEntry(**e)
                entries[entry.local_path] = entry
            except TypeError:
                continue
        return cls(
            project_id=project_id,
            vault_root=vault_root,
            entries=entries,
            last_sync_at=payload.get("last_sync_at"),
        )

    # ─── operations ──────────────────────────────────────────────────

    def upsert(self, entry: ManifestEntry) -> None:
        self.entries[entry.local_path] = entry

    def remove(self, local_path: str) -> None:
        self.entries.pop(local_path, None)

    def get(self, local_path: str) -> Optional[ManifestEntry]:
        return self.entries.get(local_path)

    def by_item_id(self, item_id: str) -> Optional[ManifestEntry]:
        for e in self.entries.values():
            if e.item_id == item_id and not e.deleted_at:
                return e
        return None

    def by_note_id(self, note_id: str) -> Optional[ManifestEntry]:
        for e in self.entries.values():
            if e.note_id == note_id and not e.deleted_at:
                return e
        return None


# ─── Postgres side ────────────────────────────────────────────────────

def fetch_db_entries(supabase, project_id: str) -> List[Dict]:
    """Load all non-deleted manifest rows for a project from Supabase."""
    res = (
        supabase.table("sync_manifest")
        .select("*")
        .eq("project_id", project_id)
        .is_("deleted_at", "null")
        .execute()
    )
    return res.data or []


def upsert_db_entry(supabase, project_id: str, user_id: str, entry: ManifestEntry) -> None:
    """Upsert a single manifest row in Postgres.

    Match on (project_id, local_path) — that's the UNIQUE index. We look up
    first because supabase-py's upsert requires the PK and sync_manifest.id
    is auto-generated.
    """
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "project_id": project_id,
        "user_id": user_id,
        "item_id": entry.item_id,
        "note_id": entry.note_id,
        "local_path": entry.local_path,
        "content_hash": entry.content_hash,
        "last_synced_at": entry.last_synced_at or now,
        "last_mtime": entry.last_mtime,
        "last_size": entry.last_size,
        "conflict": entry.conflict,
        "conflict_reason": entry.conflict_reason,
    }
    existing = (
        supabase.table("sync_manifest")
        .select("id")
        .eq("project_id", project_id)
        .eq("local_path", entry.local_path)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase.table("sync_manifest").update(row).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("sync_manifest").insert(row).execute()


def mark_db_deleted(supabase, project_id: str, local_path: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("sync_manifest").update({"deleted_at": now}).eq(
        "project_id", project_id
    ).eq("local_path", local_path).is_("deleted_at", "null").execute()
