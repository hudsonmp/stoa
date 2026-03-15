"""Retroactive maintenance: fix types, classify items, deduplicate.

Usage:
    cd backend && .venv/bin/python scripts/retroactive.py
"""

import json
import os
import sys
from collections import defaultdict

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
USER_ID = os.environ.get("STOA_USER_ID", "5f067d11-b2b8-4efe-84c7-5ac9c5602c9a")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def fix_site_to_writing():
    """Change items from hudsonmp.github.io to type 'writing'."""
    result = (
        supabase.table("items")
        .select("id, title, url, type")
        .eq("user_id", USER_ID)
        .ilike("domain", "%hudsonmp.github.io%")
        .execute()
    )
    items = result.data or []
    print(f"\n--- Fix Site Items to 'writing' ---")
    print(f"Found {len(items)} items from hudsonmp.github.io")

    for item in items:
        if item["type"] != "writing":
            supabase.table("items").update({"type": "writing"}).eq("id", item["id"]).execute()
            print(f"  Updated: {item['title']} ({item['type']} -> writing)")
        else:
            print(f"  Already writing: {item['title']}")


def classify_all_items():
    """Run the local classifier on all items and update their types.

    Only reclassifies items with generic types (blog, page) that might
    have been misclassified. Skips items with specific types (paper, book, etc.)
    that were likely set intentionally.
    """
    import httpx

    result = (
        supabase.table("items")
        .select("id, title, url, type, domain")
        .eq("user_id", USER_ID)
        .in_("type", ["blog", "page"])  # Only reclassify generic types
        .execute()
    )
    items = result.data or []
    print(f"\n--- Retroactive Classification ---")
    print(f"Found {len(items)} items with generic types (blog/page) to classify")

    reclassified = 0
    for item in items:
        if not item.get("url"):
            continue

        # Skip own site
        domain = item.get("domain", "")
        if "hudsonmp.github.io" in (domain or ""):
            continue

        try:
            resp = httpx.post(
                "http://localhost:8000/classify",
                json={
                    "url": item.get("url", ""),
                    "title": item.get("title", ""),
                    "domain": item.get("domain", ""),
                },
                timeout=30,
            )
            if resp.status_code == 200:
                classification = resp.json()
                new_type = classification.get("type", item["type"])
                confidence = classification.get("confidence", 0)

                if new_type != item["type"] and confidence >= 0.7:
                    supabase.table("items").update({"type": new_type}).eq("id", item["id"]).execute()
                    print(f"  Reclassified: {item['title'][:60]} ({item['type']} -> {new_type}, conf={confidence:.2f})")
                    reclassified += 1
                else:
                    print(f"  Kept: {item['title'][:60]} as {item['type']} (classified={new_type}, conf={confidence:.2f})")
            else:
                print(f"  Classifier error for {item['title'][:40]}: {resp.status_code}")
        except Exception as e:
            print(f"  Error classifying {item['title'][:40]}: {e}")

    print(f"\nReclassified {reclassified}/{len(items)} items")


def deduplicate():
    """Remove duplicate items by URL, keeping the oldest."""
    result = (
        supabase.table("items")
        .select("id, url, title, created_at")
        .eq("user_id", USER_ID)
        .order("created_at")
        .execute()
    )
    items = result.data or []
    print(f"\n--- Deduplication ---")
    print(f"Total items: {len(items)}")

    url_map = defaultdict(list)
    for item in items:
        url = item.get("url")
        if url:
            url_map[url].append(item)

    duplicates = {url: items for url, items in url_map.items() if len(items) > 1}
    print(f"URLs with duplicates: {len(duplicates)}")

    removed = 0
    for url, dupes in duplicates.items():
        # Keep the first (oldest), delete the rest
        keep = dupes[0]
        to_delete = dupes[1:]
        print(f"  Keeping: {keep['title'][:50]} (created {keep['created_at'][:10]})")

        for dupe in to_delete:
            try:
                # Delete related data first (chunks, highlights, notes, etc.)
                supabase.table("chunks").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("highlights").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("notes").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("citations").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("person_items").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("item_tags").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("activity").delete().eq("item_id", dupe["id"]).execute()
                supabase.table("items").delete().eq("id", dupe["id"]).execute()
                print(f"    Deleted duplicate: {dupe['id']} (created {dupe['created_at'][:10]})")
                removed += 1
            except Exception as e:
                print(f"    Error deleting {dupe['id']}: {e}")

    print(f"\nRemoved {removed} duplicate items")


if __name__ == "__main__":
    print("=== Stoa Retroactive Maintenance ===")
    print(f"User: {USER_ID}")

    # 1. Fix site items to "writing" type
    fix_site_to_writing()

    # 2. Deduplicate (before classifying to avoid wasted work)
    deduplicate()

    # 3. Classify all generic-type items
    classify_all_items()

    print("\n=== Done ===")
