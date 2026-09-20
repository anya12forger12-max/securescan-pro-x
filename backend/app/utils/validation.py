"""Input validation utilities for SecureScan Pro X."""

from __future__ import annotations

import ipaddress
import re
import urllib.parse
from typing import Any


VALID_HOSTNAME_PATTERN = re.compile(
    r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.?$"
)
VALID_ASSET_TYPES = {"host", "network", "web", "cloud", "container"}
VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}
VALID_FINDING_STATUSES = {"open", "confirmed", "mitigated", "accepted", "false_positive"}


def validate_hostname(hostname: str) -> bool:
    """Validate a hostname or IP address."""
    if not hostname or len(hostname) > 253:
        return False
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        pass
    return bool(VALID_HOSTNAME_PATTERN.match(hostname))


def validate_ip_address(ip: str) -> bool:
    """Validate an IPv4 or IPv6 address."""
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False


def validate_ip_network(network: str) -> bool:
    """Validate a CIDR network notation."""
    try:
        ipaddress.ip_network(network, strict=False)
        return True
    except ValueError:
        return False


def validate_url(url: str) -> bool:
    """Validate a URL."""
    try:
        result = urllib.parse.urlparse(url)
        return all([result.scheme in ("http", "https"), result.netloc])
    except (ValueError, AttributeError):
        return False


def validate_port(port: int) -> bool:
    """Validate a port number."""
    return 1 <= port <= 65535


def validate_port_range(start: int, end: int) -> bool:
    """Validate a port range."""
    return validate_port(start) and validate_port(end) and start <= end


def validate_cidr(cidr: str) -> bool:
    """Validate CIDR notation."""
    return validate_ip_network(cidr)


def validate_severity(severity: str) -> bool:
    """Validate a severity level."""
    return severity.lower() in VALID_SEVERITIES


def validate_asset_type(asset_type: str) -> bool:
    """Validate an asset type."""
    return asset_type.lower() in VALID_ASSET_TYPES


def sanitize_string(value: str, max_length: int = 1000) -> str:
    """Sanitize a string input."""
    value = value.strip()
    value = value[:max_length]
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    return value


def validate_scan_target(target: str) -> tuple[bool, str]:
    """Validate a scan target and return (is_valid, error_message)."""
    if not target or not target.strip():
        return False, "Target cannot be empty"

    target = target.strip()

    if validate_ip_address(target):
        return True, ""

    if validate_ip_network(target):
        return True, ""

    if validate_hostname(target):
        return True, ""

    if validate_url(target):
        return True, ""

    return False, f"Invalid target: {target}. Must be a valid IP, hostname, CIDR, or URL"


def parse_port_list(port_string: str) -> list[int]:
    """Parse a port list string like '80,443,8000-8100' into a list of ports."""
    ports: list[int] = []
    for part in port_string.split(","):
        part = part.strip()
        if "-" in part:
            range_parts = part.split("-", 1)
            try:
                start = int(range_parts[0].strip())
                end = int(range_parts[1].strip())
                if validate_port_range(start, end):
                    ports.extend(range(start, end + 1))
            except (ValueError, IndexError):
                continue
        else:
            try:
                port = int(part)
                if validate_port(port):
                    ports.append(port)
            except ValueError:
                continue
    return sorted(set(ports))


def validate_email(email: str) -> bool:
    """Validate an email address format."""
    pattern = re.compile(
        r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    )
    return bool(pattern.match(email))
