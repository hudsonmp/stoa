"""Read played episodes and transcripts from the local Apple Podcasts SQLite database."""

import os
import re
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree


DB_PATH = Path.home() / (
    "Library/Group Containers/"
    "243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite"
)

TTML_CACHE = Path.home() / (
    "Library/Group Containers/"
    "243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML"
)

TTML_NS = {"tt": "http://www.w3.org/ns/ttml", "ttm": "http://www.w3.org/ns/ttml#metadata"}


@dataclass
class PlayedEpisode:
    title: str
    podcast_name: str
    play_count: int
    duration_seconds: float
    url: str | None
    web_url: str | None
    description: str | None
    artwork_url: str | None
    transcript_id: str | None = None


def _extract_text_from_ttml(ttml_path: Path) -> str | None:
    """Parse TTML transcript and return plain text with speaker labels."""
    try:
        tree = ElementTree.parse(ttml_path)
        root = tree.getroot()

        paragraphs = root.findall(".//tt:p", TTML_NS)
        lines = []
        current_speaker = None

        for p in paragraphs:
            speaker = p.get(f"{{{TTML_NS['ttm']}}}agent", "")
            # Collect word-level spans into sentence text
            words = []
            for span in p.iter():
                if span.text and span.text.strip():
                    words.append(span.text.strip())

            text = " ".join(words).strip()
            if not text:
                continue

            # Clean up double spaces from joining
            text = re.sub(r"\s+", " ", text)

            if speaker != current_speaker:
                current_speaker = speaker
                lines.append(f"\n[{speaker}]\n{text}")
            else:
                lines.append(text)

        return "\n".join(lines).strip()
    except Exception:
        return None


_transcript_index: dict[str, Path] | None = None


def _build_transcript_index() -> dict[str, Path]:
    """Build a one-time index mapping transcript numbers to local TTML paths."""
    global _transcript_index
    if _transcript_index is not None:
        return _transcript_index

    _transcript_index = {}
    if not TTML_CACHE.exists():
        return _transcript_index

    for ttml_file in TTML_CACHE.rglob("*.ttml"):
        m = re.search(r"transcript_(\d+)", ttml_file.name)
        if m:
            _transcript_index[m.group(1)] = ttml_file

    return _transcript_index


def find_transcript(transcript_id: str | None) -> str | None:
    """Find and extract text from a cached TTML transcript file."""
    if not transcript_id or not TTML_CACHE.exists():
        return None

    m = re.search(r"transcript_(\d+)", transcript_id)
    if not m:
        return None

    index = _build_transcript_index()
    ttml_path = index.get(m.group(1))
    if ttml_path:
        return _extract_text_from_ttml(ttml_path)
    return None


def get_played_episodes(limit: int = 200) -> list[PlayedEpisode]:
    """Return episodes the user has played at least once.

    Apple Podcasts locks its DB, so we copy it to a temp file first.
    """
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Apple Podcasts DB not found at {DB_PATH}")

    # Copy to avoid WAL lock issues
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    try:
        shutil.copy2(str(DB_PATH), tmp.name)
        # Also copy WAL/SHM if they exist
        for ext in ("-wal", "-shm"):
            src = str(DB_PATH) + ext
            if os.path.exists(src):
                shutil.copy2(src, tmp.name + ext)

        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT
                e.ZTITLE             AS title,
                p.ZTITLE             AS podcast_name,
                e.ZPLAYCOUNT         AS play_count,
                COALESCE(e.ZDURATION, 0) AS duration,
                e.ZENCLOSUREURL      AS enclosure_url,
                e.ZWEBPAGEURL        AS web_url,
                e.ZITEMDESCRIPTIONWITHOUTHTML AS description,
                p.ZIMAGEURL          AS artwork_url,
                COALESCE(e.ZFREETRANSCRIPTIDENTIFIER, e.ZENTITLEDTRANSCRIPTIDENTIFIER) AS transcript_id
            FROM ZMTEPISODE e
            LEFT JOIN ZMTPODCAST p ON e.ZPODCAST = p.Z_PK
            WHERE e.ZHASBEENPLAYED = 1 OR e.ZPLAYCOUNT > 0
            ORDER BY e.Z_PK DESC
            LIMIT ?
        """, (limit,)).fetchall()
        conn.close()

        return [
            PlayedEpisode(
                title=r["title"] or "Untitled Episode",
                podcast_name=r["podcast_name"] or "Unknown Podcast",
                play_count=r["play_count"] or 1,
                duration_seconds=r["duration"] or 0,
                url=r["enclosure_url"],
                web_url=r["web_url"],
                description=(r["description"] or "")[:500] or None,
                artwork_url=r["artwork_url"],
                transcript_id=r["transcript_id"],
            )
            for r in rows
        ]
    finally:
        os.unlink(tmp.name)
        for ext in ("-wal", "-shm"):
            p = tmp.name + ext
            if os.path.exists(p):
                os.unlink(p)
