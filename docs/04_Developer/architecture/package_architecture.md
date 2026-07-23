# Package Architecture

> Detailed architecture for each package in the MHCP monorepo.

## 1. `mhcp-core` — Foundation Types

**Path:** `packages/core/`
**PyPI name:** `mhcp-core`
**Dependencies:** none

### Responsibility

Provides the foundational types used by every other package. Contains zero business logic — only type definitions and utility classes.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `MHCError` | `@final class(Exception)` | Base exception with `error_code`, `severity`, `recovery_suggestion` |
| `ApplicationError` | `@final class(MHCError)` | General application errors |
| `ConfigurationError` | `@final class(MHCError)` | Config loading/validation errors |
| `DatabaseError` | `@final class(MHCError)` | Database connectivity/query errors |
| `FilesystemError` | `@final class(MHCError)` | File I/O errors |
| `HashError` | `@final class(MHCError)` | Hash computation/comparison errors |
| `ScannerError` | `@final class(MHCError)` | Scan subsystem errors |
| `SecurityError` | `@final class(MHCError)` | Security policy violation errors |
| `ValidationError` | `@final class(MHCError)` | Input/data validation errors |
| `Severity` | `Enum` | `CRITICAL`, `ERROR`, `WARNING`, `INFO` |
| `Result[T, E]` | `Generic[T, E]` | Abstract base for `Ok`/`Err` discriminated union |
| `Ok[T]` | `@final class(Result)` | Success variant |
| `Err[E]` | `@final class(Result)` | Failure variant |

### Internal Structure

```
packages/core/
  src/
    mhcp_core/
      __init__.py       # Re-exports all public symbols
      errors.py         # MHCError hierarchy + Severity enum
      result.py         # Result[T, E], Ok[T], Err[E]
  tests/
    test_errors.py      # Error hierarchy tests
    test_result.py      # Result monad tests
  pyproject.toml
```

### Error Hierarchy

```
Exception
  └── MHCError
        ├── ApplicationError
        ├── ConfigurationError
        ├── DatabaseError
        ├── FilesystemError
        ├── HashError
        ├── ScannerError
        ├── SecurityError
        └── ValidationError
```

All error classes are `@final` — they cannot be subclassed outside this package. This prevents error hierarchy pollution across package boundaries.

### Result Monad API

```python
result.is_ok()          # bool
result.is_err()         # bool
result.unwrap()         # T | raises Err
result.unwrap_or(T)     # T
result.map(fn)          # Result[U, E]
result.flat_map(fn)     # Result[U, E]
result.map_err(fn)      # Result[T, Any]
Result.from_optional(value, error)  # Result[T, E]
```

### Extension Points

None — this package is intentionally minimal and closed for extension.

---

## 2. `mhcp-hashing` — Hash Computation

**Path:** `packages/hashing/`
**PyPI name:** `mhcp-hashing`
**Dependencies:** `mhcp-core`

### Responsibility

Defines the `HashAlgorithm` enum and provides abstractions for hash computation. Supports streaming chunk-based processing for large files.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `HashAlgorithm` | `Enum` | `MD5`, `SHA1`, `SHA256`, `SHA384`, `SHA512` |
| `HashAlgorithm.display_name` | property | Human-readable name (e.g., "SHA-256") |
| `HashAlgorithm.digest_size` | property | Digest size in bytes |
| `HashAlgorithm.hex_digest_length` | property | Expected hex string length |
| `HashAlgorithm.is_recommended` | property | True for SHA-2 family |
| `HashAlgorithm.is_legacy` | property | True for MD5, SHA-1 |
| `HashAlgorithm.from_string()` | classmethod | Parse from string (case/space insensitive) |
| `HashAlgorithm.supported_algorithms()` | classmethod | List all members |
| `HashComputer` | abstract class | Base class for hash computation backends |

### Algorithm Properties

| Algorithm | Value | Digest (bytes) | Hex Length | Recommended | Legacy |
|---|---|---|---|---|---|
| `MD5` | `"md5"` | 16 | 32 | No | Yes |
| `SHA1` | `"sha1"` | 20 | 40 | No | Yes |
| `SHA256` | `"sha256"` | 32 | 64 | Yes | No |
| `SHA384` | `"sha384"` | 48 | 96 | Yes | No |
| `SHA512` | `"sha512"` | 64 | 128 | Yes | No |

### Internal Structure

```
packages/hashing/
  lib/
    src/
      algorithm.py       # HashAlgorithm enum
      computer.py        # HashComputer abstract base
      validator.py       # Hash digest validation
  tests/
    test_algorithm.py    # Algorithm property tests
    test_validator.py    # Validator tests
  pyproject.toml
```

### Extension Points

- **Custom algorithms:** Subclass `HashComputer` to implement custom hash backends (e.g., HMAC-SHA256, BLAKE3).
- **Runtime registration:** `HashAlgorithm.register()` adds new members dynamically.

---

## 3. `mhcp-scanner` — Scan Engine

**Path:** `packages/scanner/`
**PyPI name:** `mhcp-scanner`
**Dependencies:** `mhcp-core`, `mhcp-hashing`, (optional: `mhcp-database`, `mhcp-security`)

### Responsibility

Orchestrates the complete file scanning workflow: validation, metadata extraction, hash computation, database lookup, verdict generation, and cleanup.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `ScanPipeline` | class | 6-stage scan pipeline orchestrator |
| `PipelineConfig` | dataclass | Pipeline configuration (algorithms, timeouts, etc.) |
| `HashBackend` | class | Streaming hash computation backend |
| `ScanStateMachine` | class | 9-state finite state machine for scan lifecycle |
| `ScanState` | Enum | `IDLE`, `PREPARING`, `HASHING`, `LOOKING_UP`, `GENERATING_VERDICT`, `COMPLETED`, `FAILED`, `CANCELLED`, `RECOVERING` |
| `ScanSession` | class | Session tracking (IDs, timestamps, warnings, errors, hashes) |
| `CancellationHandler` | class | Thread-safe cooperative cancellation |
| `CancelledError` | class | Raised when cancellation is detected |
| `ProgressTracker` | class | Progress tracking with stages, percentages, byte counts |
| `ProgressStage` | Enum | `IDLE`, `PREPARING`, `HASHING`, `LOOKUP`, `VERDICT`, `COMPLETE` |
| `ProgressUpdate` | dataclass | Stage + percentage + total_bytes snapshot |
| `VerdictGenerator` | class | Maps lookup results to verdicts |
| `Verdict` | dataclass | Verdict type + evidence + limitations + human_readable |
| `VerdictType` | Enum | `KNOWN_MALICIOUS`, `UNKNOWN`, `CLEAN` |
| `VerdictEvidence` | dataclass | Matched records from lookup |
| `Scheduler` | class | Priority-based scan request scheduling |
| `ScanPriority` | Enum | `LOW`, `NORMAL`, `HIGH`, `CRITICAL` |
| `ScanRequest` | dataclass | File path + priority + request_id |
| `ScanResult` | dataclass | File path + status + hashes |
| `HashRecordRepository` | class | Database lookup adapter |

### Internal Structure

```
packages/scanner/
  lib/
    src/
      engine/
        __init__.py
        pipeline.py          # ScanPipeline, PipelineConfig
        backend.py           # HashBackend (streaming)
        state_machine.py     # ScanStateMachine, ScanState
        session.py           # ScanSession, PerformanceMetrics, ScanWarning
        cancellation.py      # CancellationHandler, CancelledError
        progress.py          # ProgressTracker, ProgressStage, ProgressUpdate
        verdict.py           # VerdictGenerator, Verdict, VerdictType, VerdictEvidence
        scheduler.py         # Scheduler, ScanPriority, ScanRequest, ScanResult
        repository.py        # HashRecordRepository
  tests/
    engine/
      test_pipeline.py
      test_backend.py
      test_state_machine.py
      test_session.py
      test_cancellation.py
      test_progress.py
      test_verdict.py
      test_scheduler.py
      test_repository.py
      test_integration.py
      test_results.py
    test_scanner.py
    test_path_resolver.py
  benchmarks/
    test_pipeline_benchmarks.py
    test_hash_benchmarks.py
  pyproject.toml
```

### ScanStateMachine States

```
                    +----------+
                    |   IDLE   |
                    +----+-----+
                         |
                    transition()
                         |
                    +----v--------+
                    |  PREPARING  |
                    +----+--------+
                         |
              +----------+----------+
              |                     |
         transition()          transition()
              |                     |
        +-----v------+      +------v-------+
        |   HASHING   |      |  CANCELLED   |  (terminal)
        +-----+------+      +--------------+
              |
         transition()
              |
        +-----v-----------+
        |   LOOKING_UP     |
        +-----+-----------+
              |
         transition()
              |
        +-----v----------------+
        | GENERATING_VERDICT    |
        +-----+----------------+
              |
     +--------+--------+
     |        |        |
transition() |   transition()
     |        |        |
+----v---+ +--v----+ +------v-------+
|COMPLETED| |FAILED | |  RECOVERING  |
|(terminal)| |(terminal)| +------+----+
+---------+ +---------+        |
                          transition()
                               |
                          +----v--------+
                          |  PREPARING  |
                          +-------------+
```

### Pipeline Stages

| Stage | Input | Output | Cancellable |
|---|---|---|---|
| Validate | File path | `PathSafetyResult` | Yes |
| Metadata | File path | `file_size`, `mtime`, `entropy` | Yes |
| Hash | File path + algorithms | `dict[str, str]` (algo -> hex digest) | Yes |
| Lookup | `dict[str, str]` | `list[dict]` (matched records) | Yes |
| Verdict | Lookup results | `Verdict` | Yes |
| Cleanup | Scan session | Updated session state | No |

### Extension Points

- **Custom verdict generators:** Subclass `VerdictGenerator` to add heuristic or policy-based verdict logic.
- **Custom lookup providers:** Any callable with signature `(hashes: dict[str, str]) -> list[dict[str, Any]]` can be passed as `lookup_fn` to `ScanPipeline`.
- **Custom hash backends:** Subclass `HashComputer` from `mhcp-hashing` and inject into the pipeline.

---

## 4. `mhcp-database` — Persistence Layer

**Path:** `packages/database/`
**PyPI name:** `mhcp-database`
**Dependencies:** `mhcp-core`

### Responsibility

Manages SQLite database connections with WAL mode, provides ORM-like models for hash records and scan results, and exposes repository abstractions for data access.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `DatabaseConnection` | class | SQLite connection with WAL, transactions, context manager |
| `HashRecord` | dataclass | Hash database record (hash_value, algorithm, source, threat_type, severity, first_seen, last_seen, metadata) |
| `ScanResult` | dataclass | Scan result record |
| `DatabaseMetadata` | dataclass | Database version and metadata |
| `BaseRepository` | class | Abstract repository with CRUD operations |

### Internal Structure

```
packages/database/
  lib/
    src/
      connection.py     # DatabaseConnection (SQLite WAL)
      models.py         # HashRecord, ScanResult, DatabaseMetadata
      repository.py     # BaseRepository
      schema.py         # DDL definitions, migrations
  tests/
    test_connection.py  # Connection lifecycle, WAL, transactions
    test_repository.py  # Repository CRUD tests
  pyproject.toml
```

### Database Schema

```sql
CREATE TABLE hash_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    hash_value    TEXT NOT NULL,
    algorithm     TEXT NOT NULL,
    source        TEXT,
    threat_type   TEXT,
    severity      TEXT,
    first_seen    TEXT,
    last_seen     TEXT,
    metadata      TEXT
);

CREATE INDEX idx_hash_value ON hash_records (hash_value);
CREATE INDEX idx_algorithm  ON hash_records (algorithm);
```

### Extension Points

- **Custom repositories:** Subclass `BaseRepository` to add query methods or caching layers.
- **Migration system:** Schema versioning tracked in `DatabaseMetadata` table.

---

## 5. `mhcp-security` — Security Utilities

**Path:** `packages/security/`
**PyPI name:** `mhcp-security`
**Dependencies:** `mhcp-core`

### Responsibility

Provides path safety validation, file permission checking, and signature verification to prevent path traversal attacks, unauthorized access, and tampered packages.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `is_safe_path(path)` | function | Returns `True` if path has no traversal/null bytes |
| `sanitize_path(path)` | function | Returns `PathSafetyResult` with sanitized path and issues |
| `PathSafetyResult` | dataclass | `is_safe`, `sanitised`, `issues` |
| `SignatureVerifier` | class | Verify package signatures |
| `FilePermissionInfo` | class | Inspect file permissions (owner, mode, readable) |

### Path Safety Checks

| Check | Description |
|---|---|
| Null bytes | Detects `\x00` in path components |
| Traversal | Detects `../` sequences escaping allowed directories |
| Symbolic links | Detects and reports symlinks |
| Control characters | Detects non-printable characters (except tab/newline) |

### Internal Structure

```
packages/security/
  lib/
    src/
      path_safety.py        # is_safe_path, sanitize_path, PathSafetyResult
      file_permissions.py   # FilePermissionInfo
      signature.py          # SignatureVerifier
  tests/
    test_path_safety.py     # Path safety tests
    test_file_permissions.py # Permission tests
  pyproject.toml
```

### Extension Points

- **Custom safety rules:** Add new checks to `sanitize_path` by extending the validation pipeline.
- **Custom signature backends:** Implement additional verification methods in `SignatureVerifier`.

---

## 6. `mhcp-logging` — Structured Logging

**Path:** `packages/logging/`
**PyPI name:** `mhcp-logging`
**Dependencies:** none (standalone)

### Responsibility

Provides structured logging with category-based routing, PII redaction, performance timing, and audit trail support.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `MHCPLogger` | class | Logger wrapper with domain-specific methods |
| `get_logger(name, level)` | function | Factory returning cached `MHCPLogger` instances |
| `LogCategory` | Enum | `APPLICATION`, `DEBUG`, `AUDIT`, `PERFORMANCE`, `SECURITY` |
| `_Timer` | context manager | Automatic performance timing |

### Logger Methods

| Method | Extra Fields | Level |
|---|---|---|
| `debug(msg)` | — | DEBUG |
| `info(msg)` | — | INFO |
| `warning(msg)` | — | WARNING |
| `error(msg)` | — | ERROR |
| `critical(msg)` | — | CRITICAL |
| `audit(msg, actor, action, result)` | `actor`, `action`, `result` | WARNING |
| `performance(msg, operation, duration_ms)` | `operation`, `duration_ms` | INFO |
| `security(msg, threat_type, severity)` | `threat_type`, `severity` | WARNING |
| `timed(label)` | — | context manager |

### Internal Structure

```
packages/logging/
  lib/
    src/
      logger.py          # MHCPLogger, get_logger, _Timer
      redaction.py       # PII redaction filters
      categories.py      # LogCategory enum
  tests/
    test_logger.py       # Logger method tests
    test_redaction.py    # Redaction tests
  pyproject.toml
```

### Extension Points

- **Custom redaction rules:** Add patterns to `redaction.py` for domain-specific PII.
- **Custom log handlers:** Attach additional handlers to the underlying `logging.Logger`.

---

## 7. `mhcp-config` — Configuration Management

**Path:** `packages/config/`
**PyPI name:** `mhcp-config`
**Dependencies:** none (standalone)

### Responsibility

Schema-based configuration management with TOML file loading, environment variable overrides, validation, and persistence.

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `ConfigurationManager` | class | Load, validate, read, write, save configuration |
| `ConfigSchema` | class | Define and validate configuration schemas |
| `FieldDefinition` | dataclass | Field metadata (name, type, default, validators) |
| `FieldType` | Enum | `STRING`, `INTEGER`, `BOOLEAN`, `LIST` |
| `DEFAULT_CONFIG` | dict | Built-in default configuration values |

### Configuration Schema Example

```python
schema = ConfigSchema()
schema.add_section("logging")
schema.add_field("logging", FieldDefinition(
    name="level",
    field_type=FieldType.STRING,
    default="INFO",
    validators=[lambda v: None if v in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL") else ...],
))
```

### Environment Variable Overrides

Environment variables override config file values using the pattern `MCP_<SECTION>__<KEY>`:

```
MCP_LOGGING__LEVEL=DEBUG
MCP_SECURITY__API_TIMEOUT_SECONDS=120
```

### Internal Structure

```
packages/config/
  lib/
    src/
      manager.py        # ConfigurationManager
      schema.py          # ConfigSchema, FieldDefinition, FieldType
      defaults.py        # DEFAULT_CONFIG
      migration.py       # Config version migration
  tests/
    test_manager.py      # Manager tests
    test_schema.py       # Schema validation tests
  pyproject.toml
```

### Extension Points

- **Custom validators:** Add lambda validators to `FieldDefinition` for domain-specific rules.
- **Config migration:** Register migration functions for schema version upgrades.

---

## 8. `mhcp-reports` — Report Generation

**Path:** `packages/reports/`
**PyPI name:** `mhcp-reports`
**Dependencies:** `mhcp-core`

### Responsibility

Generates scan reports in multiple output formats (JSON, CSV, HTML, PDF, XML, Text).

### Public API Surface

| Export | Kind | Description |
|---|---|---|
| `OutputFormat` | Enum | `JSON`, `CSV`, `HTML`, `PDF`, `TEXT`, `XML` |
| `OutputFormat.file_extension` | property | e.g., `.json`, `.csv` |
| `OutputFormat.mime_type` | property | e.g., `application/json` |
| `ReportGenerator` | class | Format-agnostic report builder |

### Supported Formats

| Format | Extension | MIME Type | Use Case |
|---|---|---|---|
| JSON | `.json` | `application/json` | API integration, automation |
| CSV | `.csv` | `text/csv` | Spreadsheet analysis |
| HTML | `.html` | `text/html` | Browser viewing |
| PDF | `.pdf` | `application/pdf` | Archival, printing |
| TEXT | `.txt` | `text/plain` | Terminal output, logs |
| XML | `.xml` | `application/xml` | Enterprise integration |

### Internal Structure

```
packages/reports/
  lib/
    src/
      formats.py        # OutputFormat enum
      generator.py       # ReportGenerator
      templates/         # HTML/XML templates
  tests/
    test_formats.py      # Format property tests
  pyproject.toml
```

### Extension Points

- **Custom formats:** Add new members to `OutputFormat` and implement corresponding renderer.
- **Custom templates:** Override HTML/XML templates for branding.

---

## 9. `mhcp-ui` — Shared UI Components

**Path:** `packages/ui/` (Python) + `apps/` (Flutter/Dart)
**PyPI name:** `mhcp-ui`
**Dependencies:** none (Python placeholder), Flutter framework (Dart)

### Responsibility

Provides shared UI components for the Flutter desktop frontend and Python-side UI helpers (accessibility, notifications).

### Internal Structure

```
packages/ui/
  lib/
    src/                # Python UI helpers (placeholder)
  tests/
  pyproject.toml

apps/
  flutter/
    lib/
      src/
        dashboard/      # Scan dashboard widgets
        progress/       # Real-time progress display
        reports/        # Report viewer
        settings/       # Settings panel
        notifications/  # Toast/notification system
        accessibility/  # Screen reader support
    pubspec.yaml
```

### Extension Points

- **Custom widgets:** Add new Flutter widgets in `apps/flutter/lib/src/`.
- **Theme system:** Custom themes via the theme manager.
