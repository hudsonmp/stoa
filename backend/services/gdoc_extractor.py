"""Google Docs extraction service."""
import asyncio, json, os, re
from pathlib import Path
from typing import Optional

def extract_gdoc_id(url: str) -> Optional[str]:
    m = re.search(r"/document/d/([a-zA-Z0-9_-]+)", url)
    return m.group(1) if m else None

def _load_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    token_path = Path.home() / "gdocs-mcp" / "token.json"
    if not token_path.exists():
        raise FileNotFoundError(f"GDoc token not found at {token_path}")
    with open(token_path) as fh:
        data = json.load(fh)
    creds = Credentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        scopes=data.get("scopes"),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds

_HEADING_MAP = {"HEADING_1": "#", "HEADING_2": "##", "HEADING_3": "###",
                "HEADING_4": "####", "HEADING_5": "#####", "HEADING_6": "######"}

def _run_text(run: dict) -> str:
    content = run.get("textRun", {}).get("content", "")
    ts = run.get("textRun", {}).get("textStyle", {})
    if ts.get("bold"): content = f"**{content}**"
    if ts.get("italic"): content = f"*{content}*"
    link = ts.get("link", {}).get("url")
    if link: content = f"[{content}]({link})"
    return content

def _element_to_markdown(elem: dict) -> str:
    if "paragraph" in elem:
        para = elem["paragraph"]
        style = para.get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT")
        text = "".join(_run_text(e) for e in para.get("elements", []))
        prefix = _HEADING_MAP.get(style, "")
        return f"{prefix} {text.strip()}\n\n" if prefix else text
    if "table" in elem:
        rows = []
        for row in elem["table"].get("tableRows", []):
            cells = ["".join(_element_to_markdown(e).strip() for e in c.get("content", [])).replace("\n", " ")
                     for c in row.get("tableCells", [])]
            rows.append("| " + " | ".join(cells) + " |")
        if rows:
            sep = "| " + " | ".join(["---"] * len(rows[0].split("|")[1:-1])) + " |"
            rows.insert(1, sep)
        return "\n".join(rows) + "\n\n"
    return ""

def gdoc_to_markdown(doc: dict) -> str:
    return "".join(_element_to_markdown(e) for e in doc.get("body", {}).get("content", []))

def _sync_fetch_gdoc(doc_id: str) -> dict:
    from googleapiclient.discovery import build
    creds = _load_creds()
    docs_svc = build("docs", "v1", credentials=creds, cache_discovery=False)
    drive_svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    doc = docs_svc.documents().get(documentId=doc_id).execute()
    drive_meta = drive_svc.files().get(fileId=doc_id, fields="id,name,owners,modifiedTime,permissions").execute()
    owners = drive_meta.get("owners", [])
    owner_email = owners[0].get("emailAddress", "") if owners else ""
    shared_with = [p.get("emailAddress", "") for p in drive_meta.get("permissions", [])
                   if p.get("type") == "user" and p.get("emailAddress") != owner_email]
    return {
        "title": doc.get("title", "Untitled"),
        "gdoc_id": doc_id,
        "owner_email": owner_email,
        "last_modified": drive_meta.get("modifiedTime", ""),
        "shared_with": shared_with,
        "markdown": gdoc_to_markdown(doc),
    }

async def fetch_gdoc(doc_id: str) -> dict:
    return await asyncio.to_thread(_sync_fetch_gdoc, doc_id)
