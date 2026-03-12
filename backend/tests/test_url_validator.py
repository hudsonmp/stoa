"""Tests for URL validation / SSRF prevention.

Probes: DNS rebinding, IPv6 bypasses, URL encoding tricks, redirect-based SSRF,
cloud metadata endpoints, and edge cases in hostname parsing.
"""

import socket
from unittest.mock import patch, MagicMock

import pytest
from fastapi import HTTPException


class TestSchemeValidation:
    """Only http/https should be allowed."""

    def test_http_scheme_allowed(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            result = validate_url("http://example.com")
            assert result == "http://example.com"

    def test_https_scheme_allowed(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            result = validate_url("https://example.com")
            assert result == "https://example.com"

    def test_ftp_scheme_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException) as exc_info:
            validate_url("ftp://evil.com/file")
        assert exc_info.value.status_code == 400

    def test_javascript_scheme_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("javascript:alert(1)")

    def test_file_scheme_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("file:///etc/passwd")

    def test_data_scheme_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("data:text/html,<script>alert(1)</script>")

    def test_empty_scheme_blocked(self):
        """URL with no scheme should fail."""
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("example.com/page")


class TestHostnameBlocking:
    """Blocked hostnames for metadata endpoints."""

    def test_localhost_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException) as exc_info:
            validate_url("http://localhost/admin")
        assert "Blocked host" in exc_info.value.detail

    def test_metadata_google_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("http://metadata.google.internal/computeMetadata/v1/")

    def test_aws_metadata_ip_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("http://169.254.169.254/latest/meta-data/")

    def test_no_hostname_blocked(self):
        from services.url_validator import validate_url

        with pytest.raises(HTTPException) as exc_info:
            validate_url("http://")
        assert "No hostname" in exc_info.value.detail


class TestPrivateIPBlocking:
    """DNS resolution should catch private/loopback IPs."""

    def test_loopback_ip_blocked(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 0))]):
            with pytest.raises(HTTPException) as exc_info:
                validate_url("http://evil-redirect.com")
            assert "private/loopback" in exc_info.value.detail

    def test_private_10_range_blocked(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("10.0.0.1", 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://internal-service.com")

    def test_private_172_range_blocked(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("172.16.0.1", 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://internal-service.com")

    def test_private_192_168_blocked(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("192.168.1.1", 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://internal-service.com")

    def test_link_local_blocked(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("169.254.1.1", 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://link-local.com")

    def test_ipv6_loopback_blocked(self):
        """IPv6 ::1 (loopback) should be blocked."""
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(10, 1, 6, "", ("::1", 0, 0, 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://ipv6-loopback.com")

    def test_dns_resolution_failure(self):
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", side_effect=socket.gaierror("Name resolution failed")):
            with pytest.raises(HTTPException) as exc_info:
                validate_url("http://nonexistent.invalid")
            assert "Cannot resolve hostname" in exc_info.value.detail


class TestSSRFBypasses:
    """Attempts to bypass SSRF protection with encoding tricks."""

    def test_decimal_ip_for_localhost(self):
        """http://2130706433 is 127.0.0.1 in decimal. urlparse may not
        parse this as hostname correctly, but the DNS resolution check
        should catch it if it resolves."""
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://2130706433/")

    def test_hex_ip_encoding(self):
        """http://0x7f000001 is 127.0.0.1 in hex."""
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://0x7f000001/")

    def test_url_with_credentials(self):
        """http://user:pass@evil.com -- credentials in URL should still parse hostname."""
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            # urlparse correctly extracts hostname from URLs with credentials
            result = validate_url("http://user:pass@example.com/page")
            assert result  # Should not raise

    def test_localhost_with_port(self):
        """localhost:8080 should still be blocked."""
        from services.url_validator import validate_url

        with pytest.raises(HTTPException):
            validate_url("http://localhost:8080/api")

    def test_ipv6_bracket_notation(self):
        """http://[::1]/ using IPv6 bracket notation."""
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(10, 1, 6, "", ("::1", 0, 0, 0))]):
            with pytest.raises(HTTPException):
                validate_url("http://[::1]/")

    def test_dns_rebinding_toctou(self):
        """DNS rebinding: first resolution returns public IP (passes check),
        then the actual HTTP request resolves to private IP. The current
        implementation only resolves ONCE during validate_url, so it's
        vulnerable to TOCTOU if the DNS TTL is 0.

        This test documents the vulnerability -- the extraction service
        does call validate_url again after redirects, but the initial
        fetch itself could be redirected to internal IPs."""
        from services.url_validator import validate_url

        # First call returns public IP (passes)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            result = validate_url("http://rebinding.attacker.com")
            assert result  # Passes validation
        # But the actual HTTP request could resolve to 127.0.0.1

    def test_redirect_ssrf_gap(self):
        """The extraction service re-validates after redirect, but between
        validate_url() in the router and the actual fetch in extraction.py,
        the URL is fetched without the IP check applied at the socket level.
        httpx.AsyncClient follows redirects, and the redirect target is
        checked, but only at the hostname level (not IP resolution)."""
        # This is a documentation test for the architectural gap
        pass

    def test_aws_metadata_alternate_ip_not_blocked(self):
        """AWS metadata at 169.254.169.254 is in BLOCKED_HOSTS, but
        the same service is accessible via http://[fd00:ec2::254]/ on
        some EC2 instances. This alternate is NOT in the blocklist."""
        from services.url_validator import BLOCKED_HOSTS

        assert "169.254.169.254" in BLOCKED_HOSTS
        # IPv6 equivalent is NOT blocked at hostname level
        assert "fd00:ec2::254" not in BLOCKED_HOSTS


class TestEdgeCases:
    """Edge cases in URL handling."""

    def test_very_long_url(self):
        """URLs with 10000+ characters."""
        from services.url_validator import validate_url

        long_url = "https://example.com/" + "a" * 10000
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            result = validate_url(long_url)
            assert result == long_url

    def test_url_with_unicode_hostname(self):
        """IDN (internationalized domain name) handling."""
        from services.url_validator import validate_url

        # urlparse handles unicode hostnames, but socket.getaddrinfo
        # may or may not resolve them depending on encoding
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            result = validate_url("https://xn--nxasmq6b.example.com/")
            assert result

    def test_url_with_fragment(self):
        """URL with #fragment should pass (fragments are client-side only)."""
        from services.url_validator import validate_url

        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))]):
            result = validate_url("https://example.com/page#section")
            assert result
