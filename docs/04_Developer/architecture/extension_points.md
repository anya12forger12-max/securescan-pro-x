# Extension Points

> How to extend MHCP with custom algorithms, verdicts, providers, and plugins.

---

## 1. Custom Hash Algorithms

MHCP supports plugging in custom hash algorithms at runtime. Any callable or object that conforms to the `HashComputer` interface can be used.

### Interface Contract

```python
class HashComputer(ABC):
    """Base class for hash computation backends."""

    def __init__(self, algorithm: HashAlgorithm, chunk_size: int = 8192) -> None: ...

    @abstractmethod
    def compute_bytes(self, data: bytes) -> str:
        """Compute hex digest of in-memory bytes."""
        ...

    @abstractmethod
    def compute_file(self, file_path: Path | str) -> str:
        """Compute hex digest of a file (streaming)."""
        ...
```

### Implementation Guide

1. Subclass `HashComputer`:

```python
from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_hashing.computer import HashComputer

class BLAKE3HashComputer(HashComputer):
    def __init__(self, *, chunk_size: int = 8192) -> None:
        super().__init__(algorithm=HashAlgorithm.SHA256, chunk_size=chunk_size)
        # Store custom algorithm reference

    def compute_bytes(self, data: bytes) -> str:
        import blake3
        return blake3.blake3(data).hexdigest()

    def compute_file(self, file_path: Path | str) -> str:
        import blake3
        path = Path(file_path)
        h = blake3.blake3()
        with open(path, "rb") as f:
            while chunk := f.read(self.chunk_size):
                h.update(chunk)
        return h.hexdigest()
```

2. Register as a runtime algorithm (optional):

```python
HashAlgorithm.register("BLAKE3", value="blake3")
```

3. Use in the pipeline:

```python
pipeline = ScanPipeline(
    config=PipelineConfig(algorithms=["sha256", "blake3"]),
    custom_backends={"blake3": BLAKE3HashComputer()},
)
```

### Constraints

- The `compute_file` method must return a lowercase hex string.
- The hex string length must match the algorithm's `hex_digest_length` property.
- The implementation must be thread-safe if used with the `Scheduler`.

---

## 2. Custom Verdict Logic

The `VerdictGenerator` can be subclassed to add heuristic, policy, or organizational rules.

### Interface Contract

```python
class VerdictGenerator:
    def generate(
        self,
        *,
        lookup_results: list[dict[str, Any]] | None = None,
        file_metadata: dict[str, Any] | None = None,
        database_error: str | None = None,
        scan_error: str | None = None,
        cancelled: bool = False,
    ) -> Verdict:
        ...
```

### Implementation Guide

```python
from mhcp_scanner.engine.verdict import VerdictGenerator, Verdict, VerdictType, VerdictEvidence

class ComplianceVerdictGenerator(VerdictGenerator):
    """Adds regulatory compliance checks to the verdict."""

    def __init__(self, blocked_hashes: set[str] | None = None) -> None:
        super().__init__()
        self._blocked_hashes = blocked_hashes or set()

    def generate(self, **kwargs) -> Verdict:
        # Get the base verdict from the parent
        base_verdict = super().generate(**kwargs)

        # If already definitive, return as-is
        if base_verdict.verdict_type is not VerdictType.UNKNOWN:
            return base_verdict

        # Add compliance-specific logic
        lookup_results = kwargs.get("lookup_results") or []
        for record in lookup_results:
            if record.get("hash_value") in self._blocked_hashes:
                return Verdict(
                    verdict_type=VerdictType.KNOWN_MALICIOUS,
                    evidence=VerdictEvidence(matched_records=[record]),
                    limitations=["Blocked by organizational compliance policy"],
                )

        return base_verdict
```

### Injecting Custom Verdict Generator

```python
pipeline = ScanPipeline(
    config=PipelineConfig(),
    verdict_generator=ComplianceVerdictGenerator(
        blocked_hashes={"abc123...", "def456..."}
    ),
)
```

### Custom Verdict Types

Extend the verdict system with new verdict types:

```python
from enum import Enum

class ExtendedVerdictType(Enum):
    KNOWN_MALICIOUS = "known_malicious"
    UNKNOWN = "unknown"
    CLEAN = "clean"
    SUSPICIOUS = "suspicious"       # Custom
    POLICY_BLOCK = "policy_block"   # Custom
    QUARANTINED = "quarantined"     # Custom
```

### Constraints

- Custom verdict generators must call `super().generate()` first to get the base verdict.
- The returned `Verdict` must have a valid `verdict_type` and non-null `evidence` for `KNOWN_MALICIOUS`.
- `limitations` must be a non-empty list for `UNKNOWN` verdicts.

---

## 3. Custom Providers (Threat Intelligence)

Any callable matching the provider signature can be used as a lookup backend.

### Provider Signature

```python
Callable[[dict[str, str]], list[dict[str, Any]]]
```

Where:
- **Input:** `dict[str, str]` maps algorithm names to hex digests (e.g., `{"sha256": "abc..."}`)
- **Output:** `list[dict[str, Any]]` of matching threat records

### Record Schema

```python
{
    "hash_value": str,        # The matched hash
    "algorithm": str,         # Algorithm used for the match
    "source": str,            # Data source (e.g., "virustotal", "abuse.ch")
    "threat_type": str,       # Classification (e.g., "trojan", "ransomware")
    "severity": str,          # Severity level (e.g., "critical", "high", "low")
    "first_seen": str,        # ISO 8601 timestamp
    "last_seen": str,         # ISO 8601 timestamp
    "metadata": dict[str, Any],  # Additional context
}
```

### Implementation Guide

```python
import urllib.request
import json
from typing import Any

class OTXProvider:
    """AlienVault OTX threat intelligence provider."""

    def __init__(self, api_key: str, timeout: int = 10) -> None:
        self._api_key = api_key
        self._timeout = timeout
        self._cache: dict[str, list[dict[str, Any]]] = {}

    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
        results = []
        for algo, digest in hashes.items():
            cache_key = f"{algo}:{digest}"
            if cache_key in self._cache:
                results.extend(self._cache[cache_key])
                continue

            records = self._query(digest)
            self._cache[cache_key] = records
            results.extend(records)
        return results

    def _query(self, digest: str) -> list[dict[str, Any]]:
        url = f"https://otx.alienvault.com/api/v1/indicators/file/{digest}/general"
        req = urllib.request.Request(url, headers={"X-OTX-API-KEY": self._api_key})
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read())
            return [self._normalise(r) for r in data.get("results", [])]
        except Exception:
            return []

    def _normalise(self, raw: dict) -> dict[str, Any]:
        return {
            "hash_value": raw.get("hash", ""),
            "algorithm": "sha256",
            "source": "otx",
            "threat_type": raw.get("threat_type", "unknown"),
            "severity": raw.get("severity", "medium"),
            "first_seen": raw.get("first_seen", ""),
            "last_seen": raw.get("last_seen", ""),
            "metadata": raw.get("tags", {}),
        }
```

### Using a Custom Provider

```python
provider = OTXProvider(api_key="your-key-here")
pipeline = ScanPipeline(
    config=PipelineConfig(),
    lookup_fn=provider,
)
result = pipeline.scan_file("/path/to/suspect.bin")
```

### Chaining Multiple Providers

```python
def chained_lookup(providers):
    def lookup(hashes):
        all_records = []
        for provider in providers:
            all_records.extend(provider(hashes))
        return all_records
    return lookup

pipeline = ScanPipeline(
    config=PipelineConfig(),
    lookup_fn=chained_lookup([
        OTXProvider(api_key="..."),
        VirusTotalProvider(api_key="..."),
        LocalCacheProvider(),
    ]),
)
```

### Constraints

- Providers must return an empty list on failure (never raise exceptions that break the pipeline).
- Providers should implement in-memory caching to avoid redundant lookups within a session.
- Providers must not modify the input `hashes` dict.
- Thread safety is required if used with the `Scheduler`.

---

## 4. Plugin System

MHCP supports a plugin architecture for registering custom components at startup.

### Plugin Registration Points

| Point | Interface | Description |
|---|---|---|
| Hash Algorithm | `HashComputer` subclass | Custom hash computation |
| Verdict Generator | `VerdictGenerator` subclass | Custom verdict logic |
| Lookup Provider | `Callable[[dict[str,str]], list[dict]]` | External threat intel |
| Report Renderer | `ReportGenerator` subclass | Custom output formats |
| Config Validator | `Callable[[dict], list[str]]` | Custom config validation |

### Plugin Loading Flow

```
Application startup
        |
        v
+-------------------------------------------+
|  1. Load built-in defaults                |
|  2. Scan plugin directories:              |
|     - ~/.config/mhcp/plugins/             |
|     - /etc/mhcp/plugins/                  |
|     - <app_dir>/plugins/                  |
|  3. For each plugin manifest:             |
|     - Parse plugin.toml                   |
|     - Validate dependencies               |
|     - Import module                       |
|  4. Register plugin components:           |
|     - Hash algorithms                     |
|     - Verdict generators                  |
|     - Lookup providers                    |
|     - Report renderers                    |
|  5. Apply plugin configuration           |
+-------------------------------------------+
```

### Plugin Manifest Format

```toml
# plugin.toml
[plugin]
name = "custom-antivirus"
version = "1.0.0"
author = "Security Team"
description = "Custom antivirus hash provider"

[plugin.entry]
module = "custom_antivirus.plugin"
class = "AntivirusPlugin"

[plugin.permissions]
network = true
filesystem_read = true
```

### Plugin API

```python
class Plugin:
    """Base class for MHCP plugins."""

    def on_load(self, config: dict) -> None:
        """Called when the plugin is loaded."""
        ...

    def on_unload(self) -> None:
        """Called when the plugin is unloaded."""
        ...

    def register_hash_algorithm(self, name: str, computer: HashComputer) -> None:
        """Register a custom hash algorithm."""
        HashAlgorithm.register(name)
        ...

    def register_verdict_generator(self, generator: VerdictGenerator) -> None:
        """Register a custom verdict generator."""
        ...

    def register_lookup_provider(self, provider: Callable) -> None:
        """Register a custom lookup provider."""
        ...
```

---

## 5. Hook System

MHCP provides hooks for intercepting pipeline events without subclassing.

### Available Hooks

| Hook | Trigger Point | Callback Signature |
|---|---|---|
| `on_scan_start` | Before pipeline begins | `(file_path: Path) -> None` |
| `on_hash_computed` | After hash stage completes | `(hashes: dict[str, str]) -> None` |
| `on_lookup_complete` | After lookup stage completes | `(records: list[dict]) -> None` |
| `on_verdict_generated` | After verdict stage completes | `(verdict: Verdict) -> None` |
| `on_scan_complete` | After cleanup stage | `(session: ScanSession) -> None` |
| `on_scan_error` | On any pipeline error | `(error: MHCError) -> None` |
| `on_state_transition` | On state machine transition | `(from: ScanState, to: ScanState) -> None` |
| `on_progress_update` | On progress tracker update | `(update: ProgressUpdate) -> None` |

### Hook Registration

```python
from mhcp_scanner.engine.pipeline import ScanPipeline, PipelineConfig

pipeline = ScanPipeline(config=PipelineConfig())

# Register hooks
pipeline.on_hash_computed(lambda hashes: print(f"Hashes: {list(hashes.keys())}"))
pipeline.on_verdict_generated(lambda v: print(f"Verdict: {v.verdict_type}"))
pipeline.on_scan_error(lambda e: log.error(f"Error: {e.message}"))

result = pipeline.scan_file("/path/to/file.bin")
```

### Hook Ordering

Hooks are executed in registration order. Multiple hooks for the same event are all invoked sequentially. Hooks may not modify the data flowing through the pipeline — they are observation-only.

### Removing Hooks

```python
def my_handler(verdict):
    print(f"Got verdict: {verdict.verdict_type}")

pipeline.on_verdict_generated(my_handler)
# ... later ...
pipeline.remove_hook("on_verdict_generated", my_handler)
```

---

## 6. Custom Report Formats

Add new output formats by subclassing the report generator.

### Implementation Guide

```python
from mhcp_reports.lib.src.formats import OutputFormat

class MarkdownReportGenerator:
    """Generate Markdown-formatted scan reports."""

    def generate(self, results: list[dict], title: str = "Scan Report") -> bytes:
        lines = [f"# {title}\n"]
        lines.append(f"**Generated:** {datetime.now(timezone.utc).isoformat()}\n")
        lines.append(f"**Files scanned:** {len(results)}\n\n")

        lines.append("| File | Verdict | Severity |")
        lines.append("|------|---------|----------|")
        for r in results:
            lines.append(
                f"| {r['file_path']} | {r['verdict']} | {r['severity']} |"
            )

        return "\n".join(lines).encode("utf-8")
```

Register the custom format:

```python
from mhcp_reports.lib.src.formats import OutputFormat
OutputFormat.register("MARKDOWN", value="markdown", file_extension=".md", mime_type="text/markdown")
```

---

## 7. Extension Point Summary

| Extension Point | Mechanism | Difficulty |
|---|---|---|
| Custom hash algorithms | Subclass `HashComputer` | Easy |
| Custom verdict logic | Subclass `VerdictGenerator` | Medium |
| Custom threat intel providers | Implement callable signature | Easy |
| Custom report formats | Implement renderer | Easy |
| Custom config validators | Add lambda validators | Easy |
| Full plugins | Implement `Plugin` class + manifest | Advanced |
| Hooks (observation) | Register callbacks | Easy |

All extension points follow the **Open/Closed Principle** — open for extension, closed for modification. Existing code never needs to change to support new extensions.
