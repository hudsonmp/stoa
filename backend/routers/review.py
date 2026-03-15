"""Spaced repetition review endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.auth import get_supabase_service, get_user_id
from services.spaced_rep import next_review

router = APIRouter()


class ReviewResponse(BaseModel):
    review_id: str
    quality: int = Field(ge=0, le=3)  # 0=forgot, 1=hard, 2=good, 3=easy


@router.post("/next")
async def get_next_reviews(request: Request, limit: int = 5):
    """Get highlights due for review."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
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
async def respond_to_review(req: ReviewResponse, request: Request):
    """Update review schedule based on user response."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    # Get current review state — scoped to this user
    result = (
        supabase.table("review_queue")
        .select("*")
        .eq("id", req.review_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Review not found")

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
