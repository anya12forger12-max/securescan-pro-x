"""Cryptographic utilities for SecureScan Pro X."""

from __future__ import annotations

import hashlib
import secrets
import string
from typing import Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64


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
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def constant_time_compare(a: str, b: str) -> bool:
    """Constant-time string comparison to prevent timing attacks."""
    return secrets.compare_digest(a.encode(), b.encode())


class TokenManager:
    """Manages encryption tokens for data at rest."""

    def __init__(self, key: str | None = None) -> None:
        self._key = key or generate_secret_key()
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
        return json.loads(self.decrypt(token))
