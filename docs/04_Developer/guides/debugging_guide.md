# Debugging Guide

Techniques and tools for debugging the Malware Hash Checker Pro codebase.

## Table of Contents

- [Logging System Usage](#logging-system-usage)
- [Debug Configurations](#debug-configurations)
- [Performance Profiling](#performance-profiling)
- [Memory Profiling](#memory-profiling)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Known Limitations](#known-limitations)
- [Getting Help](#getting-help)

---

## Logging System Usage

MHCP provides a structured logging framework with built-in PII redaction via the `mhcp-logging` package.

### Basic Usage

```python
from mhcp_logging.logger import get_logger

logger = get_logger(__name__)

logger.debug("Processing file: %s", file_path)
logger.info("Scan started for %d files", len(files))
logger.warning("File too large: %d bytes", size)
logger.error("Hash computation failed: %s", error)
logger.critical("Database connection lost")
```

### Specialized Log Methods

The logger provides domain-specific methods for structured logging:

```python
# Audit logging — tracks who did what
logger.audit(
    "User initiated scan",
    actor="alice",
    action="scan_started",
    result="success",
)

# Performance logging — tracks operation timing
logger.performance(
    "Hash computation completed",
    operation="sha256_compute",
    duration_ms=42.5,
)

# Security logging — tracks threats and policy violations
logger.security(
    "Malware hash detected",
    threat_type="trojan",
    severity="high",
)
```

### Log Categories

The `LogCategory` enum defines log categories:

| Category | Value | Purpose |
|----------|-------|---------|
| `APPLICATION` | `"application"` | General application events |
| `DEBUG` | `"debug"` | Debug-level diagnostic information |
| `AUDIT` | `"audit"` | Audit trail for user actions |
| `PERFORMANCE` | `"performance"` | Performance metrics and timing |
| `SECURITY` | `"security"` | Security events and threats |

### Timed Context Manager

Measure block execution time:

```python
from mhcp_logging.logger import get_logger

logger = get_logger(__name__)

with logger.timed("hash computation"):
    result = backend.compute_file(file_path)
# Automatically logs: "hash computation" with duration_ms
```

### PII Redaction

The `RedactionFilter` automatically redacts sensitive information from log messages:

```python
from mhcp_logging.redaction import RedactionFilter

filter = RedactionFilter()
redacted = filter.redact("User alice@example.com logged in from 192.168.1.1")
# Result: "User [REDACTED] logged in from [REDACTED]"
```

**Built-in patterns redact:**
- Email addresses
- IPv4 addresses
- SHA-256 hashes (64-char hex strings)
- MD5 hashes (32-char hex strings)

**Custom patterns:**

```python
filter = RedactionFilter(patterns=[r"SECRET-\d+"])
redacted = filter.redact("Code SECRET-12345 is invalid")
# Result: "Code [REDACTED] is invalid"
```

**Custom replacement token:**

```python
filter = RedactionFilter(replacement="***")
redacted = filter.redact("Contact bob@test.org")
# Result: "Contact ***"
```

**Disable built-in patterns:**

```python
filter = RedactionFilter(use_builtin_patterns=False)
result = filter.redact("User bob@test.org")
# Result: "User bob@test.org" (no redaction)
```

### Adding Custom Redaction Patterns

```python
filter = RedactionFilter()
filter.add_pattern(r"API_KEY-[a-zA-Z0-9]+")
result = filter.redact("Key API_KEY-abc123 exposed")
# Result: "Key [REDACTED] exposed"
```

---

## Debug Configurations

### Python Debugger

Use the built-in `pdb` debugger:

```python
import pdb; pdb.set_trace()

# Or with breakpoint() (Python 3.7+)
breakpoint()
```

### VS Code Debug Configuration

Create `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: Current File",
            "type": "debugpy",
            "request": "launch",
            "program": "${file}",
            "console": "integratedTerminal",
            "justMyCode": false
        },
        {
            "name": "Python: Pytest",
            "type": "debugpy",
            "request": "launch",
            "module": "pytest",
            "args": ["-v", "--no-header"],
            "console": "integratedTerminal",
            "justMyCode": false
        }
    ]
}
```

### Debugging State Machine

Inspect the scan state machine at any point:

```python
from mhcp_scanner.engine.state_machine import ScanStateMachine, ScanState

sm = ScanStateMachine()
sm.transition(ScanState.PREPARING)
sm.transition(ScanState.HASHING)

# Inspect current state
print(sm.current_state)      # ScanState.HASHING
print(sm.is_active)          # True
print(sm.is_terminal)        # False

# Inspect history
print(sm.history)
# [ScanState.IDLE, ScanState.PREPARING, ScanState.HASHING]

# Serialize for debugging
print(sm.to_dict())
```

### Debugging Results

```python
from mhcp_core.result import Ok, Err

result = Ok(42)
print(repr(result))    # Ok(42)
print(result.is_ok())  # True

result = Err(ValueError("bad"))
print(repr(result))    # Err(ValueError('bad'))
print(result.is_err()) # True
```

### Debugging Errors

```python
from mhcp_core.errors import HashError, Severity

err = HashError(
    message="SHA-256 failed",
    error_code="HASH_FAILED",
    severity=Severity.ERROR,
    recovery_suggestion="Check file permissions.",
)

# Structured representation
print(repr(err))
# HashError(error_code='HASH_FAILED', severity='error', message='SHA-256 failed')

# Serializable dictionary
print(err.to_dict())
# {'error_type': 'HashError', 'error_code': 'HASH_FAILED', 'message': 'SHA-256 failed', ...}
```

### Debugging Database Operations

```python
from mhcp_database.connection import DatabaseConnection

with DatabaseConnection(":memory:") as db:
    db.execute("CREATE TABLE t (id INTEGER)")
    db.execute("INSERT INTO t (id) VALUES (1)")

    # Inspect
    row = db.fetchone("SELECT * FROM t")
    print(row)  # {'id': 1}

    rows = db.fetchall("SELECT * FROM t")
    print(rows)  # [{'id': 1}]
```

---

## Performance Profiling

### cProfile

Profile function execution time:

```bash
python -m cProfile -s cumtime your_script.py
```

### Line Profiler

Profile individual lines:

```bash
pip install line_profiler

# Decorate function with @profile, then:
kernprof -l -v your_script.py
```

### pytest-benchmark

Run performance benchmarks:

```bash
# Single file benchmark
python -m pytest packages/scanner/benchmarks/test_pipeline_benchmarks.py \
    -v --benchmark-only

# Compare against baseline
python -m pytest benchmarks/ --benchmark-compare=baseline

# Set minimum rounds
python -m pytest benchmarks/ --benchmark-min-rounds=20
```

### Timing with the Logger

```python
from mhcp_logging.logger import get_logger

logger = get_logger(__name__)

with logger.timed("full scan"):
    for file_path in files:
        pipeline.scan_file(file_path)
```

### Using time.monotonic

For manual timing:

```python
import time

start = time.monotonic()
result = pipeline.scan_file(file_path)
elapsed = time.monotonic() - start
logger.performance(
    "scan completed",
    operation="scan_file",
    duration_ms=elapsed * 1000,
)
```

---

## Memory Profiling

### memory-profiler

```bash
pip install memory-profiler

# Profile a script
python -m memory_profiler your_script.py

# Profile a specific function
from memory_profiler import profile

@profile
def my_function():
    ...
```

### tracemalloc

Built-in memory tracing:

```python
import tracemalloc

tracemalloc.start()

# ... code to profile ...

snapshot = tracemalloc.take_snapshot()
top_stats = snapshot.statistics('lineno')

print("[ Top 10 memory consumers ]")
for stat in top_stats[:10]:
    print(stat)
```

### psutil

Monitor process memory:

```python
import psutil

process = psutil.Process()
memory_mb = process.memory_info().rss / (1024 * 1024)
print(f"Memory usage: {memory_mb:.1f} MB")
```

### Streaming Hash Computation

MHCP's `HashBackend` reads files in adaptive chunks, keeping memory usage constant regardless of file size. Verify this behavior:

```python
import tracemalloc
from mhcp_scanner.engine.backend import HashBackend
from mhcp_hashing.algorithm import HashAlgorithm

tracemalloc.start()

backend = HashBackend(HashAlgorithm.SHA256)
result = backend.compute_file(large_file_path)

current, peak = tracemalloc.get_traced_memory()
print(f"Peak memory: {peak / 1024:.1f} KB")
tracemalloc.stop()
```

---

## Troubleshooting Common Issues

### "No active connection" RuntimeError

**Cause:** `DatabaseConnection.connection` accessed before `connect()`.

```python
# Incorrect
db = DatabaseConnection(":memory:")
row = db.fetchone("SELECT 1")  # RuntimeError!

# Correct
db = DatabaseConnection(":memory:")
db.connect()
row = db.fetchone("SELECT 1")
db.close()
```

### "Unknown hash algorithm" ValueError

**Cause:** Passing an unsupported algorithm name to `HashAlgorithm.from_string()`.

```python
# Only these values are supported:
# "md5", "sha1", "sha256", "sha384", "sha512"
# or display names: "MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"
```

### Import Errors After Adding a New Package

**Cause:** Package not installed in editable mode.

```bash
pip install -e packages/new_package
```

### Type Errors from Mypy

**Cause:** Missing or incorrect type annotations.

```python
# Mypy will flag this:
def compute(x):  # Missing type annotation
    return x * 2

# Fix:
def compute(x: int) -> int:
    return x * 2
```

### Test Isolation Issues

**Cause:** Tests sharing state via module-level variables.

**Fix:** Use fixtures with function scope (default) and `tmp_path` for file system isolation.

### State Machine "Invalid Transition" Errors

**Cause:** Attempting a transition that is not in the state machine's transition table.

```python
# Invalid — IDLE -> HASHING is not allowed
sm = ScanStateMachine()
sm.transition(ScanState.HASHING)  # ValueError!

# Correct — follow the valid path
sm = ScanStateMachine()
sm.transition(ScanState.PREPARING)
sm.transition(ScanState.HASHING)
```

### CancellationHandler Thread Safety

The `CancellationHandler` is thread-safe but callbacks execute in the thread that calls `request_cancellation()`. Ensure callbacks are thread-safe if they update shared state:

```python
import threading

lock = threading.Lock()

def on_cancel() -> None:
    with lock:
        shared_state.cancelled = True

handler.add_callback(on_cancel)
```

---

## Known Limitations

1. **MD5 and SHA-1 are legacy algorithms.** They are supported for compatibility with existing threat intelligence databases but are not recommended for new deployments.

2. **In-memory database only for tests.** The `:memory:` SQLite database does not persist data across process restarts. Use file-based databases for production.

3. **Single-process hash computation.** `HashBackend.compute_file()` runs in the calling thread. Use the `Scheduler` or `MHCPFileScanner.scan_batch()` for parallel scanning.

4. **No automatic database updates.** Threat intelligence databases must be manually imported or updated via external scripts.

5. **Flutter desktop only.** The frontend is currently desktop-only. Web and mobile are not supported.

6. **Maximum file size.** Files larger than available disk space for temporary operations may cause issues. The streaming hash computation limits memory usage but not disk I/O.

---

## Getting Help

### Documentation

- [Developer Guide](developer_guide.md) — Development setup and workflows
- [Style Guide](style_guide.md) — Coding standards and conventions
- [Testing Guide](testing_guide.md) — Test writing and organization
- [Performance Guide](performance_guide.md) — Optimization and benchmarking
- [Security Guide](security_guide.md) — Security policies and practices
- [Accessibility Guide](accessibility_guide.md) — WCAG compliance
- [Plugin Development Guide](plugin_development_guide.md) — Extending MHCP
- [Release and Contributor Guide](release_contributor_guide.md) — Release process

### Resources

- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — Contribution guidelines
- [SECURITY.md](../../../SECURITY.md) — Security vulnerability reporting
- [GitHub Issues](https://github.com/placeholder/MalwareHashChecker-Pro/issues) — Bug reports and feature requests

### Debugging Checklist

When encountering an issue:

1. **Check the logs** — Enable debug logging with `get_logger(__name__)`.
2. **Inspect the state** — Use `to_dict()` methods on state machines, results, and errors.
3. **Run the test suite** — `python -m pytest -v` to see if tests pass.
4. **Check type errors** — `mypy packages/` for type-related issues.
5. **Run linter** — `ruff check packages/` for code quality issues.
6. **Profile if needed** — Use `cProfile` or `pytest-benchmark` for performance issues.
7. **Check the docs** — Search the documentation for known issues and workarounds.
8. **Ask for help** — Open a GitHub issue with reproduction steps and environment details.
