"""URL validation to prevent SSRF attacks."""

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException


BLOCKED_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "169.254.169.254",
}


def validate_url(url: str) -> str:
    """Validate a URL is safe to fetch (no SSRF).

    - Must be http or https
    - Must not resolve to a private/loopback IP
    - Must not be a known metadata endpoint
    """
    parsed = urlparse(url)

    # Scheme check
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail=f"Invalid URL scheme: {parsed.scheme}")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="No hostname in URL")

    # Block known metadata endpoints
    if hostname in BLOCKED_HOSTS:
        raise HTTPException(status_code=400, detail="Blocked host")

    # Resolve and check for private IPs
    try:
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            ip = ipaddress.ip_address(addr)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                raise HTTPException(
                    status_code=400,
                    detail="URL resolves to private/loopback address"
                )
    except socket.gaierror:
        raise HTTPException(status_code=400, detail=f"Cannot resolve hostname: {hostname}")

    return url
