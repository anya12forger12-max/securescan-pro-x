# Plugin Development Guide

Extending Malware Hash Checker Pro with custom providers, hash algorithms, and verdict generators.

## Table of Contents

- [Plugin Architecture](#plugin-architecture)
- [Creating a Custom Provider](#creating-a-custom-provider)
- [Creating a Custom Hash Algorithm](#creating-a-custom-hash-algorithm)
- [Plugin Manifest](#plugin-manifest)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Testing Plugins](#testing-plugins)
- [Publishing Plugins](#publishing-plugins)

---

## Plugin Architecture

MHCP supports extensibility through three primary plugin points:

1. **Lookup Providers** — Custom callables that query external threat intelligence sources.
2. **Hash Algorithms** — Custom hash computation backends.
3. **Verdict Generators** — Custom verdict logic via subclassing.

### Plugin Interface

Plugins are not a formal framework with registration. Instead, MHCP uses **protocol-based** extensibility:

- A **lookup provider** is any callable matching the signature `(hashes: dict[str, str]) -> list[dict[str, Any]]`.
- A **hash computer** subclasses `HashComputer` and overrides `compute_bytes` and `compute_file`.
- A **verdict generator** subclasses `VerdictGenerator` and overrides `generate`.

### Where Plugins Are Used

```
ScanPipeline
├── config (PipelineConfig.algorithms)
├── lookup_fn (custom provider callable)
├── cancellation_handler (CancellationHandler)
├── progress_tracker (ProgressTracker)
└── verdict (VerdictGenerator.generate)
```

---

## Creating a Custom Provider

A lookup provider queries external threat intelligence sources and returns matching records.

### Provider Signature

```python
from typing import Any

def my_provider(hashes: dict[str, str]) -> list[dict[str, Any]]:
    """Look up hashes against a threat intelligence source.

    Args:
        hashes: Mapping of algorithm name to hex digest.
            Example: {"sha256": "a1b2c3...", "md5": "d4e5f6..."}

    Returns:
        List of matching threat record dicts. Each dict should contain:
        - hash_value: str
        - algorithm: str
        - source: str
        - threat_type: str (e.g., "trojan", "ransomware", "clean")
        - severity: str (e.g., "critical", "high", "medium", "low")
        - first_seen: str (ISO 8601)
        - last_seen: str (ISO 8601)
        - metadata: dict[str, Any]
    """
    ...
```

### Example: HTTP API Provider

```python
"""Custom threat intelligence provider wrapping an HTTP API."""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any


class ThreatIntelProvider:
    """Lookup provider that queries an external threat intelligence API.

    Parameters:
        base_url: The API endpoint for hash lookups.
        api_key: Bearer token for authentication.
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str = "https://threat-intel.example.com/api/v1/hash/lookup",
        api_key: str = "",
        timeout: int = 10,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._cache: dict[str, list[dict[str, Any]]] = {}

    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
        """Look up hashes against the remote API.

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
            self._base_url,
            data=payload,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, json.JSON.JSONDecodeError):
            return []

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
```

### Example: Mock Provider for Testing

```python
class MockThreatIntelProvider:
    """In-memory mock that simulates a real provider for testing."""

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
```

### Integrating a Provider

```python
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline

provider = ThreatIntelProvider(
    base_url="https://threat-intel.example.com/api/v1/hash/lookup",
    api_key="your-api-key",
)

pipeline = ScanPipeline(
    config=PipelineConfig(algorithms=["sha256", "md5"]),
    lookup_fn=provider,
)

result = pipeline.scan_file(Path("/path/to/suspect.bin"))
```

---

## Creating a Custom Hash Algorithm

### Step 1: Subclass HashComputer

```python
"""Custom HMAC-based hash algorithm plugin."""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_hashing.computer import HashComputer


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
```

### Step 2: Register at Runtime (Optional)

If the algorithm should be available through `HashAlgorithm.from_string()`, register it:

```python
def _register_custom_algorithm() -> None:
    """Add HMAC-SHA-256 as a recognised algorithm at runtime."""
    try:
        HashAlgorithm.register(
            "HMAC-SHA256",
            value="hmac_sha256",
        )
    except (AttributeError, TypeError):
        pass  # Older Python or register not available
```

### Step 3: Use in Pipeline

```python
# Standard hash computation
from mhcp_scanner.engine.backend import HashBackend

standard = HashBackend(HashAlgorithm.SHA256)
standard_digest = standard.compute_file("malware.bin")

# Custom hash computation
hmac_comp = HMACHashComputer(key=b"secret-key")
hmac_digest = hmac_comp.compute_file("malware.bin")

# Composite lookup
hashes = {
    "sha256": standard_digest,
    "hmac_sha256": hmac_digest,
}
records = lookup_fn(hashes)
```

---

## Plugin Manifest

While MHCP does not currently use a formal plugin manifest format, plugins should document the following information in their module docstring or README:

```python
"""Custom Threat Intelligence Provider Plugin for MHCP.

Plugin Name: VirusTotal Provider
Version: 1.0.0
Author: Your Name
License: MIT

Dependencies:
    - mhcp-core >= 0.1.0
    - mhcp-scanner >= 0.1.0

Provides:
    - ThreatIntelProvider: Lookup callable for VirusTotal API
    - MockThreatIntelProvider: Test mock

Usage:
    provider = ThreatIntelProvider(api_key="your-key")
    pipeline = ScanPipeline(config=PipelineConfig(), lookup_fn=provider)
"""
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| Plugin Name | Yes | Human-readable name |
| Version | Yes | Semantic version |
| Author | Yes | Plugin author |
| License | Yes | License identifier |
| Dependencies | Yes | Required MHCP packages |
| Provides | Yes | What the plugin provides |
| Usage | Yes | Basic usage example |

---

## Lifecycle Hooks

MHCP's plugin system is callback-based rather than lifecycle-based. Plugins are invoked at specific points in the scan pipeline:

### Pipeline Stages

```
1. VALIDATE    → File path and permissions check
2. HASH        → HashBackend.compute_file_multi()
3. LOOKUP      → lookup_fn(hashes) — YOUR PLUGIN RUNS HERE
4. VERDICT     → VerdictGenerator.generate(lookup_results)
5. COMPLETE    → Results aggregation
```

### Hook Points

| Stage | Hook | Signature |
|-------|------|-----------|
| Pre-scan | `PipelineConfig` | Configure algorithms, options |
| Hash computation | `HashBackend.compute_file` | File → hashes |
| Lookup | `lookup_fn` | `dict[str, str]` → `list[dict]` |
| Verdict | `VerdictGenerator.generate` | lookup_results → Verdict |
| Progress | `ProgressTracker.add_listener` | `ProgressUpdate` → None |
| Cancellation | `CancellationHandler.add_callback` | `() → None` |

### Custom Verdict Lifecycle

To add custom verdict logic, subclass `VerdictGenerator`:

```python
from mhcp_scanner.engine.verdict import VerdictGenerator, Verdict, VerdictType


class ExtendedVerdictGenerator(VerdictGenerator):
    """VerdictGenerator subclass that adds heuristic and policy verdicts."""

    def generate(
        self,
        *,
        lookup_results: list[dict[str, Any]] | None = None,
        file_metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Verdict:
        """Generate a verdict, falling through to heuristics when unknown."""
        base_verdict = super().generate(
            lookup_results=lookup_results or [],
            **kwargs,
        )

        if base_verdict.verdict_type is not VerdictType.UNKNOWN:
            return base_verdict

        if file_metadata is None:
            return base_verdict

        # Apply custom heuristic checks
        heuristic_verdict = self._check_heuristics(file_metadata)
        if heuristic_verdict is not None:
            return heuristic_verdict

        return base_verdict

    def _check_heuristics(
        self, metadata: dict[str, Any]
    ) -> Verdict | None:
        """Return a custom verdict when heuristics fire."""
        # Your heuristic logic here
        ...
```

---

## Testing Plugins

### Unit Testing a Provider

```python
"""Tests for the custom ThreatIntelProvider plugin."""

from __future__ import annotations

import pytest

from .custom_provider import MockThreatIntelProvider, ThreatIntelProvider


class TestMockProvider:
    """Tests for the mock provider."""

    def test_known_hash_returns_match(self) -> None:
        """Known hash returns a matching record."""
        provider = MockThreatIntelProvider()
        sha256_empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        records = provider({"sha256": sha256_empty})
        assert len(records) == 1
        assert records[0]["threat_type"] == "trojan"

    def test_unknown_hash_returns_empty(self) -> None:
        """Unknown hash returns an empty list."""
        provider = MockThreatIntelProvider()
        records = provider({"sha256": "a" * 64})
        assert len(records) == 0

    def test_empty_input_returns_empty(self) -> None:
        """Empty hash dict returns an empty list."""
        provider = MockThreatIntelProvider()
        records = provider({})
        assert len(records) == 0
```

### Unit Testing a Hash Computer

```python
"""Tests for the HMAC hash computer plugin."""

from __future__ import annotations

from pathlib import Path

import pytest

from .custom_hash_algorithm import HMACHashComputer


class TestHMACHashComputer:
    """Tests for HMACHashComputer."""

    def test_compute_bytes(self) -> None:
        """compute_bytes produces a valid hex digest."""
        computer = HMACHashComputer(key=b"test-key")
        result = computer.compute_bytes(b"hello world")
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_compute_file(self, tmp_path: Path) -> None:
        """compute_file produces the same result as compute_bytes."""
        computer = HMACHashComputer(key=b"test-key")
        test_file = tmp_path / "test.bin"
        test_file.write_bytes(b"hello world")

        file_result = computer.compute_file(test_file)
        bytes_result = computer.compute_bytes(b"hello world")
        assert file_result == bytes_result

    def test_deterministic(self) -> None:
        """Same input always produces the same output."""
        computer = HMACHashComputer(key=b"test-key")
        first = computer.compute_bytes(b"deterministic")
        second = computer.compute_bytes(b"deterministic")
        assert first == second

    def test_different_keys_different_results(self) -> None:
        """Different keys produce different results."""
        comp_a = HMACHashComputer(key=b"key-a")
        comp_b = HMACHashComputer(key=b"key-b")
        result_a = comp_a.compute_bytes(b"hello")
        result_b = comp_b.compute_bytes(b"hello")
        assert result_a != result_b

    def test_compute_file_not_found(self, tmp_path: Path) -> None:
        """compute_file raises FileNotFoundError for missing files."""
        computer = HMACHashComputer(key=b"test-key")
        with pytest.raises(FileNotFoundError):
            computer.compute_file(tmp_path / "nonexistent.bin")
```

### Integration Testing with Pipeline

```python
"""Integration tests for plugin provider with the scan pipeline."""

from __future__ import annotations

from pathlib import Path

import pytest

from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline
from .custom_provider import MockThreatIntelProvider


class TestProviderPipelineIntegration:
    """Verify provider works with ScanPipeline."""

    def test_pipeline_with_provider(self, sample_file: Path) -> None:
        """Pipeline uses the provider for lookups."""
        provider = MockThreatIntelProvider()
        pipeline = ScanPipeline(
            config=PipelineConfig(),
            lookup_fn=provider,
        )
        result = pipeline.scan_file(sample_file)
        assert "verdict" in result or "verdict_type" in result
```

---

## Publishing Plugins

### Package Structure

Organize your plugin as a standard Python package:

```
mhcp-plugin-myprovider/
├── pyproject.toml
├── README.md
├── LICENSE
├── src/
│   └── mhcp_plugin_myprovider/
│       ├── __init__.py
│       ├── provider.py
│       └── tests/
│           ├── __init__.py
│           └── test_provider.py
└── examples/
    └── usage.py
```

### pyproject.toml

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mhcp-plugin-myprovider"
version = "1.0.0"
description = "Custom threat intelligence provider for MHCP"
requires-python = ">=3.13"
license = "MIT"
dependencies = [
    "mhcp-core>=0.1.0",
    "mhcp-scanner>=0.1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]
```

### README.md

Document:
1. What the plugin does
2. Installation instructions
3. Configuration options
4. Usage examples
5. API reference
6. Testing instructions

### Versioning

Follow semantic versioning:
- **MAJOR** — Breaking changes to the plugin API
- **MINOR** — New features, backward-compatible
- **PATCH** — Bug fixes, backward-compatible

### Distribution

```bash
# Build
python -m build

# Upload to PyPI
twine upload dist/*
```

### Installation by Users

```bash
pip install mhcp-plugin-myprovider
```

### Integration

```python
from mhcp_plugin_myprovider import ThreatIntelProvider
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline

provider = ThreatIntelProvider(api_key="...")
pipeline = ScanPipeline(
    config=PipelineConfig(),
    lookup_fn=provider,
)
```
