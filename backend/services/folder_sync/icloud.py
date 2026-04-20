"""iCloud Drive `.icloud` placeholder handling.

Apple replaces evicted files with `.<name>.icloud` marker files. Reading one
returns plist bytes, not the real file. Options to materialize:
  1. Open the original path — this implicitly triggers NSFileCoordinator and
     blocks until downloaded. Fast path on macOS 13+ with iCloud Desktop sync.
  2. `brctl download <path>` — deprecated on Apple Silicon, but still present
     on many systems; we invoke it only as a fallback.
  3. Use `Foundation.NSFileManager.startDownloadingUbiquitousItemAtURL_error_`
     via pyobjc — heavy dependency, skipped here.

We expose a single `ensure_materialized(path)` that returns (materialized_path,
ok_bool). Callers that can't wait should skip .icloud placeholders and report
the gap.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Tuple


def is_placeholder(path: Path) -> bool:
    """True iff `path` is itself an .icloud placeholder file.

    macOS names placeholders like `.Paper Title.pdf.icloud` next to the
    original name. We also accept a direct `.icloud` suffix.
    """
    name = path.name
    return name.startswith(".") and name.endswith(".icloud")


def real_path_from_placeholder(placeholder: Path) -> Path:
    """Strip the leading `.` and trailing `.icloud` suffix."""
    name = placeholder.name
    if not is_placeholder(placeholder):
        return placeholder
    trimmed = name[1:-len(".icloud")]  # ".Foo.pdf.icloud" -> "Foo.pdf"
    return placeholder.with_name(trimmed)


def has_placeholder_sibling(real_path: Path) -> bool:
    """Does the real path exist as an .icloud placeholder next to it?"""
    sibling = real_path.with_name(f".{real_path.name}.icloud")
    return sibling.exists()


def ensure_materialized(path: Path, timeout_s: int = 60) -> Tuple[Path, bool]:
    """Ensure the file at `path` is fully downloaded.

    Returns (resolved_path, ok). If `path` is a placeholder, tries
    materialization. If `path` already exists as a real file, returns it as-is.
    """
    # Case 1: already materialized.
    if path.exists() and not is_placeholder(path):
        return path, True

    # Case 2: caller passed the placeholder; compute real path.
    if is_placeholder(path):
        real = real_path_from_placeholder(path)
    else:
        real = path

    # Case 3: there is a placeholder sibling — trigger download.
    if has_placeholder_sibling(real) or is_placeholder(path):
        brctl = shutil.which("brctl")
        if brctl:
            try:
                subprocess.run(
                    [brctl, "download", str(real.parent)],
                    timeout=timeout_s,
                    check=False,
                    capture_output=True,
                )
            except Exception:
                pass
        # Best-effort: try to read the real path to force materialization.
        try:
            if real.exists():
                with open(real, "rb") as fh:
                    fh.read(1)
                return real, True
        except Exception:
            pass
        return real, real.exists()

    return path, path.exists()
