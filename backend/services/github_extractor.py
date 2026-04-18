"""GitHub repository extraction service."""
import asyncio, os, re, subprocess
from typing import Optional

def _get_github_token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "")
    if token: return token
    try:
        r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0: return r.stdout.strip()
    except Exception: pass
    return ""

def extract_github_slug(url: str) -> Optional[str]:
    m = re.search(r"https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git|/.*)?$", url)
    return f"{m.group(1)}/{m.group(2)}" if m else None

async def fetch_github_repo(slug: str) -> dict:
    import httpx
    token = _get_github_token()
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "Stoa/1.0"}
    if token: headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        meta_resp = await client.get(f"https://api.github.com/repos/{slug}")
        if meta_resp.status_code == 404: raise ValueError(f"GitHub repo not found: {slug}")
        meta_resp.raise_for_status()
        meta = meta_resp.json()
        readme_md = ""
        try:
            rr = await client.get(f"https://api.github.com/repos/{slug}/readme",
                                  headers={**headers, "Accept": "application/vnd.github.raw"})
            if rr.status_code == 200: readme_md = rr.text
        except Exception: pass
        file_tree = []
        try:
            cr = await client.get(f"https://api.github.com/repos/{slug}/contents")
            if cr.status_code == 200:
                file_tree = [item["name"] for item in cr.json() if isinstance(item, dict)]
        except Exception: pass
    return {
        "full_name": meta.get("full_name", slug),
        "description": meta.get("description") or "",
        "stars": meta.get("stargazers_count", 0),
        "language": meta.get("language") or "",
        "topics": meta.get("topics", []),
        "license": (meta.get("license") or {}).get("spdx_id", ""),
        "last_commit_at": meta.get("pushed_at", ""),
        "readme_md": readme_md,
        "file_tree": file_tree,
    }
