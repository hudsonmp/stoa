"""Watchdog event adapter with debounce.

macOS FSEvents batches events aggressively. A single "Save PDF" in Preview.app
can emit create → modify → modify → rename within 100ms. We debounce by path
with a 500ms window.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEventHandler, FileSystemEvent

from . import fs_layout


class DebouncedEventHandler(FileSystemEventHandler):
    def __init__(
        self,
        vault_root: Path,
        on_settle: Callable[[str], None],
        debounce_s: float = 0.5,
    ) -> None:
        self.vault_root = vault_root
        self.on_settle = on_settle
        self.debounce_s = debounce_s
        self._pending: dict[str, float] = {}
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def _should_ignore(self, path: str) -> bool:
        """True if path is inside .stoa, or is a system/hidden file."""
        try:
            rel = str(Path(path).resolve().relative_to(self.vault_root))
        except Exception:
            return True
        return fs_layout.is_hidden_or_system(rel)

    def _schedule(self, path: str) -> None:
        with self._lock:
            self._pending[path] = time.time()
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self.debounce_s, self._flush)
            self._timer.daemon = True
            self._timer.start()

    def _flush(self) -> None:
        with self._lock:
            paths = list(self._pending.keys())
            self._pending.clear()
        # Dispatch once; scan is a full reconcile so a single trigger suffices.
        if paths:
            try:
                self.on_settle(paths[0])
            except Exception:
                pass

    # ─── FileSystemEventHandler hooks ────────────────────────

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory or self._should_ignore(event.src_path):
            return
        self._schedule(event.src_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        if event.is_directory or self._should_ignore(event.src_path):
            return
        self._schedule(event.src_path)

    def on_deleted(self, event: FileSystemEvent) -> None:
        if event.is_directory or self._should_ignore(event.src_path):
            return
        self._schedule(event.src_path)

    def on_moved(self, event) -> None:
        if event.is_directory:
            return
        if not self._should_ignore(event.src_path):
            self._schedule(event.src_path)
        if hasattr(event, "dest_path") and not self._should_ignore(event.dest_path):
            self._schedule(event.dest_path)
