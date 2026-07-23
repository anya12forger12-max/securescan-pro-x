"""Plugin example — custom threat intelligence provider.

A lookup provider is any callable with the signature:
    (hashes: dict[str, str]) -> list[dict[str, Any]]

where *hashes* maps algorithm names to hex digests and the return
value is a list of matching threat records (empty list = no matches).

This example wraps an HTTP-based threat intelligence API behind that
interface.

Usage:
    python custom_provider.py
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from typing import Any


# ── Configuration ──────────────────────────────────────────────────

API_BASE_URL = os.environ.get(
    "MHC_TI_API_URL",
    "https://threat-intel.example.com/api/v1/hash/lookup",
)
API_KEY = os.environ.get("MHC_TI_API_KEY", "")
REQUEST_TIMEOUT = int(os.environ.get("MHC_TI_TIMEOUT", "10"))


# ── Provider implementation ───────────────────────────────────────

class ThreatIntelProvider:
    """Lookup provider that queries an external threat intelligence API.

    Parameters:
        base_url: The API endpoint for hash lookups.
        api_key: Bearer token for authentication.
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str = API_BASE_URL,
        api_key: str = API_KEY,
        timeout: int = REQUEST_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._cache: dict[str, list[dict[str, Any]]] = {}

    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
        """Look up *hashes* against the remote API.

        Results are cached in-memory to avoid redundant network calls
        within the same scan session.
        """
        all_records: list[dict[str, Any]] = []

        for algorithm, hex_digest in hashes.items():
            cache_key = f"{algorithm}:{hex_digest}"

            if cache_key in self._cache:
                all_records.extend(self._cache[cache_key])
                continue

            records = self._query_api(algorithm, hex_digest)
            self._cache[cache_key] = records
            all_records.extend(records)

        return all_records

    def _query_api(
        self, algorithm: str, hex_digest: str
    ) -> list[dict[str, Any]]:
        """Send a single lookup request to the API.

        Returns a list of matching record dicts. On any failure the
        error is logged and an empty list is returned so the pipeline
        can continue gracefully.
        """
        payload = json.dumps({
            "algorithm": algorithm,
            "hash": hex_digest,
        }).encode("utf-8")

        headers: dict[str, str] = {
            "Content-Type": "application/json",
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        request = urllib.request.Request(
            f"{self._base_url}",
            data=payload,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
            print(f"[ThreatIntelProvider] API error for {hex_digest}: {exc}")
            return []

        # Normalise the API response into MHCP record dicts.
        raw_records: list[dict[str, Any]] = body.get("results", [])
        return [self._normalise(r) for r in raw_records]

    @staticmethod
    def _normalise(raw: dict[str, Any]) -> dict[str, Any]:
        """Map external API fields to the MHCP record schema."""
        return {
            "hash_value": raw.get("hash", ""),
            "algorithm": raw.get("algorithm", ""),
            "source": raw.get("source", "threat_intel_api"),
            "threat_type": raw.get("threat_type", "unknown"),
            "severity": raw.get("severity", "medium"),
            "first_seen": raw.get("first_seen", ""),
            "last_seen": raw.get("last_seen", ""),
            "metadata": raw.get("tags", {}),
        }


# ── Demo with a mock provider ──────────────────────────────────────

class MockThreatIntelProvider:
    """In-memory mock that simulates the real provider for demonstration."""

    KNOWN_HASHES: dict[str, dict[str, Any]] = {
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855": {
            "threat_type": "trojan",
            "severity": "high",
            "source": "mock_db",
        },
    }

    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for algo, digest in hashes.items():
            if digest in self.KNOWN_HASHES:
                match = self.KNOWN_HASHES[digest].copy()
                match["hash_value"] = digest
                match["algorithm"] = algo
                records.append(match)
        return records


def main() -> None:
    print("=== Threat Intelligence Provider Example ===\n")

    # Use the mock for the demo so no network access is required.
    provider = MockThreatIntelProvider()

    # Simulate hashes coming from a scan pipeline.
    sha256_of_empty = hashlib.sha256(b"").hexdigest()
    scan_hashes = {"sha256": sha256_of_empty}

    print(f"Looking up SHA-256: {sha256_of_empty[:32]}...")
    records = provider(scan_hashes)

    if records:
        print(f"Found {len(records)} matching record(s):")
        for rec in records:
            print(f"  Threat type : {rec['threat_type']}")
            print(f"  Severity    : {rec['severity']}")
            print(f"  Source      : {rec['source']}")
    else:
        print("No matching records found.")

    # Demonstrate caching.
    print("\nSecond lookup (should hit cache):")
    records_again = provider(scan_hashes)
    print(f"  Returned {len(records_again)} record(s)")

    # Show how the provider plugs into the pipeline.
    print("\n--- Integration with ScanPipeline ---")
    print(
        "  from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline\n"
        "  provider = ThreatIntelProvider(base_url='...', api_key='...')\n"
        "  pipeline = ScanPipeline(config=PipelineConfig(), lookup_fn=provider)\n"
        "  result = pipeline.scan_file('suspicious.bin')"
    )


if __name__ == "__main__":
    main()
