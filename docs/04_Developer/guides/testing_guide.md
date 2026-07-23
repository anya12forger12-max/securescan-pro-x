# Testing Guide

Comprehensive guide to the Malware Hash Checker Pro testing infrastructure.

## Table of Contents

- [Test Framework Setup](#test-framework-setup)
- [Test Organization and Naming](#test-organization-and-naming)
- [Writing Unit Tests](#writing-unit-tests)
- [Writing Integration Tests](#writing-integration-tests)
- [Fixtures and conftest Patterns](#fixtures-and-conftest-patterns)
- [Mocking Strategies](#mocking-strategies)
- [Test Markers](#test-markers)
- [Coverage Requirements](#coverage-requirements)
- [Property-Based Testing with Hypothesis](#property-based-testing-with-hypothesis)
- [Benchmark Testing](#benchmark-testing)

---

## Test Framework Setup

### Core Dependencies

The test stack is configured in the root `pyproject.toml`:

| Package | Version | Purpose |
|---------|---------|---------|
| `pytest` | >=8.0 | Test runner |
| `pytest-cov` | >=5.0 | Coverage reporting |
| `pytest-xdist` | >=3.5 | Parallel test execution |
| `pytest-mock` | >=3.14 | Mocker fixture |
| `pytest-asyncio` | >=0.23 | Async test support |
| `pytest-benchmark` | >=4.0 | Performance benchmarks |
| `coverage[toml]` | >=7.0 | Coverage measurement |
| `hypothesis` | >=6.100 | Property-based testing |

Install with:

```bash
pip install -e ".[test]"
```

### Pytest Configuration

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = [
    "-ra",
    "--strict-markers",
    "--strict-config",
    "-v",
    "--tb=short",
    "--cov=packages",
    "--cov-report=term-missing",
    "--cov-report=html:htmlcov",
    "--cov-report=xml:coverage.xml",
    "--cov-fail-under=80",
]
```

Key settings:
- `--strict-markers` — Undeclared markers cause errors
- `--strict-config` — Invalid config values cause errors
- `--tb=short` — Concise tracebacks
- `--cov-fail-under=80` — Minimum 80% coverage required

---

## Test Organization and Naming

### Directory Structure

Each package has its own `tests/` directory:

```
packages/
├── core/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_errors.py
│   └── test_result.py
├── hashing/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_algorithm.py
│   └── test_validator.py
├── scanner/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   ├── test_backend.py
│   │   ├── test_pipeline.py
│   │   ├── test_state_machine.py
│   │   ├── test_verdict.py
│   │   ├── test_cancellation.py
│   │   ├── test_progress.py
│   │   ├── test_session.py
│   │   ├── test_scheduler.py
│   │   ├── test_repository.py
│   │   ├── test_results.py
│   │   ├── test_file_scanner.py
│   │   └── test_integration.py
│   ├── test_scanner.py
│   └── test_path_resolver.py
├── database/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_connection.py
│   └── test_repository.py
├── security/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_path_safety.py
│   └── test_file_permissions.py
├── logging/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_logger.py
│   └── test_redaction.py
├── config/tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_manager.py
│   └── test_schema.py
└── ui/tests/
    └── __init__.py
```

Additionally, benchmark tests live in:

```
packages/scanner/benchmarks/
├── __init__.py
├── test_pipeline_benchmarks.py
└── test_hash_benchmarks.py
```

### Naming Rules

| Element | Convention | Example |
|---------|-----------|---------|
| Test file | `test_<module>.py` | `test_algorithm.py` |
| Test class | `Test<Subject>` | `TestHashAlgorithmValues` |
| Test method | `test_<behavior>` | `test_md5_value` |
| Test method (condition) | `test_<condition>_<expected>` | `test_empty_file_returns_known_hash` |
| Test method (error) | `test_<action>_raises_<error>` | `test_nonexistent_file_raises_error` |
| Fixture | `<thing_being_provided>` | `sample_file`, `in_memory_db` |

### Class Grouping

Group related tests into classes named after the subject under test:

```python
class TestHashAlgorithmValues:
    """Verify enum members exist with expected values."""

    def test_md5_value(self) -> None:
        assert HashAlgorithm.MD5.value == "md5"

    def test_sha1_value(self) -> None:
        assert HashAlgorithm.SHA1.value == "sha1"


class TestDisplayName:
    """Verify display_name property."""

    @pytest.mark.parametrize(
        ("algorithm", "expected"),
        [
            (HashAlgorithm.MD5, "MD5"),
            (HashAlgorithm.SHA1, "SHA-1"),
            (HashAlgorithm.SHA256, "SHA-256"),
        ],
    )
    def test_display_name(self, algorithm: HashAlgorithm, expected: str) -> None:
        assert algorithm.display_name == expected
```

---

## Writing Unit Tests

Unit tests are fast, isolated, and test a single function or class.

### Basic Pattern

```python
"""Tests for mhcp_hashing.algorithm module."""

from __future__ import annotations

import pytest

from mhcp_hashing.algorithm import HashAlgorithm


class TestHashAlgorithmValues:
    """Verify enum members exist with expected values."""

    def test_md5_value(self) -> None:
        """MD5 member has value 'md5'."""
        assert HashAlgorithm.MD5.value == "md5"

    def test_sha256_value(self) -> None:
        """SHA256 member has value 'sha256'."""
        assert HashAlgorithm.SHA256.value == "sha256"
```

### Parametrized Tests

Use `@pytest.mark.parametrize` to test multiple inputs:

```python
class TestDigestSize:
    """Verify digest_size and hex_digest_length properties."""

    @pytest.mark.parametrize(
        ("algorithm", "digest_bytes", "hex_chars"),
        [
            (HashAlgorithm.MD5, 16, 32),
            (HashAlgorithm.SHA1, 20, 40),
            (HashAlgorithm.SHA256, 32, 64),
            (HashAlgorithm.SHA384, 48, 96),
            (HashAlgorithm.SHA512, 64, 128),
        ],
    )
    def test_digest_sizes(
        self, algorithm: HashAlgorithm, digest_bytes: int, hex_chars: int
    ) -> None:
        """Digest sizes match expected values."""
        assert algorithm.digest_size == digest_bytes
        assert algorithm.hex_digest_length == hex_chars
```

### Testing Error Conditions

```python
class TestFromString:
    """Verify from_string classmethod."""

    def test_unknown_algorithm_raises(self) -> None:
        """Unknown algorithm raises ValueError."""
        with pytest.raises(ValueError, match="Unknown hash algorithm"):
            HashAlgorithm.from_string("blake3")

    def test_empty_string_raises(self) -> None:
        """Empty string raises ValueError."""
        with pytest.raises(ValueError, match="Unknown hash algorithm"):
            HashAlgorithm.from_string("")
```

### Testing with tmp_path

Use pytest's built-in `tmp_path` fixture for temporary file tests:

```python
class TestComputeFile:
    """Verify file-based hashing."""

    def test_compute_file_not_found(self, tmp_path: Path) -> None:
        """Raise HashError when the file does not exist."""
        backend = HashBackend(HashAlgorithm.SHA256)
        nonexistent = tmp_path / "does_not_exist.bin"
        with pytest.raises(HashError):
            backend.compute_file(nonexistent)

    def test_compute_file_empty(self, empty_file: Path) -> None:
        """Hash an empty file and verify against known SHA-256."""
        backend = HashBackend(HashAlgorithm.SHA256)
        result = backend.compute_file(empty_file)
        assert result == SHA256_EMPTY
```

---

## Writing Integration Tests

Integration tests verify that multiple components work together correctly.

### Pattern

```python
"""Integration tests for the scan engine — end-to-end workflows."""

from __future__ import annotations

from pathlib import Path

import pytest

from mhcp_database.connection import DatabaseConnection
from mhcp_scanner.engine.file_scanner import MHCPFileScanner
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline
from mhcp_scanner.engine.repository import HashRecordRepository, initialize_hash_table
from mhcp_scanner.engine.results import ScanResults
from mhcp_scanner.engine.session import ScanSession
from mhcp_scanner.engine.verdict import VerdictType, VerdictGenerator

from .conftest import SHA256_EMPTY, SHA256_HELLO, SHA256_SAMPLE_1K, MD5_TEST


class TestFullScanWorkflow:
    """End-to-end scan from file to verdict to results."""

    def test_full_scan_workflow(self, sample_file: Path) -> None:
        """FileScanner -> Pipeline -> Verdict -> Results."""
        pipeline = ScanPipeline(config=PipelineConfig())
        result = pipeline.scan_file(sample_file)

        hashes = result.get("hashes", result.get("computed_hashes", {}))
        assert "sha256" in hashes, "Pipeline should compute SHA-256"

        gen = VerdictGenerator()
        verdict = gen.generate(lookup_results=[])
        assert verdict.verdict_type is VerdictType.UNKNOWN

        results = ScanResults()
        session = ScanSession()
        session.set_hash("sha256", hashes["sha256"])
        session.mark_started()
        session.mark_completed()
        results.add_session(session)
        summary = results.compute_summary()
        assert summary.total_scans >= 1
```

### Database Integration

```python
class TestScanWithDatabaseLookup:
    """Verify hash lookup integration with a real database."""

    def test_scan_with_database_lookup(
        self, sample_file: Path, populated_db: DatabaseConnection
    ) -> None:
        """Scanning against a populated database finds matches."""
        initialize_hash_table(populated_db)
        repo = HashRecordRepository(populated_db)
        pipeline = ScanPipeline(
            config=PipelineConfig(), lookup_fn=repo.lookup
        )
        result = pipeline.scan_file(sample_file)
        hashes = result.get("hashes", result.get("computed_hashes", {}))
        sha256 = hashes.get("sha256", "")

        assert sha256 == SHA256_SAMPLE_1K

        matches = repo.lookup(sha256)
        assert len(matches) > 0
```

---

## Fixtures and conftest Patterns

### conftest.py Location

Fixtures are defined in `conftest.py` files at each test directory level:

- `packages/scanner/tests/conftest.py` — Scanner-level fixtures
- `packages/scanner/tests/engine/conftest.py` — Engine-specific fixtures
- `packages/core/tests/conftest.py` — Core package fixtures
- `packages/hashing/tests/conftest.py` — Hashing package fixtures
- `packages/database/tests/conftest.py` — Database package fixtures
- `packages/security/tests/conftest.py` — Security package fixtures
- `packages/logging/tests/conftest.py` — Logging package fixtures
- `packages/config/tests/conftest.py` — Config package fixtures

### Common Fixture Patterns

#### Temporary File Fixtures

```python
@pytest.fixture()
def sample_file(tmp_path: Path) -> Path:
    """Create a 1KB binary file with deterministic content."""
    path = tmp_path / "sample.bin"
    path.write_bytes(b"\x42" * 1024)
    return path


@pytest.fixture()
def sample_file_large(tmp_path: Path) -> Path:
    """Create a 1MB binary file."""
    path = tmp_path / "large.bin"
    path.write_bytes(b"\xAB" * (1024 * 1024))
    return path


@pytest.fixture()
def empty_file(tmp_path: Path) -> Path:
    """Create an empty file."""
    path = tmp_path / "empty.bin"
    path.write_bytes(b"")
    return path
```

#### Database Fixtures

```python
@pytest.fixture()
def in_memory_db() -> DatabaseConnection:
    """Provide a connected in-memory DatabaseConnection."""
    conn = DatabaseConnection(":memory:")
    conn.connect()
    yield conn
    conn.close()


@pytest.fixture()
def populated_db(in_memory_db: DatabaseConnection) -> DatabaseConnection:
    """Create hash_records table and insert known test vector records."""
    in_memory_db.execute("""
        CREATE TABLE IF NOT EXISTS hash_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash_value TEXT NOT NULL,
            algorithm TEXT NOT NULL,
            source TEXT,
            threat_type TEXT,
            severity TEXT,
            first_seen TEXT,
            last_seen TEXT,
            metadata TEXT
        )
    """)
    in_memory_db.execute(
        "CREATE INDEX IF NOT EXISTS idx_hash_value ON hash_records (hash_value)"
    )
    # Insert test records...
    return in_memory_db
```

#### Lookup Function Fixtures

```python
@pytest.fixture()
def hash_lookup_fn(populated_db: DatabaseConnection) -> Callable:
    """Return a callable wrapping HashRecordRepository.lookup."""
    from mhcp_scanner.engine.repository import HashRecordRepository
    repo = HashRecordRepository(populated_db)
    return repo.lookup
```

#### Parametrised Fixtures

```python
@pytest.fixture(params=list(HashAlgorithm))
def any_algorithm(request: pytest.FixtureRequest) -> HashAlgorithm:
    """Parametrised fixture yielding every HashAlgorithm member."""
    return request.param
```

#### Pre-built Model Fixtures

```python
@pytest.fixture()
def sample_hash_record() -> HashRecord:
    """Return a HashRecord with sha256 hash."""
    return HashRecord(
        id=None,
        hash_value=SHA256_HELLO,
        algorithm="sha256",
        source="test",
        threat_type="clean",
        severity="low",
        first_seen=datetime(2024, 1, 1, tzinfo=timezone.utc),
        last_seen=datetime(2024, 6, 1, tzinfo=timezone.utc),
        metadata={"test": True},
    )
```

### Fixture Scope

- **Function scope** (default) — Created fresh for each test. Use for most fixtures.
- **Class scope** — Shared across methods in a test class. Use for expensive setup.
- **Module scope** — Shared across all tests in a module. Use for module-level resources.
- **Session scope** — Shared across all tests. Use for expensive, immutable resources.

```python
@pytest.fixture(scope="session")
def expensive_resource():
    """Shared across all tests in the session."""
    ...
```

---

## Mocking Strategies

### pytest-mock

Use the `mocker` fixture from `pytest-mock`:

```python
def test_mock_database(mocker: MockerFixture) -> None:
    """Mock database connection for isolated testing."""
    mock_conn = mocker.patch("mhcp_database.connection.DatabaseConnection")
    mock_conn.return_value.fetchone.return_value = {"val": 42}

    result = some_function_that_uses_db()
    assert result == 42
```

### Monkeypatch

Use `monkeypatch` for environment variables and attributes:

```python
def test_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """MCP_ environment variables override configuration."""
    monkeypatch.setenv("MCP_LOGGING__LEVEL", "CRITICAL")
    mgr = ConfigurationManager()
    mgr.load()
    assert mgr.get("logging.level") == "CRITICAL"
```

### Mock Callables

For callback-based APIs, use simple callables:

```python
@pytest.fixture()
def hash_lookup_fn(populated_db: DatabaseConnection) -> Callable:
    """Return a callable wrapping HashRecordRepository.lookup."""
    from mhcp_scanner.engine.repository import HashRecordRepository
    repo = HashRecordRepository(populated_db)
    return repo.lookup
```

### Fake In-Memory Databases

Use SQLite in-memory databases for fast, isolated database tests:

```python
@pytest.fixture()
def in_memory_db() -> DatabaseConnection:
    """Provide a connected in-memory DatabaseConnection."""
    conn = DatabaseConnection(":memory:")
    conn.connect()
    yield conn
    conn.close()
```

### Mock Providers

Use mock providers for external API testing:

```python
class MockThreatIntelProvider:
    """In-memory mock that simulates a real provider."""

    KNOWN_HASHES = {
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855": {
            "threat_type": "trojan",
            "severity": "high",
        },
    }

    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
        records = []
        for algo, digest in hashes.items():
            if digest in self.KNOWN_HASHES:
                match = self.KNOWN_HASHES[digest].copy()
                match["hash_value"] = digest
                records.append(match)
        return records
```

---

## Test Markers

Markers are declared in `pyproject.toml` and enforced with `--strict-markers`:

```python
@pytest.mark.unit
def test_fast_isolated() -> None:
    """Fast, isolated test."""
    ...

@pytest.mark.integration
def test_multi_component() -> None:
    """Tests multiple components together."""
    ...

@pytest.mark.e2e
def test_full_workflow() -> None:
    """End-to-end test of the full workflow."""
    ...

@pytest.mark.security
def test_path_traversal() -> None:
    """Security regression test."""
    ...

@pytest.mark.accessibility
def test_keyboard_navigation() -> None:
    """Accessibility test."""
    ...

@pytest.mark.benchmark
def test_hash_performance() -> None:
    """Performance benchmark."""
    ...

@pytest.mark.slow
def test_large_file() -> None:
    """Test that takes more than 5 seconds."""
    ...

@pytest.mark.network
def test_api_lookup() -> None:
    """Test requiring network access."""
    ...

@pytest.mark.platform
def test_platform_specific() -> None:
    """Test specific to an OS."""
    ...
```

### Running by Marker

```bash
python -m pytest -m unit
python -m pytest -m "integration and not slow"
python -m pytest -m "not network"
```

---

## Coverage Requirements

### Configuration

```toml
[tool.coverage.run]
source = ["packages"]
branch = true
parallel = true
omit = [
    "*/tests/*",
    "*/__pycache__/*",
    "*/conftest.py",
]

[tool.coverage.report]
precision = 2
show_missing = true
skip_covered = false
fail_under = 80
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "if self.debug:",
    "if settings.DEBUG",
    "raise AssertionError",
    "raise NotImplementedError",
    "if 0:",
    "if __name__ == .__main__.",
    "pass",
    "except ImportError",
    "\\.\\.\\.",
]
```

### Minimum Coverage

The project requires **80% minimum coverage** across all packages. This is enforced in CI.

### Viewing Coverage

```bash
# Terminal report
python -m pytest --cov=packages --cov-report=term-missing

# HTML report (interactive)
python -m pytest --cov=packages --cov-report=html
open htmlcov/index.html

# XML report (for CI)
python -m pytest --cov=packages --cov-report=xml
```

### Excluded Lines

The following are excluded from coverage measurement:

- `pragma: no cover` — Explicitly excluded code
- `def __repr__` — Repr methods
- `raise NotImplementedError` — Abstract methods
- `if __name__ == "__main__"` — Entry points
- `except ImportError` — Optional dependency imports

---

## Property-Based Testing with Hypothesis

### Setup

Hypothesis is configured in `pyproject.toml`:

```toml
[tool.hypothesis]
database = ".hypothesis/examples"
max_examples = 100
```

### Basic Usage

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1))
def test_parse_hash_accepts_valid_hex(raw: str) -> None:
    """Any valid hex string of correct length is accepted."""
    # Filter to only valid inputs
    valid_hex = st.from_regex(r"[0-9a-f]{64}", fullmatch=True)
    # This test generates random strings and verifies invariants
```

### Hash-Specific Strategies

```python
from hypothesis import given, strategies as st

# Strategy for valid SHA-256 hashes
sha256_strategy = st.from_regex(r"[0-9a-f]{64}", fullmatch=True)

# Strategy for valid MD5 hashes
md5_strategy = st.from_regex(r"[0-9a-f]{32}", fullmatch=True)

@given(sha256_strategy)
def test_hash_always_returns_correct_length(hex_digest: str) -> None:
    """Hash computation always returns the correct number of hex chars."""
    result = compute_hash_from_bytes(hex_digest.encode())
    assert len(result) == 64
    assert all(c in "0123456789abcdef" for c in result)
```

### Testing Result Type Properties

```python
from hypothesis import given, strategies as st
from mhcp_core.result import Ok, Err

@given(st.integers())
def test_ok_unwrap_always_returns_value(x: int) -> None:
    """Ok(x).unwrap() always returns x."""
    assert Ok(x).unwrap() == x

@given(st.integers())
def test_err_unwrap_or_returns_default(x: int) -> None:
    """Err(...).unwrap_or(default) always returns default."""
    result = Err(ValueError("fail"))
    assert result.unwrap_or(x) == x
```

### Testing Error Hierarchy

```python
from hypothesis import given, strategies as st
from mhcp_core.errors import MHCError, Severity

@given(
    message=st.text(min_size=1, max_size=200),
    code=st.from_regex(r"[A-Z_]+", fullmatch=True),
    severity=st.sampled_from(list(Severity)),
)
def test_error_to_dict_roundtrip(
    message: str, code: str, severity: Severity
) -> None:
    """Error serialises to a complete dictionary."""
    err = MHCError(message, error_code=code, severity=severity)
    d = err.to_dict()
    assert d["error_code"] == code
    assert d["severity"] == severity.value
    assert d["message"] == message
```

---

## Benchmark Testing

### Setup

Benchmarks use `pytest-benchmark` and live in `benchmarks/` directories:

```bash
# Run all benchmarks
python -m pytest benchmarks/ -m benchmark --benchmark-only -v

# Run specific benchmark file
python -m pytest packages/scanner/benchmarks/test_pipeline_benchmarks.py -v

# Compare against a previous run
python -m pytest benchmarks/ --benchmark-compare=0.1.0
```

### Writing Benchmarks

```python
"""Performance benchmarks for the scan pipeline.

Run with: pytest benchmarks/test_pipeline_benchmarks.py -v --benchmark-only
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from mhcp_scanner.engine import MHCPFileScanner, ScanPipeline, PipelineConfig


@pytest.fixture
def small_scan_file(tmp_path: Path) -> Path:
    """Create a small file for benchmarking."""
    p = tmp_path / "scan_target.bin"
    p.write_bytes(os.urandom(1024))
    return p


@pytest.fixture
def batch_scan_files(tmp_path: Path) -> list[Path]:
    """Create 10 files for batch benchmarking."""
    files = []
    for i in range(10):
        p = tmp_path / f"batch_{i}.bin"
        p.write_bytes(os.urandom(1024))
        files.append(p)
    return files


@pytest.fixture
def scanner() -> MHCPFileScanner:
    return MHCPFileScanner()


def test_benchmark_single_file_scan(
    benchmark, scanner: MHCPFileScanner, small_scan_file: Path
):
    """Benchmark single file scan performance."""
    benchmark(scanner.scan_file, small_scan_file)


def test_benchmark_batch_scan(
    benchmark, scanner: MHCPFileScanner, batch_scan_files: list[Path]
):
    """Benchmark batch scan performance."""
    benchmark(scanner.scan_files, batch_scan_files)
```

### Benchmark Options

```bash
# Set minimum rounds
python -m pytest benchmarks/ --benchmark-min-rounds=10

# Disable benchmarks (run as regular tests)
python -m pytest benchmarks/ -m benchmark --no-header

# Save benchmark results
python -m pytest benchmarks/ --benchmark-save=baseline
```

### Memory Profiling

```bash
# Install memory profiler
pip install memory-profiler

# Run with memory profiling
python -m memory_profiler -m pytest tests/ -m benchmark

# Or use the dev script
python scripts/dev/dev.py bench
```
