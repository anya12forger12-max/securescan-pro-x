"""Cryptographic utilities for SecureScan Pro X."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import os
import secrets
import string
import struct
import time
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.core.config import settings


def generate_api_key(length: int = 48) -> str:
    """Generate a secure API key."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_secret_key() -> str:
    """Generate a Fernet-compatible secret key."""
    return Fernet.generate_key().decode()


def derive_key_from_password(password: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    """Derive a Fernet key from a password using PBKDF2."""
    if salt is None:
        salt = secrets.token_bytes(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    return key, salt


def compute_hash(data: bytes, algorithm: str = "sha256") -> str:
    """Compute a hash of the given data."""
    h = hashlib.new(algorithm)
    h.update(data)
    return h.hexdigest()


def compute_file_hash(file_path: str, algorithm: str = "sha256") -> str:
    """Compute a hash of a file."""
    h = hashlib.new(algorithm)
    with Path(file_path).open("rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def constant_time_compare(a: str, b: str) -> bool:
    """Constant-time string comparison to prevent timing attacks."""
    return secrets.compare_digest(a.encode(), b.encode())


def _totp_code(key: bytes, counter: int) -> str:
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verify a 6-digit RFC 6238 TOTP code with a small clock drift window."""
    normalized = code.strip()
    if len(normalized) != 6 or not normalized.isdigit():
        return False

    encoded = secret.strip().replace(" ", "").upper()
    try:
        padded = encoded + "=" * ((8 - len(encoded) % 8) % 8)
        key = base64.b32decode(padded, casefold=True)
    except (ValueError, TypeError):
        return False

    counter = int(time.time()) // 30
    for offset in range(-window, window + 1):
        if hmac.compare_digest(_totp_code(key, counter + offset), normalized):
            return True
    return False


class TokenManager:
    """Manages encryption tokens for data at rest.

    The key is resolved from an explicit argument, the SECURESCAN_TOKEN_KEY
    environment variable, or a persistent 0600 key file under the configured
    data directory. Persisting the key keeps data from earlier runs readable
    after a restart.
    """

    def __init__(
        self,
        key: str | None = None,
        key_path: str | Path | None = None,
    ) -> None:
        if key is None:
            key = os.environ.get("SECURESCAN_TOKEN_KEY")
        if key is None:
            path = Path(key_path).expanduser() if key_path else settings.data_dir / ".token_key"
            if path.exists():
                key = path.read_text(encoding="utf-8").strip()
            else:
                key = generate_secret_key()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(key, encoding="utf-8")
                with contextlib.suppress(OSError):
                    path.chmod(0o600)
        self._key = key
        self._fernet = Fernet(self._key.encode() if isinstance(self._key, str) else self._key)

    def encrypt(self, data: str) -> str:
        """Encrypt a string."""
        return self._fernet.encrypt(data.encode()).decode()

    def decrypt(self, token: str) -> str:
        """Decrypt a token."""
        return self._fernet.decrypt(token.encode()).decode()

    def encrypt_dict(self, data: dict[str, Any]) -> str:
        """Encrypt a dictionary as JSON."""
        import json

        return self.encrypt(json.dumps(data))

    def decrypt_dict(self, token: str) -> dict[str, Any]:
        """Decrypt a token to a dictionary."""
        import json
        import typing

        result = json.loads(self.decrypt(token))
        if not isinstance(result, dict):
            raise ValueError("Decrypted payload is not a dict")
        return typing.cast("dict[str, Any]", result)
