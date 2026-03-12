"""Spaced repetition review endpoints."""

import os
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from supabase import create_client

from services.spaced_rep import next_review

router = APIRouter()


def get_supabase():
    return create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY"),
    )


class ReviewResponse(BaseModel):
    review_id: str
    quality: int  # 0=forgot, 1=hard, 2=good, 3=easy


@router.post("/next")
async def get_next_reviews(user_id: str, limit: int = 5):
    """Get highlights due for review."""
    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    result = (
        supabase.table("review_queue")
        .select("*, highlights(*)")
        .eq("user_id", user_id)
        .lte("next_review_at", now)
        .order("next_review_at")
        .limit(limit)
        .execute()
    )

    return {"reviews": result.data or []}


@router.post("/respond")
async def respond_to_review(req: ReviewResponse):
    """Update review schedule based on user response."""
    supabase = get_supabase()

    # Get current review state
    result = supabase.table("review_queue").select("*").eq("id", req.review_id).execute()
    if not result.data:
        return {"error": "Review not found"}

    review = result.data[0]

    # Calculate next review
    schedule = next_review(review["difficulty"], review["repetitions"], req.quality)

    # Update
    supabase.table("review_queue").update({
        "next_review_at": schedule["next_review_at"],
        "difficulty": schedule["difficulty"],
        "repetitions": schedule["repetitions"],
        "last_reviewed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", req.review_id).execute()

    return {"next_review": schedule}
