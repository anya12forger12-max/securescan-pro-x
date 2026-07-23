# Developer Guide

Comprehensive guide for contributing to Malware Hash Checker Pro (MHCP).

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Repository Structure](#repository-structure)
- [Package Architecture](#package-architecture)
- [Getting Started with Development](#getting-started-with-development)
- [Running Tests](#running-tests)
- [Linting, Formatting, and Type Checking](#linting-formatting-and-type-checking)
- [Common Development Tasks](#common-development-tasks)
- [Debugging Tips](#debugging-tips)
- [Performance Considerations](#performance-considerations)

---

## Development Environment Setup

### Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Python | 3.13+ | Backend runtime and tooling |
| Flutter | 3.x | Desktop frontend |
| Git | 2.x+ | Version control |
| Make | (optional) | Convenience commands |

### Python Environment

```bash
# Clone the repository
git clone https://github.com/placeholder/MalwareHashChecker-Pro.git
cd MalwareHashChecker-Pro

# Create and activate a virtual environment
python3.13 -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

# Install the root project in editable mode with all dev/test extras
pip install -e ".[dev,test]"
```

### Per-Package Installation

Each package under `packages/` can also be installed independently for isolated development:

```bash
# Core package
pip install -e packages/core

# Hashing package
pip install -e packages/hashing

# Scanner package (depends on core + hashing)
pip install -e packages/scanner

# Database package
pip install -e packages/database

# Security package
pip install -e packages/security

# Logging package
pip install -e packages/logging

# Config package
pip install -e packages/config
```

### Flutter Frontend

```bash
cd apps/desktop
flutter pub get
flutter analyze
flutter run
```

### Development Utilities

MHCP ships a developer utility script with no external dependencies:

```bash
# Show all available commands
python scripts/dev/dev.py --help

# Run the full setup (installs deps, sets up hooks, validates)
python scripts/dev/dev.py setup
```

---

## Repository Structure

```
.
├── apps/
│   └── desktop/              # Flutter desktop application
├── packages/                  # Python packages (Clean Architecture)
│   ├── core/                  # Domain layer: errors, Result[T,E] monad
│   ├── hashing/               # Hash computation: HashAlgorithm, HashBackend
│   ├── scanner/               # Scan engine: pipeline, state machine, verdict
│   ├── database/              # Database layer: connection, models, repository
│   ├── security/              # Security: path safety, permissions
│   ├── logging/               # Structured logging with redaction
│   ├── config/                # Configuration management
│   ├── reports/               # Report generation (JSON, CSV, text)
│   └── ui/                    # Shared UI components
├── tests/                     # Cross-package integration and e2e tests
├── benchmarks/                # Cross-package performance benchmarks
├── examples/                  # Working examples
│   ├── minimal/               # Minimal scan example
│   ├── advanced/              # Batch scanning, custom verdicts
│   ├── plugin/                # Custom providers and hash algorithms
│   ├── configuration/         # Config management demo
│   └── reporting/             # Report generation demo
├── scripts/
│   ├── dev/                   # Developer utilities
│   ├── ci/                    # CI/CD scripts
│   └── release/               # Release automation
├── docs/                      # Documentation
│   ├── 00_Project/
│   ├── 01_Getting_Started/
│   ├── 02_User_Guide/
│   ├── 03_Administrator/
│   ├── 04_Developer/          # Developer docs (this section)
│   ├── 05_Security/
│   └── 06_Testing/
├── pyproject.toml             # Root project configuration
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE                    # GPL-3.0-only
└── README.md
```

---

## Package Architecture

MHCP follows **Clean Architecture** principles. Each package has a clear responsibility and dependency direction.

### Dependency Rule

Dependencies point **inward**. Outer layers depend on inner layers, never the reverse.

```
┌──────────────────────────────────────────────┐
│  UI Layer (Flutter)                          │
│  apps/desktop                                │
├──────────────────────────────────────────────┤
│  Framework Layer                             │
│  scanner · reports · config                  │
├──────────────────────────────────────────────┤
│  Service Layer                               │
│  hashing · database · security · logging     │
├──────────────────────────────────────────────┤
│  Core / Domain Layer                         │
│  mhcp_core (errors, Result[T,E])            │
└──────────────────────────────────────────────┘
```

**Rule**: `mhcp_core` has zero external dependencies. Packages in the service layer depend only on `mhcp_core`. Packages in the framework layer may depend on service-layer packages and `mhcp_core`.

### Package Internal Layout

Each Python package follows this layout:

```
packages/<name>/
├── pyproject.toml           # Hatchling build, dependencies
├── lib/
│   └── src/
│       └── mhcp_<name>/     # Source code
│           ├── __init__.py
│           └── ...
└── tests/
    ├── conftest.py          # Shared fixtures
    ├── __init__.py
    └── test_*.py
```

Some packages (like `core`, `scanner`) use `src/mhcp_<name>/` directly instead of `lib/src/`.

### Core Package (`mhcp_core`)

The foundation of all error handling and control flow:

- **`errors.py`** — `MHCError` base exception with `Severity` enum and structured error codes. Subclasses: `HashError`, `DatabaseError`, `SecurityError`, `ScannerError`, `ConfigurationError`, `FilesystemError`, `ValidationError`, `ApplicationError`.
- **`result.py`** — `Result[T, E]` monadic type with `Ok(value)` and `Err(exception)` variants. Supports `map`, `flat_map`, `map_err`, `unwrap`, `unwrap_or`, and `from_optional`.

### Scanner Package

The scan engine orchestrates file hashing, database lookup, and verdict generation:

- **`engine/pipeline.py`** — `ScanPipeline` and `PipelineConfig` for multi-stage scanning.
- **`engine/backend.py`** — `HashBackend` for single-algorithm and multi-algorithm file hashing.
- **`engine/state_machine.py`** — `ScanState` enum and `ScanStateMachine` for lifecycle tracking.
- **`engine/verdict.py`** — `VerdictGenerator`, `Verdict`, `VerdictType`, `VerdictEvidence`.
- **`engine/cancellation.py`** — `CancellationHandler` and `CancelledError` for graceful cancellation.
- **`engine/progress.py`** — `ProgressTracker` and `ProgressStage` for UI progress reporting.
- **`engine/session.py`** — `ScanSession`, `PerformanceMetrics`, `ScanWarning`.
- **`engine/scheduler.py`** — `Scheduler`, `ScanRequest`, `ScanPriority` for batch scan management.
- **`engine/repository.py`** — `HashRecordRepository` and `initialize_hash_table`.
- **`engine/results.py`** — `ScanResults` for batch result aggregation.
- **`engine/file_scanner.py`** — `MHCPFileScanner` as the top-level orchestrator.

### Hashing Package

- **`algorithm.py`** — `HashAlgorithm` enum (MD5, SHA1, SHA256, SHA384, SHA512) with `display_name`, `digest_size`, `is_recommended`, `is_legacy`, `from_string`, `supported_algorithms`.

### Database Package

- **`connection.py`** — `DatabaseConnection` with context manager, WAL mode, transaction support.
- **`models.py`** — `HashRecord` and `ScanResult` data models.

### Security Package

- **`path_safety.py`** — `is_safe_path`, `sanitize_path`, `PathSafetyResult`.
- **`file_permissions.py`** — `check_read_permission`, `get_file_permissions`, `ensure_safe_permissions`, `FilePermissionInfo`.

### Logging Package

- **`logger.py`** — `MHCPLogger`, `get_logger`, `LogCategory` with audit/performance/security methods.
- **`redaction.py`** — `RedactionFilter` for PII and sensitive data redaction.

### Config Package

- **`manager.py`** — `ConfigurationManager` with TOML loading, env var overrides, dot-path access.
- **`schema.py`** — `ConfigSchema`, `FieldDefinition`, `FieldType` for validation.
- **`defaults.py`** — `DEFAULT_CONFIG` dictionary.

### Reports Package

- **`formats.py`** — `OutputFormat` enum and report generation utilities.

---

## Getting Started with Development

### Quick Start

```bash
# 1. Fork and clone
git clone https://github.com/YOUR-USER/MalwareHashChecker-Pro.git
cd MalwareHashChecker-Pro

# 2. Create virtual environment
python3.13 -m venv .venv
source .venv/bin/activate

# 3. Install everything
pip install -e ".[dev,test]"

# 4. Run the full validation suite
python scripts/dev/dev.py validate
```

### Your First Contribution

1. **Pick an issue** from the issue tracker (look for `good-first-issue` labels).
2. **Create a branch** using the naming convention:
   ```
   git checkout -b feature/description     # new features
   git checkout -b fix/description         # bug fixes
   git checkout -b docs/description        # documentation
   git checkout -b test/description        # test additions
   ```
3. **Write code** following the [Style Guide](style_guide.md).
4. **Write tests** following the [Testing Guide](testing_guide.md).
5. **Run validation** before committing:
   ```bash
   python scripts/dev/dev.py validate
   ```
6. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(hashing): add SHA-512 hash computation
   fix(scanner): prevent path traversal in file resolution
   docs(api): update hash computation API documentation
   test(database): add connection pool tests
   ```
7. **Push** and **open a Pull Request** against `main`.

---

## Running Tests

### Full Test Suite

```bash
python -m pytest tests/ -v
```

### By Marker

```bash
python -m pytest -m unit          # Fast, isolated tests
python -m pytest -m integration   # Multi-component tests
python -m pytest -m e2e           # Full workflow tests
python -m pytest -m security      # Security regression tests
python -m pytest -m benchmark     # Performance benchmarks
python -m pytest -m slow          # Tests > 5 seconds
```

### Single Package

```bash
# Run tests for a specific package
python -m pytest packages/scanner/tests/ -v
python -m pytest packages/core/tests/ -v
python -m pytest packages/hashing/tests/ -v
```

### Coverage

Coverage is configured with an 80% minimum threshold:

```bash
python -m pytest --cov=packages --cov-report=term-missing
```

Coverage reports are generated in multiple formats:
- Terminal output (with missing lines highlighted)
- `htmlcov/` directory (interactive HTML)
- `coverage.xml` (for CI integration)

### Benchmarks

```bash
python -m pytest benchmarks/ -m benchmark --benchmark-only -v
```

### Using the Dev Script

```bash
python scripts/dev/dev.py test --unit
python scripts/dev/dev.py test --integration
python scripts/dev/dev.py test --benchmark
```

---

## Linting, Formatting, and Type Checking

### Ruff (Linting)

```bash
# Check for issues
ruff check packages/ tests/ scripts/

# Auto-fix issues
ruff check --fix packages/ tests/ scripts/

# Show available fixes
ruff check --show-fixes packages/
```

The project uses an extensive set of Ruff rules including pycodestyle, pyflakes, isort, pep8-naming, flake8-bugbear, flake8-bandit (security), flake8-pytest-style, perflint, and more.

**Configuration** (`pyproject.toml`):
- Target: Python 3.13
- Line length: 88
- Security rules (`S`) are enabled
- Test files allow `assert` (S101 ignored)
- Scripts allow `print` (T20 ignored)

### Black (Formatting)

```bash
# Format code
black packages/ tests/ scripts/

# Check without modifying
black --check packages/ tests/ scripts/
```

**Configuration**:
- Target: Python 3.13
- Line length: 88
- String normalization: enabled (double quotes)

### Mypy (Type Checking)

```bash
# Run type checking
mypy packages/

# Strict mode
mypy packages/ --strict
```

**Configuration** (`pyproject.toml`):
- Python version: 3.13
- `disallow_untyped_defs = true` — all functions must have type annotations
- `disallow_incomplete_defs = true` — all parameters must be typed
- `strict_equality = true`
- `warn_return_any = true`
- Test files relax `disallow_untyped_defs`

### Using the Dev Script

```bash
python scripts/dev/dev.py lint --fix        # Ruff with auto-fix
python scripts/dev/dev.py format             # Black + Ruff import sorting
python scripts/dev/dev.py format --check     # Format check only
python scripts/dev/dev.py typecheck          # Mypy
python scripts/dev/dev.py typecheck --strict # Mypy strict mode
```

---

## Common Development Tasks

### Adding a New Error Type

1. Open `packages/core/src/mhcp_core/errors.py`.
2. Add a new `@final` class inheriting from `MHCError`:

```python
@final
class NewSubsystemError(MHCError):
    """Description of when this error is raised."""
```

3. Add it to `__all__`.
4. Write tests in `packages/core/tests/test_errors.py`.
5. Use it with the `Result` type or raise it directly.

### Adding a New Hash Algorithm

1. Open `packages/hashing/src/mhcp_hashing/algorithm.py`.
2. Add a new member to the `HashAlgorithm` enum:

```python
ALGO_NAME = "algo_name"
```

3. Update `display_name`, `digest_size`, `hex_digest_length`, `is_recommended`, `is_legacy`.
4. Add tests in `packages/hashing/tests/test_algorithm.py`.
5. See `examples/plugin/custom_hash_algorithm.py` for runtime registration.

### Adding a New Scan Pipeline Stage

1. Open `packages/scanner/src/mhcp_scanner/engine/pipeline.py`.
2. Add a method to `ScanPipeline`:

```python
def new_stage(self, context: ScanContext) -> ScanContext:
    """Description of what this stage does."""
    # Implementation
    return context
```

3. Wire it into the existing pipeline flow.
4. Write tests in `packages/scanner/tests/engine/test_pipeline.py`.

### Adding a New Verdict Type

1. Open `packages/scanner/src/mhcp_scanner/engine/verdict.py`.
2. Add to `VerdictType` enum.
3. Update `VerdictGenerator.generate` to handle the new type.
4. See `examples/advanced/custom_verdict.py` for extending the generator via subclassing.

### Adding a New Configuration Field

1. Open `packages/config/src/mhcp_config/defaults.py` and add the field.
2. Update `packages/config/src/mhcp_config/schema.py` if validation is needed.
3. Use `ConfigurationManager.get("section.field")` to read the value.
4. Write tests in `packages/config/tests/test_manager.py`.

### Adding a New Test Fixture

1. Open the relevant `conftest.py` in the test directory.
2. Define a fixture with a descriptive name and docstring:

```python
@pytest.fixture()
def my_fixture() -> MyType:
    """Description of what this fixture provides."""
    return MyType(...)
```

3. Use it in tests. Pytest auto-discovers fixtures from `conftest.py`.

---

## Debugging Tips

### Logging

MHCP uses a structured logging system with built-in PII redaction:

```python
from mhcp_logging.logger import get_logger

logger = get_logger(__name__)
logger.info("Processing file: %s", file_path)
logger.debug("Hash computation took %.2f ms", elapsed)
logger.warning("File too large: %d bytes", size)
logger.error("Hash computation failed: %s", error)
logger.critical("Database connection lost")
```

Specialized log methods:
- `logger.audit("action", actor="user", action="scan", result="success")`
- `logger.performance("operation done", operation="hash", duration_ms=42.5)`
- `logger.security("threat detected", threat_type="trojan", severity="high")`

### Result Type Debugging

```python
from mhcp_core.result import Ok, Err

result = Ok(42)
print(result)         # Ok(42)
print(result.is_ok()) # True

result = Err(ValueError("bad input"))
print(result)         # Err(ValueError('bad input'))
print(result.is_err()) # True
```

### Error Hierarchy

```python
from mhcp_core.errors import MHCError, HashError, Severity

try:
    raise HashError(
        message="SHA-256 failed",
        error_code="HASH_FAILED",
        severity=Severity.ERROR,
        recovery_suggestion="Check file permissions.",
    )
except MHCError as e:
    print(e.to_dict())
    # {'error_type': 'HashError', 'error_code': 'HASH_FAILED', ...}
```

### State Machine Inspection

```python
from mhcp_scanner.engine.state_machine import ScanStateMachine, ScanState

sm = ScanStateMachine()
sm.transition(ScanState.PREPARING)
sm.transition(ScanState.HASHING)

print(sm.current_state)  # ScanState.HASHING
print(sm.history)        # [ScanState.IDLE, ScanState.PREPARING, ScanState.HASHING]
print(sm.to_dict())      # Serialized state information
```

### Database Debugging

```python
from mhcp_database.connection import DatabaseConnection

with DatabaseConnection(":memory:") as db:
    db.execute("CREATE TABLE t (id INTEGER)")
    db.execute("INSERT INTO t (id) VALUES (1)")
    row = db.fetchone("SELECT * FROM t")
    print(row)  # {'id': 1}
```

### Performance Measurement

```python
from mhcp_logging.logger import get_logger

logger = get_logger(__name__)
with logger.timed("hash computation"):
    result = pipeline.scan_file(target)
```

---

## Performance Considerations

### Streaming Hash Computation

Files are read in adaptive chunks, never loaded entirely into memory. The default chunk size is 8192 bytes, scaled up for larger files via `HashBackend.adaptive_chunk_size()`.

### Single-Pass Multi-Hash

`HashBackend.compute_file_multi()` computes multiple hash algorithms (e.g., SHA-256 + MD5) in a single pass over the file, avoiding redundant I/O.

### Adaptive Chunk Sizing

```python
from mhcp_scanner.engine.backend import HashBackend
from mhcp_hashing.algorithm import HashAlgorithm

backend = HashBackend(HashAlgorithm.SHA256)
chunk_size = backend.adaptive_chunk_size(file_size)
```

Small files get smaller chunks for lower latency. Large files get larger chunks for higher throughput.

### Database Indexing

The `hash_records` table indexes `hash_value` for fast lookup. WAL mode is enabled by default for concurrent read performance.

### Caching

The `ThreatIntelProvider` example demonstrates in-memory caching for repeated lookups within the same scan session:

```python
self._cache: dict[str, list[dict[str, Any]]] = {}

def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
    cache_key = f"{algorithm}:{hex_digest}"
    if cache_key in self._cache:
        return self._cache[cache_key]
    # ... query API ...
    self._cache[cache_key] = records
```

### Concurrency

The `CancellationHandler` is thread-safe, using internal locking for cross-thread cancellation requests. The `Scheduler` supports priority-based scan ordering.

### Profiling

```bash
# Memory profiling
memory-profiler python -m pytest tests/ -m benchmark

# Benchmark comparison
python scripts/dev/dev.py bench --compare=0.1.0
```

See the [Performance Guide](performance_guide.md) for detailed profiling and benchmarking instructions.
