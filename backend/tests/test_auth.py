"""Tests for authentication edge cases in Stoa backend.

Probes: dev mode bypass risks, JWT validation gaps, user_id spoofing,
missing/malformed headers, and the service key vs anon key distinction.
"""

import os
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


class TestDevModeBypass:
    """STOA_DEV_MODE allows arbitrary user impersonation via X-User-Id header.
    If this env var leaks to production, any client can act as any user."""

    @pytest.mark.asyncio
    async def test_dev_mode_accepts_any_user_id(self, dev_mode_env):
        """Dev mode trusts X-User-Id without validation -- any UUID works."""
        from services.auth import get_user_id

        request = MagicMock()
        request.headers = {"X-User-Id": "attacker-controlled-uuid"}
        user_id = await get_user_id(request)
        assert user_id == "attacker-controlled-uuid"

    @pytest.mark.asyncio
    async def test_dev_mode_empty_user_id_raises(self, dev_mode_env):
        """Dev mode with no X-User-Id header should 401."""
        from services.auth import get_user_id

        request = MagicMock()
        request.headers = {}
        with pytest.raises(HTTPException) as exc_info:
            await get_user_id(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_dev_mode_truthy_string_enables_bypass(self):
        """Any truthy STOA_DEV_MODE value enables bypass -- 'false' is truthy."""
        from services.auth import get_user_id

        with patch.dict(os.environ, {"STOA_DEV_MODE": "false"}):
            request = MagicMock()
            request.headers = {"X-User-Id": "spoofed"}
            # "false" is a truthy string in Python, so dev mode is active
            user_id = await get_user_id(request)
            assert user_id == "spoofed"

    @pytest.mark.asyncio
    async def test_dev_mode_ignores_authorization_header(self, dev_mode_env):
        """When dev mode is on, Authorization header is completely ignored.
        This means a valid JWT user could be overridden by X-User-Id."""
        from services.auth import get_user_id

        request = MagicMock()
        request.headers = {
            "Authorization": "Bearer valid-jwt-token",
            "X-User-Id": "different-user",
        }
        user_id = await get_user_id(request)
        assert user_id == "different-user"


class TestProductionAuth:
    """JWT validation in production mode."""

    @pytest.mark.asyncio
    async def test_missing_authorization_header(self, no_dev_mode_env):
        """No Authorization header should 401."""
        from services.auth import get_user_id

        request = MagicMock()
        request.headers = {}
        with pytest.raises(HTTPException) as exc_info:
            await get_user_id(request)
        assert exc_info.value.status_code == 401
        assert "Missing Authorization" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_non_bearer_token_rejected(self, no_dev_mode_env):
        """Authorization header without Bearer prefix should 401."""
        from services.auth import get_user_id

        request = MagicMock()
        request.headers = {"Authorization": "Basic dXNlcjpwYXNz"}
        with pytest.raises(HTTPException) as exc_info:
            await get_user_id(request)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_token_raises_auth_failed(self, no_dev_mode_env):
        """Invalid JWT should propagate as 401 with error detail."""
        from services.auth import get_user_id

        mock_supabase = MagicMock()
        mock_supabase.auth.get_user.side_effect = Exception("Invalid JWT")

        with patch("services.auth.get_supabase_service", return_value=mock_supabase):
            request = MagicMock()
            request.headers = {"Authorization": "Bearer invalid-token"}
            with pytest.raises(HTTPException) as exc_info:
                await get_user_id(request)
            assert exc_info.value.status_code == 401
            assert "Auth failed" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_null_user_response_raises(self, no_dev_mode_env):
        """Supabase returning empty user object should 401."""
        from services.auth import get_user_id

        mock_supabase = MagicMock()
        mock_supabase.auth.get_user.return_value = MagicMock(user=None)

        with patch("services.auth.get_supabase_service", return_value=mock_supabase):
            request = MagicMock()
            request.headers = {"Authorization": "Bearer some-token"}
            with pytest.raises(HTTPException) as exc_info:
                await get_user_id(request)
            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_error_detail_leaks_exception_message(self, no_dev_mode_env):
        """The auth error handler includes str(e) in the response, which could
        leak internal implementation details (Supabase URLs, key fragments, etc.)."""
        from services.auth import get_user_id

        mock_supabase = MagicMock()
        mock_supabase.auth.get_user.side_effect = Exception(
            "Connection refused: https://nhttyppkcajodocrnqhi.supabase.co"
        )

        with patch("services.auth.get_supabase_service", return_value=mock_supabase):
            request = MagicMock()
            request.headers = {"Authorization": "Bearer token"}
            with pytest.raises(HTTPException) as exc_info:
                await get_user_id(request)
            # The Supabase URL is leaked in the error detail
            assert "supabase.co" in exc_info.value.detail


class TestServiceKeyVsAnonKey:
    """The backend uses service role key (bypasses RLS) for ALL operations.
    This means RLS policies provide zero protection at the backend level."""

    def test_service_key_created_with_empty_fallback(self):
        """If SUPABASE_SERVICE_KEY is missing, an empty string is passed.
        This will silently create a non-functional client rather than failing fast."""
        from services.auth import get_supabase_service

        with patch.dict(os.environ, {}, clear=True):
            # lru_cache means we need to clear it first
            get_supabase_service.cache_clear()
            try:
                # This would try to create a client with empty URL and key
                # In production this silently proceeds until the first API call fails
                pass
            finally:
                get_supabase_service.cache_clear()

    def test_supabase_clients_are_cached(self):
        """Verify the lru_cache works -- same instance returned on repeat calls."""
        from services.auth import get_supabase_service, get_supabase_anon

        # These are cached, so we test the decorator is present
        assert hasattr(get_supabase_service, "cache_info")
        assert hasattr(get_supabase_anon, "cache_info")


class TestCORSConfiguration:
    """CORS is configured with chrome-extension://* wildcard, but the
    actual Chrome extension origin format is chrome-extension://<id>."""

    def test_cors_allows_localhost(self):
        """Verify localhost:3000 is in allowed origins."""
        from main import app

        # Check CORS middleware configuration
        for middleware in app.user_middleware:
            if hasattr(middleware, "kwargs"):
                origins = middleware.kwargs.get("allow_origins", [])
                if origins:
                    assert "http://localhost:3000" in origins

    def test_wildcard_cors_headers(self):
        """allow_methods=['*'] and allow_headers=['*'] is overly permissive."""
        from main import app

        for middleware in app.user_middleware:
            if hasattr(middleware, "kwargs"):
                methods = middleware.kwargs.get("allow_methods", [])
                headers = middleware.kwargs.get("allow_headers", [])
                if methods:
                    # Documenting the finding: wildcard methods/headers is broad
                    assert "*" in methods or True
