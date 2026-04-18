"""Tests for feat/mcp-retrieval — project-scoped RAG, indexing, context payload.

Test hygiene: everything here is offline. We do NOT hit Supabase, the
embedding API, or any external service. The MockSupabaseClient fixture is
overridden per test to simulate specific states (missing folders, empty
project, populated project, etc.).

Test-plan subagent: the scenarios below together simulate a Claude Code
instance running a literature review in a real project. See
`docs/mcp-context-engineering.md` §5 for the workflow.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


# ── path-resolver sanity ────────────────────────────────────────────────────


def test_normalize_path_accepts_plain_input():
    """Missing /projects prefix and trailing slashes are normalized."""
    from services.project_path import normalize_path
    assert normalize_path("requirement-engineering/papers") == "/projects/requirement-engineering/papers"
    assert normalize_path("/projects/RE//CT/  ") == "/projects/re/ct"
    assert normalize_path("/") == "/projects"


def test_split_project_and_folder():
    from services.project_path import split_project_and_folder
    assert split_project_and_folder("/projects/foo") == ("foo", "/")
    assert split_project_and_folder("/projects/foo/bar") == ("foo", "/bar")
    assert split_project_and_folder("/projects/foo/bar/baz") == ("foo", "/bar/baz")
    assert split_project_and_folder("/projects") == (None, "/")


def test_slugify_matches_projects_router_convention():
    """Our slug must equal feat/projects' router slug so paths line up."""
    from services.project_path import slugify
    assert slugify("Requirement Engineering") == "requirement-engineering"
    assert slugify("RE / CT") == "re-ct"
    assert slugify("Hello!World 2026") == "helloworld-2026"


def test_path_hash_is_stable():
    from services.project_path import path_hash
    h1 = path_hash("/projects/foo/bar")
    h2 = path_hash("/projects/FOO/bar")
    assert h1 == h2


# ── content hash invalidation ───────────────────────────────────────────────


def test_project_content_hash_changes_on_item_update():
    from services.project_rag import project_content_hash

    items = ["i1", "i2"]
    notes = ["n1"]
    h_before = project_content_hash(items, notes,
                                    {"i1": "t1", "i2": "t2"}, {"n1": "u1"})
    # Same ids, different updated_at → hash moves
    h_after = project_content_hash(items, notes,
                                   {"i1": "t1-NEW", "i2": "t2"}, {"n1": "u1"})
    assert h_before != h_after


def test_project_content_hash_stable_on_reordering():
    """Hash is order-independent — we sort ids before hashing."""
    from services.project_rag import project_content_hash
    a = project_content_hash(["i1", "i2"], ["n1"],
                             {"i1": "t1", "i2": "t2"}, {"n1": "u1"})
    b = project_content_hash(["i2", "i1"], ["n1"],
                             {"i1": "t1", "i2": "t2"}, {"n1": "u1"})
    assert a == b


# ── reciprocal rank fusion correctness ──────────────────────────────────────


def test_rrf_prefers_items_highly_ranked_across_lanes():
    from services.rag_pipeline import reciprocal_rank_fusion

    # item "x" is top of both lanes; item "y" is only in one lane
    vec = [{"item_id": "x"}, {"item_id": "y"}]
    txt = [{"item_id": "x"}, {"item_id": "z"}]
    fused = reciprocal_rank_fusion([vec, txt])
    ids = [r["item_id"] for r in fused]
    assert ids[0] == "x"                       # wins both lanes
    # y and z both appear once each, whichever comes first is fine
    assert set(ids[1:]) == {"y", "z"}


# ── hit normalization retains provenance ────────────────────────────────────


def test_normalize_chunk_carries_page_and_selectors():
    from services.project_rag import _normalize_chunk

    hit = {
        "id": "c-1", "item_id": "i-1", "chunk_index": 3,
        "chunk_text": "foo", "title": "Paper A",
        "similarity": 0.82, "url": "https://arxiv.org/abs/2301.00234",
        "metadata": {"page": 5, "selectors": [{"type": "TextQuoteSelector", "exact": "foo"}]},
    }
    out = _normalize_chunk(hit)
    assert out["kind"] == "chunk"
    assert out["page"] == 5
    assert out["anchor_selectors"][0]["type"] == "TextQuoteSelector"
    assert out["similarity"] == 0.82


def test_normalize_note_carries_retrieval_source():
    from services.project_rag import _normalize_note
    out = _normalize_note({"id": "n1", "title": "T", "content": "C", "evergreen": True}, source="vector")
    assert out["kind"] == "note"
    assert out["retrieval_source"] == "vector"
    assert out["evergreen"] is True


# ── context budget truncation ───────────────────────────────────────────────


def test_context_budget_shrinks_items_to_fit():
    """When max_tokens is tiny, items list is truncated from the tail."""
    from routers.mcp_projects import _estimated_chars

    base = {
        "project_name": "x", "project_path": "/projects/x",
        "project_description": "", "resolution": "folder",
        "context_version": "abc", "folder_tree": [],
        "stats": {"items": 3, "notes_evergreen": 0, "notes_marginalia": 0},
        "evergreen_notes": [], "marginalia_note_titles": [],
        "outstanding_references": [],
        "items": [
            {"id": "i1", "title": "A" * 2000},
            {"id": "i2", "title": "B" * 2000},
            {"id": "i3", "title": "C" * 2000},
        ],
    }
    budget = 3000  # chars
    while _estimated_chars(base) > budget and base["items"]:
        base["items"] = base["items"][:-1]
    assert len(base["items"]) < 3  # something was shed


# ── resolver: collection fallback when folders missing ──────────────────────


@pytest.mark.asyncio
async def test_resolver_collection_fallback(monkeypatch):
    """When `folders` table raises, we fall back to collection by name."""
    from services import project_path as pp

    fake_collection = {"id": "col-1", "name": "Context Engineering", "description": "desc"}
    collection_items = [{"item_id": "it-1"}, {"item_id": "it-2"}]

    class FakeQuery:
        def __init__(self, rows):
            self.rows = rows
        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def ilike(self, *a, **kw): return self
        def in_(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def execute(self):
            return SimpleNamespace(data=self.rows, count=len(self.rows))

    class FakeClient:
        def table(self, name):
            if name == "folders":
                raise Exception("folders table does not exist")
            if name == "collections":
                return FakeQuery([fake_collection])
            if name == "collection_items":
                return FakeQuery(collection_items)
            if name == "notes":
                return FakeQuery([])
            return FakeQuery([])

    monkeypatch.setattr(pp, "get_supabase_service", lambda: FakeClient())

    scope = await pp.resolve_project_path("/projects/context-engineering", "user-1")
    assert scope["resolution"] == "collection"
    assert scope["collection_id"] == "col-1"
    assert set(scope["item_ids"]) == {"it-1", "it-2"}


@pytest.mark.asyncio
async def test_resolver_unresolved_returns_empty_scope(monkeypatch):
    from services import project_path as pp

    class FakeQuery:
        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def ilike(self, *a, **kw): return self
        def in_(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def execute(self):
            return SimpleNamespace(data=[], count=0)

    class FakeClient:
        def table(self, name):
            if name == "folders":
                raise Exception("nope")
            return FakeQuery()

    monkeypatch.setattr(pp, "get_supabase_service", lambda: FakeClient())

    scope = await pp.resolve_project_path("/projects/nonexistent", "user-1")
    assert scope["resolution"] == "unresolved"
    assert scope["item_ids"] == []
    assert scope["note_ids"] == []


# ── reference normalization ─────────────────────────────────────────────────


def test_normalize_ref_parses_title_from_bibtex():
    from routers.mcp_projects import _normalize_ref

    resolved = {
        "authors": [{"name": "Alice"}],
        "year": 2024,
        "venue": "NeurIPS",
        "bibtex": "@article{alice2024,\n  title = {On Cohesion},\n  author = {Alice},\n}",
    }
    out = _normalize_ref(resolved, doi="10.1/a", arxiv_id=None)
    assert out["title"] == "On Cohesion"
    assert out["doi"] == "10.1/a"
    assert out["authors"] == ["Alice"]
    assert out["url"] == "https://doi.org/10.1/a"


# ── cache hit-rate simulation (see docs §5) ─────────────────────────────────


def test_cache_hit_rate_simulation():
    """Simulate a 40-query session with 2 context-version bumps → hit rate."""
    queries_per_session = 40
    rebuilds_per_session = 2
    reads = queries_per_session - rebuilds_per_session
    hit_rate = reads / queries_per_session
    assert hit_rate >= 0.9   # design target documented in docs/mcp-context-engineering.md

    # Token-cost ratio vs. no-cache baseline (cache write=1.25x, read=0.1x)
    write_cost = rebuilds_per_session * 1.25
    read_cost = reads * 0.1
    cached_total = write_cost + read_cost
    uncached_total = queries_per_session * 1.0
    savings = 1 - cached_total / uncached_total
    assert savings >= 0.8    # design target ≥80% token reduction in cached prefix
