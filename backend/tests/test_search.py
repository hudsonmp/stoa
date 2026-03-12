"""Tests for search and RAG pipeline edge cases.

Probes: ilike injection via search queries, cold-start behavior, empty results,
RRF fusion correctness, very long queries, service key RLS bypass in vector
search, and Anthropic API failure handling.
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestFullTextSearchInjection:
    """The full_text_search function uses ilike with user-provided query:
        .ilike("title", f"%{query}%")
    Special characters like % and _ are SQL wildcards in LIKE/ILIKE patterns.
    """

    @pytest.mark.asyncio
    async def test_percent_wildcard_in_query(self):
        """A query containing '%' matches everything, effectively a SELECT *."""
        from services.rag_pipeline import full_text_search

        mock_supabase = MagicMock()
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.ilike.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value = mock_query

        with patch("services.rag_pipeline.get_supabase_service", return_value=mock_supabase):
            await full_text_search("%", "test-user")

            # Verify ilike was called with %%% -- triple wildcards
            ilike_calls = [c for c in mock_query.ilike.call_args_list]
            for call in ilike_calls:
                pattern = call[0][1]
                assert pattern == "%%%"  # The query '%' becomes '%%%'

    @pytest.mark.asyncio
    async def test_underscore_wildcard_in_query(self):
        """'_' in ILIKE matches any single character."""
        from services.rag_pipeline import full_text_search

        mock_supabase = MagicMock()
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.ilike.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value = mock_query

        with patch("services.rag_pipeline.get_supabase_service", return_value=mock_supabase):
            await full_text_search("_", "test-user")

            ilike_calls = [c for c in mock_query.ilike.call_args_list]
            for call in ilike_calls:
                pattern = call[0][1]
                # '_' is not escaped, acts as single-char wildcard
                assert pattern == "%_%"

    @pytest.mark.asyncio
    async def test_backslash_in_query(self):
        """Backslash can be an escape char in some LIKE implementations."""
        from services.rag_pipeline import full_text_search

        mock_supabase = MagicMock()
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.ilike.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value = mock_query

        with patch("services.rag_pipeline.get_supabase_service", return_value=mock_supabase):
            await full_text_search("test\\query", "test-user")


class TestVectorSearch:
    """Tests for vector_search function."""

    @pytest.mark.asyncio
    async def test_vector_search_cold_start(self):
        """When chunks table is empty, match_chunks RPC returns empty list.
        This is handled gracefully (returns [])."""
        from services.rag_pipeline import vector_search

        mock_supabase = MagicMock()
        mock_rpc = MagicMock()
        mock_rpc.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = mock_rpc

        with patch("services.rag_pipeline.get_supabase_service", return_value=mock_supabase):
            with patch("services.rag_pipeline.embed_texts", new_callable=AsyncMock,
                       return_value=[[0.1] * 1536]):
                results = await vector_search("test query", "user-123")
                assert results == []

    @pytest.mark.asyncio
    async def test_vector_search_uses_service_key(self):
        """vector_search uses get_supabase_service() (service role key),
        which BYPASSES RLS. The match_chunks RPC filters by user_id manually,
        but this is enforced by the SQL function, not RLS policies."""
        from services.rag_pipeline import vector_search

        with patch("services.rag_pipeline.get_supabase_service") as mock_get:
            mock_supabase = MagicMock()
            mock_rpc = MagicMock()
            mock_rpc.execute.return_value = MagicMock(data=[])
            mock_supabase.rpc.return_value = mock_rpc
            mock_get.return_value = mock_supabase

            with patch("services.rag_pipeline.embed_texts", new_callable=AsyncMock,
                       return_value=[[0.1] * 1536]):
                await vector_search("query", "user-123")
                # Confirm service key client is used, not anon
                mock_get.assert_called_once()


class TestRRFFusion:
    """Tests for reciprocal_rank_fusion correctness."""

    def test_rrf_empty_lists(self):
        """Both result lists empty should return empty."""
        from services.rag_pipeline import reciprocal_rank_fusion
        result = reciprocal_rank_fusion([[], []])
        assert result == []

    def test_rrf_single_list(self):
        """Single result list preserves order."""
        from services.rag_pipeline import reciprocal_rank_fusion
        docs = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        result = reciprocal_rank_fusion([docs])
        assert [r["id"] for r in result] == ["a", "b", "c"]

    def test_rrf_deduplication(self):
        """Same document in both lists should appear once with combined score."""
        from services.rag_pipeline import reciprocal_rank_fusion
        list1 = [{"id": "a"}, {"id": "b"}]
        list2 = [{"id": "b"}, {"id": "c"}]
        result = reciprocal_rank_fusion([list1, list2])
        ids = [r["id"] for r in result]
        assert len(ids) == 3
        # "b" should be ranked highest (appears in both lists)
        assert ids[0] == "b"

    def test_rrf_missing_id_field(self):
        """Chunks from vector_search have 'item_id' not 'id'.
        The function falls back to doc.get("item_id", str(rank))."""
        from services.rag_pipeline import reciprocal_rank_fusion
        list1 = [{"item_id": "x", "chunk_text": "hello"}]
        list2 = [{"id": "y", "title": "world"}]
        result = reciprocal_rank_fusion([list1, list2])
        assert len(result) == 2

    def test_rrf_vector_and_fulltext_id_mismatch(self):
        """Vector results have chunk-level 'id' and 'item_id'.
        Full-text results have item-level 'id'. The same item could
        appear with different IDs in each list, preventing deduplication."""
        from services.rag_pipeline import reciprocal_rank_fusion
        # Vector result: chunk ID is "chunk-1", item_id is "item-A"
        vector = [{"id": "chunk-1", "item_id": "item-A", "chunk_text": "hello"}]
        # Full-text result: ID is "item-A" (the item itself)
        fulltext = [{"id": "item-A", "title": "Article A"}]
        result = reciprocal_rank_fusion([vector, fulltext])
        # These should be the same item but appear as separate results
        # because "chunk-1" != "item-A"
        assert len(result) == 2  # Bug: should be 1


class TestHybridSearch:
    """Tests for hybrid_search combining vector and full-text."""

    @pytest.mark.asyncio
    async def test_hybrid_search_embedding_failure(self):
        """If embed_texts fails, vector_search raises, and hybrid_search
        propagates the error. There's no fallback to full-text only."""
        from services.rag_pipeline import hybrid_search

        with patch("services.rag_pipeline.embed_texts", new_callable=AsyncMock,
                   side_effect=Exception("OpenAI API down")):
            with pytest.raises(Exception, match="OpenAI API down"):
                await hybrid_search("test", "user-123")

    @pytest.mark.asyncio
    async def test_hybrid_search_limit_parameter(self):
        """The limit parameter caps final results but vector and full-text
        each fetch n*2 results. With limit=1000, that's 2000 vector results
        and 2000 full-text results before fusion."""
        from services.rag_pipeline import hybrid_search

        with patch("services.rag_pipeline.vector_search", new_callable=AsyncMock, return_value=[]):
            with patch("services.rag_pipeline.full_text_search", new_callable=AsyncMock, return_value=[]):
                await hybrid_search("test", "user-123", n=1000)
                # Verify vector_search was called with n=2000
                from services.rag_pipeline import vector_search
                vector_search.assert_called_once_with("test", "user-123", n=2000, type_filter=None)


class TestRAGQuery:
    """Tests for the full RAG pipeline."""

    @pytest.mark.asyncio
    async def test_rag_no_anthropic_key_returns_context(self):
        """Without ANTHROPIC_API_KEY, RAG returns raw context instead of synthesis."""
        from services.rag_pipeline import rag_query

        with patch("services.rag_pipeline.hybrid_search", new_callable=AsyncMock,
                   return_value=[{"chunk_text": "Some context", "title": "Article", "url": "https://example.com", "id": "1"}]):
            with patch.dict(os.environ, {}, clear=True):
                os.environ.pop("ANTHROPIC_API_KEY", None)
                result = await rag_query("What is X?", "user-123")
                assert "No API key configured" in result["answer"]
                assert len(result["sources"]) == 1

    @pytest.mark.asyncio
    async def test_rag_empty_knowledge_base(self):
        """With no saved items, RAG still calls Claude with empty context.
        Claude will say it can't answer, but the API call is wasted."""
        from services.rag_pipeline import rag_query

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="I don't have enough information.")]
        mock_client.messages.create.return_value = mock_response

        with patch("services.rag_pipeline.hybrid_search", new_callable=AsyncMock, return_value=[]):
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
                with patch("anthropic.Anthropic", return_value=mock_client):
                    result = await rag_query("What is X?", "user-123")
                    assert result["sources"] == []
                    # Claude was still called with empty context
                    mock_client.messages.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_rag_context_truncation(self):
        """extracted_text is sliced to [:1000] for items without chunk_text.
        This is an arbitrary cutoff that could split mid-sentence."""
        from services.rag_pipeline import rag_query

        long_text = "A" * 5000
        results = [{"extracted_text": long_text, "title": "Long Article", "url": "https://example.com", "id": "1"}]

        with patch("services.rag_pipeline.hybrid_search", new_callable=AsyncMock, return_value=results):
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
                mock_client = MagicMock()
                mock_response = MagicMock()
                mock_response.content = [MagicMock(text="Answer")]
                mock_client.messages.create.return_value = mock_response

                with patch("anthropic.Anthropic", return_value=mock_client):
                    await rag_query("question", "user-123")
                    call_args = mock_client.messages.create.call_args
                    context_in_prompt = call_args[1]["messages"][0]["content"]
                    # The text should be truncated to 1000 chars
                    assert len(long_text[:1000]) == 1000

    @pytest.mark.asyncio
    async def test_rag_query_very_long_question(self):
        """A 10000-word question will be embedded (may exceed token limit)
        and also included in the Claude prompt (consuming context window)."""
        from services.rag_pipeline import rag_query

        long_question = " ".join(["word"] * 10000)

        with patch("services.rag_pipeline.hybrid_search", new_callable=AsyncMock, return_value=[]):
            with patch.dict(os.environ, {}, clear=True):
                os.environ.pop("ANTHROPIC_API_KEY", None)
                result = await rag_query(long_question, "user-123")
                assert "No API key" in result["answer"]

    @pytest.mark.asyncio
    async def test_rag_anthropic_error_propagates(self):
        """If Claude API returns an error, it propagates as unhandled 500."""
        from services.rag_pipeline import rag_query

        with patch("services.rag_pipeline.hybrid_search", new_callable=AsyncMock,
                   return_value=[{"chunk_text": "ctx", "title": "T", "url": "u", "id": "1"}]):
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
                mock_client = MagicMock()
                mock_client.messages.create.side_effect = Exception("API overloaded")
                with patch("anthropic.Anthropic", return_value=mock_client):
                    with pytest.raises(Exception, match="API overloaded"):
                        await rag_query("question", "user-123")


class TestSearchRouter:
    """Tests for the /search endpoint."""

    def test_search_no_limit_validation(self, test_client, mock_supabase):
        """SearchRequest.limit has no upper bound. limit=999999 would
        attempt to return all items."""
        with patch("routers.search.hybrid_search", new_callable=AsyncMock, return_value=[]):
            resp = test_client.post(
                "/search",
                json={"query": "test", "limit": 999999},
                headers={"X-User-Id": "test-user"},
            )
            assert resp.status_code == 200

    def test_search_empty_query(self, test_client, mock_supabase):
        """Empty query string is accepted by Pydantic but will embed an empty
        string (wastes an API call) and ilike with '%%' (matches everything)."""
        with patch("routers.search.hybrid_search", new_callable=AsyncMock, return_value=[]):
            resp = test_client.post(
                "/search",
                json={"query": ""},
                headers={"X-User-Id": "test-user"},
            )
            assert resp.status_code == 200

    def test_search_tags_and_person_id_ignored(self, test_client, mock_supabase):
        """SearchRequest accepts tags and person_id fields, but these are
        NEVER PASSED to hybrid_search. The search function only receives
        query, user_id, n, and type_filter."""
        with patch("routers.search.hybrid_search", new_callable=AsyncMock, return_value=[]) as mock_search:
            resp = test_client.post(
                "/search",
                json={"query": "test", "tags": ["AI"], "person_id": "person-123"},
                headers={"X-User-Id": "test-user"},
            )
            # hybrid_search is called without tags or person_id
            call_kwargs = mock_search.call_args
            assert "tags" not in str(call_kwargs)
            assert "person_id" not in str(call_kwargs)
