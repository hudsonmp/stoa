"""Conflict file naming + detection helpers.

Per spec: "Paper Title (conflict 2026-04-20 153012).pdf"
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Tuple


def conflict_filename(original: str) -> str:
    """Return a conflict-decorated variant of `original`.

    'Paper Title.pdf' -> 'Paper Title (conflict 2026-04-20 153012).pdf'
    Preserves compound suffixes like .gdoc.webloc, .github.webloc, .email.md.
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H%M%S")
    p = Path(original)
    # Compound-suffix detection: anything with two dotted segments in the tail.
    lower = p.name.lower()
    for compound in (".gdoc.webloc", ".github.webloc", ".email.md"):
        if lower.endswith(compound):
            stem = p.name[: -len(compound)]
            return f"{stem} (conflict {ts}){compound}"
    suffix = p.suffix  # includes leading dot
    stem = p.stem
    return f"{stem} (conflict {ts}){suffix}"


def should_conflict(
    last_synced_hash: str,
    disk_hash: str,
    db_hash: str,
) -> Tuple[bool, str]:
    """Decide whether the two sides have diverged since last sync.

    last_synced_hash is what we recorded in the manifest at last reconcile.
    disk_hash is the current file SHA.
    db_hash is the current Stoa-side SHA (for notes: body-only hash of the
    content rendered from DB state).

    Returns (is_conflict, reason_string).
    """
    disk_changed = disk_hash != last_synced_hash
    db_changed = db_hash != last_synced_hash
    if disk_changed and db_changed and disk_hash != db_hash:
        return True, "both_changed_since_last_sync"
    return False, ""
