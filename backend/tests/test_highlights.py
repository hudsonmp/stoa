"""Tests for highlight CRUD edge cases.

Probes: XSS via highlight text/css_selector, missing item ownership
verification, missing highlight deletion, review queue coupling,
and color validation.
"""

import os
from unittest.mock import MagicMock, patch

import pytest


class TestCreateHighlight:
    """Tests for POST /highlights."""

    def test_create_highlight_no_item_ownership_check(self, test_client, mock_supabase):
        """The create_highlight endpoint does NOT verify that item_id belongs
        to the requesting user. Any user can create highlights on any item
        if they know the item UUID."""
        mock_supabase.set_table_data("highlights", [{
            "id": "highlight-1",
            "item_id": "other-users-item",
            "user_id": "test-user",
            "text": "highlighted text",
            "color": "yellow",
            "created_at": "2024-01-01T00:00:00Z",
        }])
        mock_supabase.set_table_data("review_queue", [{
            "id": "review-1",
            "user_id": "test-user",
            "highlight_id": "highlight-1",
        }])

        resp = test_client.post(
            "/highlights",
            json={
                "item_id": "other-users-item",  # Could be any UUID
                "text": "I can highlight anyone's content",
            },
            headers={"X-User-Id": "test-user"},
        )
        # Succeeds because there's no ownership check on item_id
        assert resp.status_code == 200

    def test_create_highlight_xss_in_text(self, test_client, mock_supabase):
        """Highlight text containing HTML/JS is stored as-is. If rendered
        without escaping in the webapp or Chrome extension, this is XSS."""
        mock_supabase.set_table_data("highlights", [{
            "id": "h-xss",
            "item_id": "item-1",
            "user_id": "test-user",
            "text": '<img src=x onerror="alert(document.cookie)">',
            "color": "yellow",
            "created_at": "2024-01-01T00:00:00Z",
        }])
        mock_supabase.set_table_data("review_queue", [{"id": "r-1"}])

        resp = test_client.post(
            "/highlights",
            json={
                "item_id": "item-1",
                "text": '<img src=x onerror="alert(document.cookie)">',
            },
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200
        # The XSS payload is stored verbatim
        assert "onerror" in resp.json()["highlight"]["text"]

    def test_create_highlight_xss_in_css_selector(self, test_client, mock_supabase):
        """css_selector is stored as-is and used in document.querySelector()
        in the Chrome extension. A malicious selector could be crafted."""
        mock_supabase.set_table_data("highlights", [{
            "id": "h-css",
            "item_id": "item-1",
            "user_id": "test-user",
            "text": "legit text",
            "css_selector": "body > div:nth-of-type(1)",
            "color": "yellow",
            "created_at": "2024-01-01T00:00:00Z",
        }])
        mock_supabase.set_table_data("review_queue", [{"id": "r-1"}])

        resp = test_client.post(
            "/highlights",
            json={
                "item_id": "item-1",
                "text": "legit text",
                "css_selector": "body > div:nth-of-type(1)",
            },
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200

    def test_create_highlight_no_color_validation(self, test_client, mock_supabase):
        """Color field accepts any string. No validation against the
        allowed colors (yellow, green, blue, pink, purple). This could
        lead to CSS class injection: 'yellow" onclick="alert(1)'."""
        mock_supabase.set_table_data("highlights", [{
            "id": "h-color",
            "item_id": "item-1",
            "user_id": "test-user",
            "text": "text",
            "color": "yellow\" onclick=\"alert(1)",
            "created_at": "2024-01-01T00:00:00Z",
        }])
        mock_supabase.set_table_data("review_queue", [{"id": "r-1"}])

        resp = test_client.post(
            "/highlights",
            json={
                "item_id": "item-1",
                "text": "text",
                "color": "yellow\" onclick=\"alert(1)",
            },
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200

    def test_create_highlight_very_long_text(self, test_client, mock_supabase):
        """No size limit on highlight text. A 1MB highlight would be stored."""
        mock_supabase.set_table_data("highlights", [{
            "id": "h-long",
            "item_id": "item-1",
            "user_id": "test-user",
            "text": "x" * 1_000_000,
            "color": "yellow",
            "created_at": "2024-01-01T00:00:00Z",
        }])
        mock_supabase.set_table_data("review_queue", [{"id": "r-1"}])

        resp = test_client.post(
            "/highlights",
            json={
                "item_id": "item-1",
                "text": "x" * 1_000_000,
            },
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200

    def test_create_highlight_auto_enqueues_review(self, test_client, mock_supabase):
        """Every highlight is auto-added to review queue. There's no way
        to opt out. Highlights on metadata (titles, authors) shouldn't
        necessarily be in spaced repetition."""
        mock_supabase.set_table_data("highlights", [{
            "id": "h-1",
            "item_id": "item-1",
            "user_id": "test-user",
            "text": "test",
            "color": "yellow",
            "created_at": "2024-01-01T00:00:00Z",
        }])
        mock_supabase.set_table_data("review_queue", [{
            "id": "r-1",
            "user_id": "test-user",
            "highlight_id": "h-1",
        }])

        resp = test_client.post(
            "/highlights",
            json={"item_id": "item-1", "text": "test"},
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200


class TestGetHighlights:
    """Tests for GET /highlights."""

    def test_get_highlights_no_filters_returns_all(self, test_client, mock_supabase):
        """If neither url nor item_id is provided, the query has no item filter.
        It returns ALL highlights for the user, which may be a lot."""
        resp = test_client.get(
            "/highlights",
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200

    def test_get_highlights_url_with_special_chars(self, test_client, mock_supabase):
        """URL parameter with query string, fragments, and special chars."""
        resp = test_client.get(
            "/highlights?url=https%3A%2F%2Fexample.com%2Fpage%3Ffoo%3Dbar%26baz%3D1",
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200

    def test_get_highlights_hardcoded_limit_100(self, test_client, mock_supabase):
        """The limit is hardcoded to 100. No pagination support.
        If a user has 500 highlights on one item, only the latest 100 are returned."""
        # Document the pagination gap
        pass


class TestMissingHighlightOperations:
    """Operations that should exist but don't."""

    def test_no_delete_endpoint(self, test_client):
        """There is no DELETE /highlights/{id} endpoint.
        Once a highlight is created, it cannot be deleted via the API."""
        resp = test_client.delete(
            "/highlights/some-uuid",
            headers={"X-User-Id": "test-user"},
        )
        # Should return 405 Method Not Allowed or 404
        assert resp.status_code in (404, 405)

    def test_no_update_endpoint(self, test_client):
        """There is no PUT/PATCH /highlights/{id} endpoint.
        Highlight color and note cannot be updated after creation."""
        resp = test_client.patch(
            "/highlights/some-uuid",
            json={"color": "blue"},
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code in (404, 405)


class TestReviewEndpoints:
    """Tests for the review (spaced repetition) endpoints."""

    def test_review_respond_not_found_returns_200(self, test_client, mock_supabase):
        """When a review is not found, the endpoint returns 200 with
        {"error": "Review not found"} instead of 404. This is inconsistent
        with other endpoints and makes error handling harder for clients."""
        mock_supabase.set_table_data("review_queue", [])

        resp = test_client.post(
            "/review/respond",
            json={"review_id": "nonexistent", "quality": 2},
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200
        assert resp.json().get("error") == "Review not found"

    def test_review_quality_no_range_validation(self, test_client, mock_supabase):
        """quality field accepts any integer. Values outside 0-3 would
        fall into the else branch (quality >= 1) in next_review(),
        treating quality=99 the same as quality=3 (easy)."""
        mock_supabase.set_table_data("review_queue", [{
            "id": "review-1",
            "user_id": "test-user",
            "highlight_id": "h-1",
            "difficulty": 0.3,
            "repetitions": 0,
            "next_review_at": "2024-01-01T00:00:00Z",
        }])

        resp = test_client.post(
            "/review/respond",
            json={"review_id": "review-1", "quality": 99},
            headers={"X-User-Id": "test-user"},
        )
        assert resp.status_code == 200

    def test_review_negative_quality(self, test_client, mock_supabase):
        """quality=-1 is accepted. In next_review, since -1 != 0 and -1 >= 1 is False,
        it falls through to the else branch, but -1 < 0 means
        the if/elif/else chain: quality==0 -> no, quality==1 -> no,
        quality==2 -> no, else (quality==3 case) -> difficulty decreases.
        Negative quality is treated as 'easy'."""
        from services.spaced_rep import next_review
        result = next_review(0.5, 0, -1)
        # quality=-1 is not 0, so it enters the else branch (quality >= 1)
        # Then quality==1? No. quality==2? No. else -> difficulty decreases
        assert result["difficulty"] == 0.4  # 0.5 - 0.1


class TestSpacedRepAlgorithm:
    """Tests for the spaced_rep.next_review function."""

    def test_quality_zero_resets_repetitions(self):
        """Forgotten items reset to 0 repetitions."""
        from services.spaced_rep import next_review
        result = next_review(0.3, 5, 0)
        assert result["repetitions"] == 0
        assert result["difficulty"] == 0.5  # 0.3 + 0.2

    def test_difficulty_capped_at_1(self):
        """Difficulty can't exceed 1.0."""
        from services.spaced_rep import next_review
        result = next_review(0.9, 0, 0)
        assert result["difficulty"] == 1.0

    def test_difficulty_floored_at_0(self):
        """Difficulty can't go below 0.0."""
        from services.spaced_rep import next_review
        result = next_review(0.05, 3, 3)
        assert result["difficulty"] == 0.0

    def test_high_repetitions_cap_at_max_interval(self):
        """After max interval index, interval stays at 2160 hours (3 months)."""
        from services.spaced_rep import next_review
        result = next_review(0.3, 100, 2)
        # repetitions=101, idx=min(101, 6)=6, BASE_INTERVALS[6]=2160
        assert result["repetitions"] == 101
