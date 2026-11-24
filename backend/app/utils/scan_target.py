"""Network-target validation for scan endpoints.

The scanner must not become an arbitrary internal-network proxy. Targets are
resolved before use and private/special ranges are rejected unless the
deployment explicitly opts into local scanning via ``SPSX_ALLOW_LOCAL_SCAN_TARGETS``.
"""

from __future__ import annotations

import ipaddress
import os
import socket
import urllib.parse
from urllib.parse import urlparse

from app.core.exceptions import ValidationError

MAX_SCAN_PORTS = 1024


def allow_local_targets() -> bool:
    """Whether local/private scan targets are explicitly enabled."""
    return os.getenv("SPSX_ALLOW_LOCAL_SCAN_TARGETS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _check_address(address: str) -> None:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError as exc:
        raise ValidationError(f"Invalid scan target address: {address}") from exc
    if not allow_local_targets() and (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        raise ValidationError(f"Scanning address '{address}' is not allowed")


def _resolve(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValidationError(f"Cannot resolve scan target '{host}'") from exc
    for info in infos:
        _check_address(str(info[4][0]))


def normalize_target(target: str) -> str:
    """Normalize an IP/hostname/URL target to a bare host."""
    value = target.strip()
    if not value or len(value) > 253 or any(c.isspace() for c in value):
        raise ValidationError("Invalid scan target")

    if "://" in value:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"}:
            raise ValidationError("Only http and https targets are allowed")
        if parsed.username or parsed.password:
            raise ValidationError("Credentials in scan targets are not allowed")
        host = parsed.hostname
        if not host:
            raise ValidationError("Invalid scan target URL")
        _check_host(host)
        return host

    # Strip any path/port suffix from a bare host target.
    host = urllib.parse.urlsplit(f"//{value}").hostname
    if not host:
        raise ValidationError("Invalid scan target")
    _check_host(host)
    return host


def normalize_header_url(url: str) -> str:
    """Validate an HTTP(S) URL and pin it to an explicit scheme."""
    value = url.strip()
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValidationError("Invalid header-check URL")
    if parsed.username or parsed.password:
        raise ValidationError("Credentials in scan targets are not allowed")
    _check_host(parsed.hostname)
    return value


def _check_host(host: str) -> None:
    try:
        ipaddress.ip_address(host)
        _check_address(host)
        return
    except ValueError:
        pass
    if not host or len(host) > 253 or host.startswith("-"):
        raise ValidationError("Invalid scan target")
    if any(
        c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-" for c in host
    ):
        raise ValidationError("Invalid scan target")
    _resolve(host)


def validate_ports(ports: list[int] | None) -> list[int]:
    """Validate and de-duplicate a requested port list."""
    if ports is None:
        return []
    if not ports:
        raise ValidationError("At least one port is required")
    if len(ports) > MAX_SCAN_PORTS:
        raise ValidationError(f"At most {MAX_SCAN_PORTS} ports may be scanned at once")
    checked: list[int] = []
    for port in ports:
        if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
            raise ValidationError("Invalid port number")
        if port not in checked:
            checked.append(port)
    return checked
