"""Shared utilities for SecureScan Pro X."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any


def generate_id() -> str:
    """Generate a new UUID.

    Returns:
        UUID4 string.
    """
    return str(uuid.uuid4())


def utc_now() -> datetime:
    """Get current UTC datetime.

    Returns:
        Current datetime in UTC.
    """
    return datetime.now(timezone.utc)


def sanitize_filename(name: str) -> str:
    """Sanitize a string for use as a filename.

    Args:
        name: Original filename.

    Returns:
        Sanitized filename safe for all platforms.
    """
    # Remove invalid characters
    sanitized = re.sub(r'[<>:"/\\|?*]', "_", name)
    # Remove leading/trailing whitespace and dots
    sanitized = sanitized.strip(". ")
    # Truncate to 255 characters
    return sanitized[:255] if sanitized else "unnamed"


def hash_content(content: str | bytes) -> str:
    """Generate SHA-256 hash of content.

    Args:
        content: String or bytes to hash.

    Returns:
        Hex-encoded SHA-256 hash.
    """
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()


def truncate_string(s: str, max_length: int = 100, suffix: str = "...") -> str:
    """Truncate a string to a maximum length.

    Args:
        s: String to truncate.
        max_length: Maximum length including suffix.
        suffix: Suffix to append when truncated.

    Returns:
        Truncated string.
    """
    if len(s) <= max_length:
        return s
    return s[: max_length - len(suffix)] + suffix


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Deep merge two dictionaries. Override values take precedence.

    Args:
        base: Base dictionary.
        override: Override dictionary.

    Returns:
        Merged dictionary.
    """
    result = dict(base)
    for key, value in override.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result
