"""Plugin example — custom hash algorithm.

Demonstrates how to extend MHCP with a custom hash algorithm by:
1. Subclassing `HashComputer` to provide the computation backend.
2. Registering the algorithm at runtime via `HashAlgorithm.register()`.

Usage:
    python custom_hash_algorithm.py
"""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path
from typing import Any

from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_hashing.computer import HashComputer


# ── 1. Define a custom algorithm ──────────────────────────────────

class HMACAlgorithm:
    """Container for a custom HMAC-based hash algorithm.

    This is a simplified example — real deployments would use a
    proper key management strategy.
    """

    def __init__(self, name: str, digest_size: int, key: bytes) -> None:
        self.name = name
        self.digest_size = digest_size
        self.hex_digest_length = digest_size * 2
        self._key = key

    def compute(self, data: bytes) -> str:
        """Compute HMAC hex digest of *data*."""
        return hmac.new(self._key, data, self.name).hexdigest()


# Pre-configured custom algorithm.
CUSTOM_HMAC = HMACAlgorithm(
    name="sha256",
    digest_size=32,
    key=b"mhcp-custom-plugin-key-2024",
)


# ── 2. Subclass HashComputer ──────────────────────────────────────

class HMACHashComputer(HashComputer):
    """HashComputer subclass that computes HMAC-SHA-256 digests.

    This follows the same interface as the built-in ``HashBackend``
    but uses a symmetric key to produce keyed hashes.
    """

    def __init__(self, key: bytes, *, chunk_size: int = 8192) -> None:
        super().__init__(algorithm=HashAlgorithm.SHA256, chunk_size=chunk_size)
        self._key = key

    def compute_bytes(self, data: bytes) -> str:
        """Compute HMAC-SHA-256 of in-memory bytes."""
        return hmac.new(self._key, data, "sha256").hexdigest()

    def compute_file(self, file_path: Path | str) -> str:
        """Compute HMAC-SHA-256 of a file, reading in chunks."""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        mac = hmac.new(self._key, digestmod="sha256")
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(self.chunk_size)
                if not chunk:
                    break
                mac.update(chunk)
        return mac.hexdigest()


# ── 3. Runtime algorithm registration ─────────────────────────────

def _register_custom_algorithm() -> None:
    """Add HMAC-SHA-256 as a recognised algorithm at runtime.

    Because ``HashAlgorithm`` is a frozen enum, we use the helper
    ``HashAlgorithm.register()`` which creates a new member dynamically.
    In practice you would call this once at startup before any lookups.
    """
    try:
        HashAlgorithm.register(
            "HMAC-SHA256",
            value="hmac_sha256",
        )
    except (AttributeError, TypeError):
        # Older Python or if register is not available, skip.
        pass


# ── 4. Demonstration ──────────────────────────────────────────────

def main() -> None:
    print("=== Custom Hash Algorithm Plugin ===\n")

    # Direct usage without registering in the enum.
    computer = HMACHashComputer(key=CUSTOM_HMAC._key)

    data = b"Hello, Malware Hash Checker Pro!"
    digest = computer.compute_bytes(data)
    print(f"Data       : {data.decode()}")
    print(f"HMAC-SHA256: {digest}")
    print(f"Length     : {len(digest)} hex chars (expected {computer.algorithm.hex_digest_length})")
    print()

    # Compare with standard SHA-256 (no key).
    std_backend_hash = hashlib.sha256(data).hexdigest()
    print(f"Standard SHA-256 (no key): {std_backend_hash}")
    print(f"HMAC-SHA-256 (with key)  : {digest}")
    print(f"Results differ           : {digest != std_backend_hash}")
    print()

    # File hashing demo.
    print("--- File hashing ---")
    import tempfile

    with tempfile.NamedTemporaryFile(delete=False, suffix=".bin") as tmp:
        tmp.write(b"\x00" * 4096)
        tmp_path = Path(tmp.name)

    file_digest = computer.compute_file(tmp_path)
    print(f"File path  : {tmp_path}")
    print(f"File HMAC  : {file_digest}")

    tmp_path.unlink()
    print()

    # Show how a custom algorithm integrates with the pipeline.
    print("--- Pipeline integration ---")
    print(
        "  # Register at startup:\n"
        "  _register_custom_algorithm()\n"
        "\n"
        "  # Then use HMACHashComputer alongside standard backends:\n"
        "  from mhcp_scanner.engine.backend import HashBackend\n"
        "\n"
        "  standard = HashBackend(HashAlgorithm.SHA256)\n"
        "  hmac_comp = HMACHashComputer(key=b'secret')\n"
        "\n"
        "  standard_digest = standard.compute_file('malware.bin')\n"
        "  hmac_digest = hmac_comp.compute_file('malware.bin')\n"
        "\n"
        "  # Use both in a composite lookup:\n"
        "  hashes = {'sha256': standard_digest, 'hmac_sha256': hmac_digest}\n"
        "  records = lookup_fn(hashes)"
    )


if __name__ == "__main__":
    main()
