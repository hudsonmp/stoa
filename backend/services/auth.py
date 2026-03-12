"""Authentication: validate Supabase JWT and extract user_id."""

import os
from functools import lru_cache

from fastapi import HTTPException, Request
from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_supabase_service() -> Client:
    """Singleton Supabase client with service role key."""
    return create_client(
        os.getenv("SUPABASE_URL", ""),
        os.getenv("SUPABASE_SERVICE_KEY", ""),
    )


@lru_cache(maxsize=1)
def get_supabase_anon() -> Client:
    """Singleton Supabase client with anon key (respects RLS)."""
    return create_client(
        os.getenv("SUPABASE_URL", ""),
        os.getenv("SUPABASE_ANON_KEY", ""),
    )


async def get_user_id(request: Request) -> str:
    """Extract and validate user_id from Supabase JWT in Authorization header.

    Falls back to X-User-Id header for development when STOA_DEV_MODE is set.
    """
    # Dev mode: trust X-User-Id header
    if os.getenv("STOA_DEV_MODE"):
        user_id = request.headers.get("X-User-Id", "")
        if user_id:
            return user_id
        raise HTTPException(status_code=401, detail="X-User-Id header required in dev mode")

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = auth_header[7:]

    # Validate token via Supabase auth
    try:
        supabase = get_supabase_service()
        user = supabase.auth.get_user(token)
        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user.user.id
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth failed: {str(e)}")
