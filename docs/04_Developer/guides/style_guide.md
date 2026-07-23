# Code Style Guide

Coding standards, conventions, and best practices for the Malware Hash Checker Pro project.

## Table of Contents

- [Python Coding Standards](#python-coding-standards)
- [Type Hints](#type-hints)
- [Docstrings](#docstrings)
- [Naming Conventions](#naming-conventions)
- [Import Organization](#import-organization)
- [Error Handling Patterns](#error-handling-patterns)
- [Testing Conventions](#testing-conventions)
- [Git Conventions](#git-conventions)
- [File Organization](#file-organization)

---

## Python Coding Standards

### Formatter: Black

All Python code is formatted with **Black** (line length 88):

```bash
black packages/ tests/ scripts/
```

Black's opinionated formatting is final. Do not manually format code to work around Black.

### Linter: Ruff

All Python code is linted with **Ruff**. The project enables the following rule sets:

| Rule Set | Description |
|----------|-------------|
| `E`, `W` | pycodestyle errors and warnings |
| `F` | pyflakes |
| `I` | isort (import sorting) |
| `N` | pep8-naming |
| `UP` | pyupgrade (modern Python idioms) |
| `B` | flake8-bugbear |
| `A` | flake8-builtins |
| `C4` | flake8-comprehensions |
| `DTZ` | flake8-datetimez |
| `T20` | flake8-print |
| `SIM` | flake8-simplify |
| `TCH` | flake8-type-checking |
| `ARG` | flake8-unused-arguments |
| `PTH` | flake8-use-pathlib |
| `RUF` | ruff-specific rules |
| `S` | flake8-bandit (security) |
| `BLE` | flake8-blind-except |
| `FBT` | flake8-boolean-trap |
| `ICN` | flake8-import-conventions |
| `PIE` | flake8-pie |
| `PT` | flake8-pytest-style |
| `RSE` | flake8-raise |
| `RET` | flake8-return |
| `SLF` | flake8-self |
| `TRY` | tryceratops |
| `PERF` | perflint |
| `FURB` | refurb |
| `LOG` | flake8-logging |

### Line Length

Maximum line length is **88 characters** (Black default). Long strings and URLs may exceed this if Black cannot break them.

### String Quotes

Use **double quotes** for all strings (Black default):

```python
# Correct
message = "Hello, world!"
path = "/tmp/test.txt"

# Incorrect
message = 'Hello, world!'
```

### Imports

Always use `from __future__ import annotations` at the top of every module for PEP 604 union syntax and deferred evaluation:

```python
from __future__ import annotations
```

### F-Strings

Use f-strings for string formatting:

```python
# Correct
logger.info("Scanning %s", file_path)
label = f"Hash: {digest[:32]}..."

# Incorrect
label = "Hash: %s..." % digest[:32]
```

### pathlib over os.path

Use `pathlib.Path` for all file system operations (enforced by `PTH` rule):

```python
from pathlib import Path

# Correct
config_path = Path("config") / "settings.toml"
if config_path.exists():
    content = config_path.read_text(encoding="utf-8")

# Incorrect
import os
config_path = os.path.join("config", "settings.toml")
if os.path.exists(config_path):
    with open(config_path) as f:
        content = f.read()
```

### Context Managers

Use context managers for resource management:

```python
# Correct
with DatabaseConnection(":memory:") as db:
    db.execute("SELECT 1")

# Incorrect
db = DatabaseConnection(":memory:")
db.connect()
try:
    db.execute("SELECT 1")
finally:
    db.close()
```

---

## Type Hints

### Strict Mode

Mypy is configured in near-strict mode:

```toml
[tool.mypy]
python_version = "3.13"
disallow_untyped_defs = true
disallow_incomplete_defs = true
check_untyped_defs = true
no_implicit_optional = true
strict_equality = true
warn_return_any = true
warn_redundant_casts = true
warn_unused_ignores = true
```

### Function Signatures

All public functions must have complete type annotations:

```python
# Correct
def compute_hash(
    file_path: Path,
    algorithm: HashAlgorithm = HashAlgorithm.SHA256,
    chunk_size: int = 8192,
) -> str:
    ...

# Incorrect — missing parameter types
def compute_hash(file_path, algorithm="sha256", chunk_size=8192):
    ...
```

### Return Types

Always annotate return types explicitly:

```python
# Correct
def is_safe_path(path: str | Path) -> bool:
    ...

def get_all_records() -> list[HashRecord]:
    ...

# For functions that return None
def reset(self) -> None:
    ...
```

### Union Types

Use PEP 604 union syntax (`X | Y`) with `from __future__ import annotations`:

```python
# Correct
def find_record(hash_value: str) -> HashRecord | None:
    ...

# Incorrect
from typing import Optional
def find_record(hash_value: str) -> Optional[HashRecord]:
    ...
```

### TypeVar and Generics

```python
from typing import TypeVar, Generic

T = TypeVar("T")
E = TypeVar("E", bound=Exception)

class Result(Generic[T, E]):
    ...
```

### Protocol Types

Use `Protocol` for structural subtyping:

```python
from typing import Protocol

class HashLookupFn(Protocol):
    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]: ...
```

### Final Classes

Mark classes that should not be subclassed with `@final`:

```python
from typing import final

@final
class MHCError(Exception):
    ...
```

---

## Docstrings

### Google Style

All public APIs use **Google-style** docstrings:

```python
def compute_hash(
    file_path: Path,
    algorithm: HashAlgorithm = HashAlgorithm.SHA256,
    chunk_size: int = 8192,
) -> str:
    """Compute cryptographic hash of a file.

    Reads the file in chunks to handle large files efficiently.
    The file is never executed or loaded entirely into memory.

    Args:
        file_path: Path to the file to hash.
        algorithm: Hash algorithm to use.
        chunk_size: Size of read chunks in bytes.

    Returns:
        Hex-encoded hash string.

    Raises:
        FileNotFoundError: If the file does not exist.
        PermissionError: If the file cannot be read.
        HashError: If hash computation fails.

    Example::

        digest = compute_hash(Path("/tmp/suspect.bin"))
        print(f"SHA-256: {digest}")
    """
```

### Docstring Requirements

| Element | Required | Description |
|---------|----------|-------------|
| Module docstring | Yes | Brief module description and usage example |
| Class docstring | Yes | Brief class description and attributes |
| Public method docstring | Yes | Args, Returns, Raises, Example |
| Private method docstring | Optional | Brief description |
| Property docstring | Yes | Brief description of the property |
| Property setter docstring | No | Inherited from getter |

### Module Docstrings

Every module must have a module-level docstring:

```python
"""Error framework for Malware Hash Checker Pro.

Provides a comprehensive error hierarchy with structured error codes,
severity levels, and recovery suggestions for all MHC subsystems.

Example usage::

    from mhcp_core.errors import HashError, Severity

    raise HashError(
        message="SHA-256 computation failed on /tmp/suspicious.bin",
        error_code="HASH_COMPPUTE_FAILED",
        severity=Severity.ERROR,
        recovery_suggestion="Verify the file exists and is readable.",
    )
"""
```

### Example Sections

Include concrete examples in docstrings for complex APIs:

```python
class ScanStateMachine:
    """Finite state machine for tracking scan lifecycle.

    Example::

        sm = ScanStateMachine()
        sm.transition(ScanState.PREPARING)
        sm.transition(ScanState.HASHING)
        sm.transition(ScanState.COMPLETED)
        assert sm.is_terminal
    """
```

---

## Naming Conventions

### General Rules

| Element | Convention | Example |
|---------|-----------|---------|
| Module | `snake_case` | `path_safety.py` |
| Class | `PascalCase` | `ScanPipeline` |
| Function | `snake_case` | `compute_hash()` |
| Method | `snake_case` | `scan_file()` |
| Variable | `snake_case` | `file_path` |
| Constant | `UPPER_SNAKE_CASE` | `SHA256_EMPTY` |
| Enum member | `UPPER_SNAKE_CASE` | `HashAlgorithm.SHA256` |
| Enum value | `lowercase` | `"sha256"` |
| Private member | `_leading_underscore` | `_cache` |
| Type variable | `PascalCase` | `TypeVar("T")` |

### Specific Conventions

**Error classes** use descriptive suffixes:

```python
class HashError(MHCError): ...
class DatabaseError(MHCError): ...
class SecurityError(MHCError): ...
```

**Test classes** follow `Test<Subject>`:

```python
class TestHashAlgorithmValues: ...
class TestScanStateEnum: ...
class TestComputeHash: ...
```

**Test methods** follow `test_<behavior>` or `test_<condition>`:

```python
def test_md5_value(self) -> None: ...
def test_sha256_is_recommended(self) -> None: ...
def test_empty_file_returns_known_hash(self) -> None: ...
def test_file_not_found_raises_error(self) -> None: ...
```

**Fixture names** use descriptive `snake_case`:

```python
@pytest.fixture()
def sample_file(tmp_path: Path) -> Path: ...

@pytest.fixture()
def populated_db(in_memory_db: DatabaseConnection) -> DatabaseConnection: ...

@pytest.fixture()
def hash_lookup_fn(populated_db: DatabaseConnection) -> Callable: ...
```

---

## Import Organization

Imports are sorted by **isort** (via Ruff) with the following configuration:

```toml
[tool.ruff.lint.isort]
known-first-party = [
    "mhcp_core",
    "mhcp_hashing",
    "mhcp_scanner",
    "mhcp_database",
    "mhcp_security",
    "mhcp_logging",
    "mhcp_reports",
    "mhcp_config",
]
```

### Import Order

```python
# 1. Future imports
from __future__ import annotations

# 2. Standard library imports
import hashlib
from pathlib import Path
from typing import Any, Callable

# 3. Third-party imports
import pytest

# 4. First-party imports (MHCP packages)
from mhcp_core.errors import HashError, MHCError, Severity
from mhcp_core.result import Result, Ok, Err
from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline
```

### Import Style

Prefer explicit imports over wildcard imports:

```python
# Correct
from mhcp_core.errors import HashError, Severity
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline

# Incorrect
from mhcp_core.errors import *
from mhcp_scanner.engine import *
```

### TYPE_CHECKING Guard

Use `TYPE_CHECKING` for imports used only in type annotations:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mhcp_database.connection import DatabaseConnection
```

---

## Error Handling Patterns

### Result Type

Use `Result[T, E]` for operations that can fail predictably:

```python
from mhcp_core.result import Result, Ok, Err

def parse_hash(raw: str) -> Result[str, ValueError]:
    if len(raw) not in (32, 40, 64, 64, 128):
        return Err(ValueError(f"Invalid length: {len(raw)}"))
    if not all(c in "0123456789abcdef" for c in raw):
        return Err(ValueError("Non-hex characters"))
    return Ok(raw)

# Pipeline usage
result = parse_hash("a" * 64)
value = result.unwrap_or("invalid")
```

### Chaining with flat_map

```python
from mhcp_core.result import Result, Ok, Err

def validate(x: int) -> Result[int, ValueError]:
    if x > 0:
        return Ok(x)
    return Err(ValueError("must be positive"))

result: Result[int, ValueError] = Ok(5)
output = result.map(abs).flat_map(validate).unwrap()
```

### MHCError Hierarchy

Always use the most specific error type:

```python
# Correct — specific error type
raise HashError(
    message="SHA-256 computation failed",
    error_code="HASH_FAILED",
    severity=Severity.ERROR,
    recovery_suggestion="Check file permissions.",
)

# Incorrect — generic base class
raise MHCError("SHA-256 computation failed")
```

### Error Codes

Use descriptive, SCREAMING_SNAKE_CASE error codes:

```python
"HASH_COMPUTE_FAILED"     # Hash computation failure
"DB_CONNECTION_LOST"       # Database connection error
"PATH_TRAVERSAL_DETECTED"  # Security violation
"CONFIG_FILE_MISSING"      # Configuration error
"SCAN_CANCELLED"           # Scan was cancelled
```

### Severity Levels

| Level | Usage |
|-------|-------|
| `CRITICAL` | Unrecoverable, requires immediate termination |
| `ERROR` | Operation failed, application continues |
| `WARNING` | Non-fatal, may affect results |
| `INFO` | Informational, no action required |

---

## Testing Conventions

### Test Structure

Tests are organized by subject, not by implementation detail:

```python
class TestHashAlgorithmValues:
    """Verify enum members exist with expected values."""

    def test_md5_value(self) -> None:
        assert HashAlgorithm.MD5.value == "md5"

    def test_sha1_value(self) -> None:
        assert HashAlgorithm.SHA1.value == "sha1"
```

### Test Markers

Use the appropriate marker for each test:

```python
@pytest.mark.unit
def test_parse_hash_valid() -> None:
    ...

@pytest.mark.integration
def test_scan_with_database(populated_db) -> None:
    ...

@pytest.mark.security
def test_path_traversal_blocked() -> None:
    ...

@pytest.mark.slow
def test_large_file_hash() -> None:
    ...
```

### Parametrized Tests

Use `@pytest.mark.parametrize` for testing multiple inputs:

```python
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
    algorithm: HashAlgorithm, digest_bytes: int, hex_chars: int
) -> None:
    assert algorithm.digest_size == digest_bytes
    assert algorithm.hex_digest_length == hex_chars
```

### Test Docstrings

Every test method must have a docstring explaining what it tests:

```python
def test_known_malicious_verdict(self) -> None:
    """When lookup returns matching records, verdict is KNOWN_MALICIOUS."""
    gen = VerdictGenerator()
    records = [{"threat_type": "trojan", "severity": "high"}]
    verdict = gen.generate(lookup_results=records)
    assert verdict.verdict_type is VerdictType.KNOWN_MALICIOUS
```

### Assertions

Use descriptive assertions with messages:

```python
# Correct
assert len(results) == 5, f"Expected 5 results, got {len(results)}"

# Incorrect — no message
assert len(results) == 5
```

---

## Git Conventions

### Branch Naming

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/sha512-computation` |
| `fix/` | Bug fixes | `fix/path-traversal-check` |
| `docs/` | Documentation | `docs/developer-guide` |
| `refactor/` | Code refactoring | `refactor/pipeline-stages` |
| `test/` | Test additions | `test/database-connection` |
| `security/` | Security fixes | `security/dependency-audit` |
| `accessibility/` | A11y improvements | `accessibility/keyboard-nav` |
| `chore/` | Maintenance | `chore/update-deps` |

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer(s)]
```

**Types**:
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `style` — Formatting, no code change
- `refactor` — Code refactoring
- `test` — Adding or updating tests
- `chore` — Maintenance tasks
- `security` — Security fix
- `accessibility` — Accessibility improvement

**Scope** (optional): the package or component affected:
`core`, `hashing`, `scanner`, `database`, `security`, `logging`, `config`, `reports`, `ui`, `deps`

**Examples**:

```
feat(hashing): add SHA-512 hash computation

fix(scanner): prevent path traversal in file resolution

docs(api): update hash computation API documentation

security(deps): update cryptography to patch CVE-2024-XXXX

test(database): add connection pool integration tests

refactor(core): simplify Result type generics

chore: update pre-commit hooks
```

### Pull Requests

- Link a related issue
- Include tests for new functionality
- Update documentation if public API changes
- All CI checks must pass before merge
- Squash-merge after approval

---

## File Organization

### Maximum Lengths

| Element | Maximum |
|---------|---------|
| Function/method | 50 lines |
| File | 500 lines |

### Module Structure

Organize modules from general to specific:

```python
"""Module docstring."""

from __future__ import annotations

# Standard library imports
import hashlib
from pathlib import Path

# Third-party imports
import pytest

# First-party imports
from mhcp_core.errors import HashError

# Constants
MAX_CHUNK_SIZE = 1024 * 1024

# Type aliases
HashDict = dict[str, str]

# Classes
class MyClass:
    ...

# Functions
def my_function() -> None:
    ...

# Entry point
if __name__ == "__main__":
    main()
```

### Dataclass Ordering

For dataclasses, define fields in this order:

```python
@dataclass
class HashRecord:
    # Required fields
    hash_value: str
    algorithm: str

    # Optional fields with defaults
    source: str = ""
    threat_type: str = "unknown"
    severity: str = "unknown"

    # Complex defaults
    metadata: dict[str, Any] = field(default_factory=dict)
```

### Enum Ordering

Order enum members logically:

```python
class HashAlgorithm(Enum):
    # Legacy algorithms first (least preferred)
    MD5 = "md5"
    SHA1 = "sha1"

    # Recommended algorithms (most preferred)
    SHA256 = "sha256"
    SHA384 = "sha384"
    SHA512 = "sha512"
```

### Test File Organization

Test files mirror the source module structure:

```
packages/scanner/src/mhcp_scanner/engine/
├── backend.py          → packages/scanner/tests/engine/test_backend.py
├── pipeline.py         → packages/scanner/tests/engine/test_pipeline.py
├── state_machine.py    → packages/scanner/tests/engine/test_state_machine.py
├── verdict.py          → packages/scanner/tests/engine/test_verdict.py
├── cancellation.py     → packages/scanner/tests/engine/test_cancellation.py
├── progress.py         → packages/scanner/tests/engine/test_progress.py
├── session.py          → packages/scanner/tests/engine/test_session.py
├── scheduler.py        → packages/scanner/tests/engine/test_scheduler.py
├── repository.py       → packages/scanner/tests/engine/test_repository.py
├── results.py          → packages/scanner/tests/engine/test_results.py
└── file_scanner.py     → packages/scanner/tests/engine/test_file_scanner.py
```
