"""Bidirectional filesystem sync for Stoa projects (Obsidian-style vault model).

Filesystem owns bytes (PDFs, images, note markdown).
Supabase owns metadata (annotations, highlights, @mentions, tags, links).
A vault-local manifest + SHA-256 reconciliation keeps them coherent.

Design non-negotiables:
  1. Opening a PDF in Preview.app must show the original bytes — no Stoa-specific
     marker bytes are ever written into PDFs. Highlights live in `.stoa/annotations/`.
  2. Library notes are NOT synced; only project_notes are, because the project
     fork (migration 012) already separated capabilities cleanly.
  3. Evergreen notes live in `_evergreen/` inside the vault.
  4. Conflict resolution never silently picks a winner — both sides are kept and
     the user resolves via the UI.

Module layout:
  manifest.py       — per-vault .stoa/manifest.json read/write + DB sync
  hashing.py        — stable SHA-256 helpers (body-only for notes)
  fs_layout.py      — vault path ↔ item-type routing + slugification
  frontmatter.py    — YAML frontmatter for note markdown round-trip
  sidecars.py       — .stoa/annotations/<id>.json + comments/note-<id>.json
  icloud.py         — .icloud placeholder detection + materialization
  engine.py         — SyncEngine: scan/reconcile/watch/shutdown
  watcher.py        — python-watchdog event adapter with debounce + SHA dedupe
  conflict.py       — conflict detection + conflict-file naming
"""

from .engine import SyncEngine, get_engine, shutdown_all  # noqa: F401
