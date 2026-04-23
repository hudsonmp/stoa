"""Project-note comment CRUD — Google-Docs-style sidebar comments.

Endpoints mounted at `/note-comments`.

Design notes
────────────
- Comments belong to `project_notes` only. Library notes do not accept
  comments (see migration 015).
- `range_selector` is a W3C Web Annotation selector stored as jsonb. The
  editor emits the same shape project_highlights uses (TextQuoteSelector
  with exact/prefix/suffix) so the two anchoring stacks converge.
- Threading: `parent_id` is nullable. Root comments have no parent. Replies
  point at the root comment's id. The API does not enforce a depth limit.
- Returns an owner-only view; ownership is enforced both by `user_id = auth.uid()`
  at RLS level and by explicit `.eq("user_id", ...)` here for when the service
  role is bypassing RLS.
"""

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.auth import get_supabase_service, get_user_id

router = APIRouter()


# ─── request models ──────────────────────────────────────────────────────────


class CreateCommentRequest(BaseModel):
    project_note_id: str
    body: str
    range_selector: Optional[Any] = None
    parent_id: Optional[str] = None


class UpdateCommentRequest(BaseModel):
    body: Optional[str] = None
    resolved: Optional[bool] = None
    range_selector: Optional[Any] = None


# ─── ownership guard ─────────────────────────────────────────────────────────


def _assert_note_owned(supabase: Any, note_id: str, user_id: str) -> None:
    check = (
        supabase.table("project_notes")
        .select("id")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="Project note not found")


# ─── CRUD ────────────────────────────────────────────────────────────────────


@router.get("")
async def list_comments(request: Request, project_note_id: str):
    """Return all comments on a project note, ordered by created_at asc.

    Client groups into threads by (id, parent_id) in JS.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    _assert_note_owned(supabase, project_note_id, user_id)

    result = (
        supabase.table("note_comments")
        .select("*")
        .eq("project_note_id", project_note_id)
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    return {"comments": result.data or []}


@router.post("")
async def create_comment(req: CreateCommentRequest, request: Request):
    """Create a root comment or a reply (when `parent_id` is set)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    _assert_note_owned(supabase, req.project_note_id, user_id)

    if not req.body or not req.body.strip():
        raise HTTPException(status_code=400, detail="Comment body required")

    if req.parent_id:
        # Sanity: parent must exist on the same note and be owned.
        parent_check = (
            supabase.table("note_comments")
            .select("id, project_note_id")
            .eq("id", req.parent_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not parent_check.data:
            raise HTTPException(status_code=404, detail="Parent comment not found")
        if parent_check.data[0].get("project_note_id") != req.project_note_id:
            raise HTTPException(status_code=400, detail="Parent comment is on a different note")

    row: dict[str, Any] = {
        "project_note_id": req.project_note_id,
        "user_id": user_id,
        "body": req.body,
        "parent_id": req.parent_id,
    }
    if req.range_selector is not None:
        row["range_selector"] = req.range_selector

    result = supabase.table("note_comments").insert(row).execute()
    return {"comment": result.data[0]}


@router.patch("/{comment_id}")
async def update_comment(comment_id: str, req: UpdateCommentRequest, request: Request):
    """Patch a comment's body, range, or resolved flag."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    updates: dict[str, Any] = {}
    if req.body is not None:
        if not req.body.strip():
            raise HTTPException(status_code=400, detail="Comment body cannot be empty")
        updates["body"] = req.body
    if req.resolved is not None:
        updates["resolved"] = req.resolved
    if req.range_selector is not None:
        updates["range_selector"] = req.range_selector
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = (
        supabase.table("note_comments")
        .update(updates)
        .eq("id", comment_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"comment": result.data[0]}


@router.delete("/{comment_id}")
async def delete_comment(comment_id: str, request: Request):
    """Delete a comment (cascades to replies via parent_id FK)."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("note_comments")
        .delete()
        .eq("id", comment_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"deleted": True, "id": comment_id}
