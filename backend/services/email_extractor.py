"""Gmail thread extraction service."""
import asyncio, base64, json, re
from pathlib import Path
from typing import Optional

def _load_gmail_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    token_path = Path.home() / "gmail-mcp" / "token.json"
    if not token_path.exists():
        raise FileNotFoundError(f"Gmail token not found at {token_path}")
    with open(token_path) as fh:
        data = json.load(fh)
    creds = Credentials(
        token=data.get("token"), refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id"), client_secret=data.get("client_secret"),
        scopes=data.get("scopes"),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds

def _html_to_text(html: str) -> str:
    text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL|re.IGNORECASE)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL|re.IGNORECASE)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
    for h in range(1, 7):
        text = re.sub(rf'<h{h}[^>]*>(.*?)</h{h}>', r'\1\n', text, flags=re.IGNORECASE|re.DOTALL)
    text = re.sub(r'<li[^>]*>(.*?)</li>', r'• \1\n', text, flags=re.IGNORECASE|re.DOTALL)
    text = re.sub(r'<a[^>]+href=["\'\']([^"\'\']+)["\'\'"][^>]*>(.*?)</a>', r'\2 (\1)', text, flags=re.IGNORECASE|re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r' {2,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def _decode_part(part: dict) -> str:
    data = part.get("body", {}).get("data", "")
    if not data: return ""
    try: return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception: return ""

def _extract_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    if mime == "text/plain": return _decode_part(payload)
    if mime == "text/html": return _html_to_text(_decode_part(payload))
    if mime.startswith("multipart/"):
        parts = payload.get("parts", [])
        for part in parts:
            if part.get("mimeType") == "text/plain":
                t = _decode_part(part)
                if t.strip(): return t
        for part in parts:
            if part.get("mimeType") == "text/html":
                t = _html_to_text(_decode_part(part))
                if t.strip(): return t
        for part in parts:
            t = _extract_body(part)
            if t.strip(): return t
    return ""

def _get_header(headers: list, name: str) -> str:
    name_lower = name.lower()
    for h in headers:
        if h.get("name", "").lower() == name_lower: return h.get("value", "")
    return ""

def _sync_fetch_gmail_thread(thread_id: str) -> dict:
    from googleapiclient.discovery import build
    creds = _load_gmail_creds()
    gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)
    thread = gmail.users().threads().get(userId="me", id=thread_id, format="full").execute()
    subject = ""
    messages = []
    participants = set()
    for msg in thread.get("messages", []):
        headers = msg.get("payload", {}).get("headers", [])
        msg_subject = _get_header(headers, "Subject")
        if not subject and msg_subject: subject = msg_subject
        sender = _get_header(headers, "From")
        date = _get_header(headers, "Date")
        body = _extract_body(msg.get("payload", {}))
        if sender: participants.add(sender)
        messages.append({"message_id": msg.get("id", ""), "sender": sender, "date": date, "body": body})
    return {
        "thread_id": thread_id,
        "subject": subject or "No subject",
        "participants": list(participants),
        "messages": messages,
    }

async def fetch_gmail_thread(thread_id: str) -> dict:
    return await asyncio.to_thread(_sync_fetch_gmail_thread, thread_id)
