"""Social layer v2: profiles + bidirectional friendships.

Design contract (see supabase/migrations/006_friendships_and_profiles.sql):
  - Stoa's social layer is a private salon, not a follow graph. Every edge
    requires both parties to accept.
  - No per-item privacy toggle. Anything a user saves is visible to their
    accepted friends, full stop.
  - friendships table is a directed request row with status (pending|accepted).
    Two users are friends iff a row exists in EITHER direction with status
    'accepted'. The DB function are_friends(a, b) abstracts this.

API surface:
  GET    /social/me                          — own profile (auto-backfill)
  PATCH  /social/me                          — update username, display_name, bio
  POST   /social/setup                       — first-time profile claim
  GET    /social/profile/{username}          — public profile + friendship state
  GET    /social/profile/{username}/items    — friend's bookshelf (404 if not friend)
  GET    /social/search?q=                   — find users by username/name prefix

  POST   /social/friend-request              — send request (creates pending row)
  POST   /social/friend-accept               — accept pending request
  POST   /social/friend-remove               — unfriend OR reject OR withdraw pending
  GET    /social/friends                     — accepted friendships
  GET    /social/friend-requests/incoming    — pending where I am addressee
  GET    /social/friend-requests/outgoing    — pending where I am requester

  GET    /social/feed                        — activity from my accepted friends
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.auth import get_supabase_service, get_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

class UpdateProfileRequest(BaseModel):
    username: Optional[str] = Field(default=None, pattern=r"^[a-z0-9_]{3,24}$")
    display_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None


class SetupProfileRequest(BaseModel):
    username: str = Field(pattern=r"^[a-z0-9_]{3,24}$")
    display_name: Optional[str] = None
    bio: Optional[str] = None


@router.get("/me")
async def get_my_profile(request: Request):
    """Return the authenticated user's profile. Backfills on demand for legacy
    users who existed before the signup trigger was installed.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    result = (
        supabase.table("profiles")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return {"profile": result.data[0], "needs_setup": False}

    # Legacy backfill
    import re
    auth_user = supabase.auth.admin.get_user_by_id(user_id)
    email = (auth_user.user.email or "") if auth_user and auth_user.user else ""
    local = re.sub(r"[^a-z0-9_]", "_", email.split("@", 1)[0].lower())[:18] if email else "user"
    placeholder_username = f"{local}_{user_id[:6]}"

    insert = supabase.table("profiles").insert({
        "user_id": user_id,
        "username": placeholder_username,
        "display_name": local.replace("_", " ").title() or "User",
    }).execute()
    return {"profile": insert.data[0], "needs_setup": True}


@router.patch("/me")
async def update_my_profile(req: UpdateProfileRequest, request: Request):
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        result = (
            supabase.table("profiles")
            .update(updates)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Username already taken")
        raise

    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"profile": result.data[0]}


@router.post("/setup")
async def setup_profile(req: SetupProfileRequest, request: Request):
    """First-time profile claim. Called from the onboarding modal after signup.
    Upserts by user_id so it's safe to run multiple times (it replaces the
    auto-generated placeholder username with the user's real choice).
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    payload = {
        "user_id": user_id,
        "username": req.username,
        "display_name": req.display_name or req.username,
        "bio": req.bio,
    }
    try:
        result = supabase.table("profiles").upsert(payload, on_conflict="user_id").execute()
    except Exception as e:
        if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Username already taken")
        raise

    return {"profile": result.data[0]}


@router.get("/profile/{username}")
async def get_profile_by_username(username: str, request: Request):
    """Public profile view. Returns profile + mutual friendship state from the
    viewer's perspective."""
    viewer_id: Optional[str] = None
    try:
        viewer_id = await get_user_id(request)
    except HTTPException:
        pass

    supabase = get_supabase_service()
    profile_res = (
        supabase.table("profiles")
        .select("*")
        .eq("username", username)
        .limit(1)
        .execute()
    )
    if not profile_res.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = profile_res.data[0]
    target_id = profile["user_id"]

    friend_count_res = (
        supabase.table("friendships")
        .select("requester_id, addressee_id", count="exact")
        .or_(f"requester_id.eq.{target_id},addressee_id.eq.{target_id}")
        .eq("status", "accepted")
        .execute()
    )
    friend_count = friend_count_res.count or 0

    friendship_state = "none"  # none | pending_outgoing | pending_incoming | accepted | self
    if viewer_id == target_id:
        friendship_state = "self"
    elif viewer_id:
        edge_res = (
            supabase.table("friendships")
            .select("requester_id, addressee_id, status")
            .or_(
                f"and(requester_id.eq.{viewer_id},addressee_id.eq.{target_id}),"
                f"and(requester_id.eq.{target_id},addressee_id.eq.{viewer_id})"
            )
            .limit(1)
            .execute()
        )
        if edge_res.data:
            edge = edge_res.data[0]
            if edge["status"] == "accepted":
                friendship_state = "accepted"
            elif edge["requester_id"] == viewer_id:
                friendship_state = "pending_outgoing"
            else:
                friendship_state = "pending_incoming"

    return {
        "profile": profile,
        "friend_count": friend_count,
        "friendship_state": friendship_state,
    }


@router.get("/profile/{username}/items")
async def get_profile_items(username: str, request: Request, limit: int = 60):
    """Return a friend's bookshelf. Gated on accepted friendship — returns 403
    if the viewer is not a friend of the target (or not the target themselves).
    """
    viewer_id = await get_user_id(request)
    supabase = get_supabase_service()

    profile_res = (
        supabase.table("profiles")
        .select("user_id, username, display_name, avatar_url")
        .eq("username", username)
        .limit(1)
        .execute()
    )
    if not profile_res.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = profile_res.data[0]
    target_id = profile["user_id"]

    if target_id != viewer_id:
        # Require an accepted friendship in either direction
        friend_check = (
            supabase.table("friendships")
            .select("status")
            .or_(
                f"and(requester_id.eq.{viewer_id},addressee_id.eq.{target_id}),"
                f"and(requester_id.eq.{target_id},addressee_id.eq.{viewer_id})"
            )
            .eq("status", "accepted")
            .limit(1)
            .execute()
        )
        if not friend_check.data:
            raise HTTPException(status_code=403, detail="You are not friends with this user")

    items_res = (
        supabase.table("items")
        .select("id, title, url, type, domain, favicon_url, cover_image_url, spine_color, text_color, summary, created_at")
        .eq("user_id", target_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"items": items_res.data or [], "profile": profile}


@router.get("/search")
async def search_users(request: Request, q: str = "", limit: int = 20):
    """Username / display_name prefix search. Used to find people to send
    friend requests to. No auth required to search (profiles are public).
    """
    if not q or len(q.strip()) < 2:
        return {"users": []}
    supabase = get_supabase_service()
    term = f"%{q.strip().lower()}%"
    result = (
        supabase.table("profiles")
        .select("user_id, username, display_name, avatar_url, bio")
        .or_(f"username.ilike.{term},display_name.ilike.{term}")
        .limit(limit)
        .execute()
    )
    return {"users": result.data or []}


# ---------------------------------------------------------------------------
# Friendships
# ---------------------------------------------------------------------------

class FriendActionRequest(BaseModel):
    username: str


def _resolve_user_id(supabase, username: str) -> str:
    res = (
        supabase.table("profiles")
        .select("user_id")
        .eq("username", username)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data[0]["user_id"]


def _edge_exists(supabase, a: str, b: str) -> Optional[dict]:
    """Return the friendship row between two users (in either direction), or None."""
    res = (
        supabase.table("friendships")
        .select("*")
        .or_(
            f"and(requester_id.eq.{a},addressee_id.eq.{b}),"
            f"and(requester_id.eq.{b},addressee_id.eq.{a})"
        )
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


@router.post("/friend-request")
async def send_friend_request(req: FriendActionRequest, request: Request):
    """Send a friend request to @username. Rules:
      - You can't friend yourself.
      - If an accepted friendship already exists, return it (idempotent).
      - If a pending request from you exists, return it (idempotent).
      - If a pending request from THEM to YOU exists, auto-accept (they asked
        first, you saying yes is the natural response).
      - Otherwise, insert a new pending row.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    target_id = _resolve_user_id(supabase, req.username)

    if target_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot friend yourself")

    existing = _edge_exists(supabase, user_id, target_id)
    if existing:
        if existing["status"] == "accepted":
            return {"friendship_state": "accepted"}
        # A pending edge exists. If it's from them to us, accepting is the
        # right move — otherwise it's our own outbound request.
        if existing["requester_id"] == target_id:
            supabase.table("friendships").update({
                "status": "accepted",
                "accepted_at": "now()",
            }).eq("requester_id", target_id).eq("addressee_id", user_id).execute()
            return {"friendship_state": "accepted", "auto_accepted": True}
        return {"friendship_state": "pending_outgoing"}

    supabase.table("friendships").insert({
        "requester_id": user_id,
        "addressee_id": target_id,
        "status": "pending",
    }).execute()
    return {"friendship_state": "pending_outgoing"}


@router.post("/friend-accept")
async def accept_friend_request(req: FriendActionRequest, request: Request):
    """Accept a pending request from @username. Only the addressee can accept."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    target_id = _resolve_user_id(supabase, req.username)

    # There must be a pending row where they are requester, we are addressee.
    result = (
        supabase.table("friendships")
        .update({"status": "accepted", "accepted_at": "now()"})
        .eq("requester_id", target_id)
        .eq("addressee_id", user_id)
        .eq("status", "pending")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No pending request from this user")
    return {"friendship_state": "accepted"}


@router.post("/friend-remove")
async def remove_friend(req: FriendActionRequest, request: Request):
    """Break a friendship OR reject a pending request OR withdraw an outgoing
    pending request. One endpoint because the action is the same: delete the
    edge in whichever direction it exists.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()
    target_id = _resolve_user_id(supabase, req.username)

    # Delete edge in either direction. Use two targeted deletes because
    # supabase-py's .or_() on delete has quoting quirks.
    supabase.table("friendships").delete() \
        .eq("requester_id", user_id).eq("addressee_id", target_id).execute()
    supabase.table("friendships").delete() \
        .eq("requester_id", target_id).eq("addressee_id", user_id).execute()

    return {"friendship_state": "none"}


@router.get("/friends")
async def list_friends(request: Request):
    """Return accepted friends with their profiles."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    edges_res = (
        supabase.table("friendships")
        .select("requester_id, addressee_id, accepted_at")
        .or_(f"requester_id.eq.{user_id},addressee_id.eq.{user_id}")
        .eq("status", "accepted")
        .order("accepted_at", desc=True)
        .execute()
    )
    edges = edges_res.data or []

    # Extract the "other side" of each edge
    other_ids = [
        e["addressee_id"] if e["requester_id"] == user_id else e["requester_id"]
        for e in edges
    ]
    if not other_ids:
        return {"friends": []}

    profiles_res = (
        supabase.table("profiles")
        .select("user_id, username, display_name, avatar_url, bio")
        .in_("user_id", other_ids)
        .execute()
    )
    profiles_by_id = {p["user_id"]: p for p in (profiles_res.data or [])}
    friends = [profiles_by_id[oid] for oid in other_ids if oid in profiles_by_id]
    return {"friends": friends}


@router.get("/friend-requests/incoming")
async def incoming_requests(request: Request):
    """Pending requests where I am the addressee — the inbox."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    edges_res = (
        supabase.table("friendships")
        .select("requester_id, created_at")
        .eq("addressee_id", user_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
    )
    edges = edges_res.data or []
    if not edges:
        return {"requests": []}

    requester_ids = [e["requester_id"] for e in edges]
    profiles_res = (
        supabase.table("profiles")
        .select("user_id, username, display_name, avatar_url, bio")
        .in_("user_id", requester_ids)
        .execute()
    )
    profiles_by_id = {p["user_id"]: p for p in (profiles_res.data or [])}
    requests = []
    for e in edges:
        prof = profiles_by_id.get(e["requester_id"])
        if prof:
            requests.append({**prof, "requested_at": e["created_at"]})
    return {"requests": requests}


@router.get("/friend-requests/outgoing")
async def outgoing_requests(request: Request):
    """Pending requests where I am the requester — who I'm waiting on."""
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    edges_res = (
        supabase.table("friendships")
        .select("addressee_id, created_at")
        .eq("requester_id", user_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
    )
    edges = edges_res.data or []
    if not edges:
        return {"requests": []}

    addressee_ids = [e["addressee_id"] for e in edges]
    profiles_res = (
        supabase.table("profiles")
        .select("user_id, username, display_name, avatar_url, bio")
        .in_("user_id", addressee_ids)
        .execute()
    )
    profiles_by_id = {p["user_id"]: p for p in (profiles_res.data or [])}
    requests = []
    for e in edges:
        prof = profiles_by_id.get(e["addressee_id"])
        if prof:
            requests.append({**prof, "requested_at": e["created_at"]})
    return {"requests": requests}


# ---------------------------------------------------------------------------
# Feed — "what my friends are reading"
# ---------------------------------------------------------------------------

@router.get("/feed")
async def get_feed(request: Request, limit: int = 40):
    """Activity from accepted friends. Uses the activity_feed view which joins
    profile and item data. No is_public filter — anything friends save/highlight
    is visible to each other.
    """
    user_id = await get_user_id(request)
    supabase = get_supabase_service()

    friends_res = (
        supabase.table("friendships")
        .select("requester_id, addressee_id")
        .or_(f"requester_id.eq.{user_id},addressee_id.eq.{user_id}")
        .eq("status", "accepted")
        .execute()
    )
    friend_ids = []
    for e in (friends_res.data or []):
        friend_ids.append(
            e["addressee_id"] if e["requester_id"] == user_id else e["requester_id"]
        )
    if not friend_ids:
        return {"feed": []}

    feed_res = (
        supabase.table("activity_feed")
        .select("*")
        .in_("user_id", friend_ids)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"feed": feed_res.data or []}


# ---------------------------------------------------------------------------
# Activity logging helper (used by ingest + highlights routers)
# ---------------------------------------------------------------------------

def log_activity(
    supabase,
    user_id: str,
    action: str,
    item_id: Optional[str] = None,
    highlight_id: Optional[str] = None,
) -> None:
    """Insert an activity row. No is_public param — all activity is visible
    to accepted friends under the v2 trust model. Never raises; activity
    logging is best-effort.
    """
    try:
        row = {"user_id": user_id, "action": action}
        if item_id:
            row["item_id"] = item_id
        if highlight_id:
            row["highlight_id"] = highlight_id
        supabase.table("activity").insert(row).execute()
    except Exception as e:
        logger.warning("activity log failed (action=%s): %s", action, e)
