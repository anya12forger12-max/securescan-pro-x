# System Overview

> Malware Hash Checker Pro — Architecture & Design

## 1. Project Goals & Principles

Malware Hash Checker Pro (MHCP) is a **privacy-first cybersecurity tool** that identifies known malware by computing file hashes and cross-referencing them against threat intelligence databases. No file content ever leaves the user's machine unless the user explicitly opts in to an external lookup provider.

### Core Principles

| Principle | Description |
|---|---|
| **Privacy by Default** | All hashing and local database lookups occur entirely offline. External providers are opt-in only. |
| **Clean Architecture** | Domain logic is isolated from infrastructure concerns. Every package depends inward toward the core. |
| **Monadic Error Handling** | The `Result[T, E]` type replaces exception-driven control flow, making error paths explicit and composable. |
| **Structured Errors** | `MHCError` hierarchy carries machine-readable error codes, severity levels, and recovery suggestions. |
| **Extensibility** | Custom hash algorithms, verdict generators, and threat intelligence providers can be plugged in at runtime. |
| **Cross-Platform** | Python 3.13+ backend powers the scan engine; Flutter desktop frontend provides a native UI on Windows, macOS, and Linux. |
| **Testability** | Every component can be tested in isolation with in-memory databases, mock providers, and deterministic test vectors. |

---

## 2. Architecture Overview (Clean Architecture)

MHCP follows a strict four-layer Clean Architecture arrangement. Dependencies flow **inward** only — outer layers may depend on inner layers, never the reverse.

```
+=====================================================================+
|                     PRESENTATION LAYER                              |
|                                                                     |
|   Flutter Desktop UI (Dart)        Shared UI Components (Python)    |
|   - Scan dashboard                 - Accessibility helpers          |
|   - Real-time progress             - Status bar widgets             |
|   - Report viewer                  - Notification system            |
|   - Settings panel                                                |
+=====================================================================+
          |  communicates via IPC / FFI / REST
          v
+=====================================================================+
|                     APPLICATION LAYER                               |
|                                                                     |
|   Scanner Engine                Configuration Manager               |
|   - ScanPipeline (6-stage)      - ConfigurationManager              |
|   - Scheduler                   - ConfigSchema + validation         |
|   - ScanSession                 - Environment variable overrides    |
|   - ProgressTracker                                               |
|   - CancellationHandler                                             |
|   - ScanStateMachine (9 states)                                    |
+=====================================================================+
          |  depends on
          v
+=====================================================================+
|                       DOMAIN LAYER                                  |
|                                                                     |
|   Core Types                   Hashing                             |
|   - Result[T, E] (Ok/Err)     - HashAlgorithm enum                 |
|   - MHCError hierarchy         - HashBackend (streaming)            |
|   - Severity enum              - HashComputer (abstract)            |
|                                                                     |
|   Verdict                      Database                            |
|   - VerdictGenerator           - DatabaseConnection (SQLite WAL)    |
|   - VerdictType                - HashRecord / ScanResult models     |
|   - VerdictEvidence            - BaseRepository                     |
|                                                                     |
|   Security                     Reports                             |
|   - SignatureVerifier          - OutputFormat enum                  |
|   - PathSafetyResult           - ReportGenerator                    |
|   - FilePermissionInfo         - JSON / CSV / HTML / PDF / XML      |
+=====================================================================+
          |  implemented by
          v
+=====================================================================+
|                   INFRASTRUCTURE LAYER                              |
|                                                                     |
|   Logging                    Filesystem                            |
|   - MHCPLogger               - FilePermissionInfo                  |
|   - LogCategory              - Path safety checks                  |
|   - PII redaction            - Adaptive chunk reading              |
|                                                                     |
|   External Providers         Persistence                           |
|   - Threat intel APIs        - SQLite WAL mode                     |
|   - Custom hash backends     - WAL journaling                      |
|   - Plugin system            - Connection pooling                  |
+=====================================================================+
```

### Layer Responsibilities

| Layer | Responsibility | Packages |
|---|---|---|
| **Presentation** | User interaction, rendering, input handling | `ui` (Flutter + Python shared components) |
| **Application** | Use-case orchestration, workflow control | `scanner` (pipeline, scheduler, session) |
| **Domain** | Business rules, entities, value objects | `core`, `hashing`, `database` (models), `security`, `reports` |
| **Infrastructure** | I/O, external systems, platform integration | `logging`, `config`, `database` (connection), `reports` (rendering) |

---

## 3. Package Dependency Graph

```
                        mhcp-core
                       /    |    \
                      /     |     \
              mhcp-hashing  |  mhcp-security
                     \      |      /
                      \     |     /
                    mhcp-scanner
                   /     |     \
                  /      |      \
        mhcp-database  mhcp-logging  mhcp-config
                \        |        /
                 \       |       /
                  mhcp-reports
                       |
                  mhcp-ui (Flutter + Python)
```

### Dependency Rules

1. **`mhcp-core`** depends on **nothing** — it is the innermost package.
2. **`mhcp-hashing`**, **`mhcp-security`**, **`mhcp-logging`**, **`mhcp-config`** depend only on `mhcp-core`.
3. **`mhcp-scanner`** depends on `mhcp-core`, `mhcp-hashing`, and optionally `mhcp-database` and `mhcp-security`.
4. **`mhcp-database`** depends on `mhcp-core`.
5. **`mhcp-reports`** depends on `mhcp-core`.
6. **`mhcp-ui`** depends on all application-layer packages via IPC/FFI boundaries.
7. **No circular dependencies** are permitted. Enforced by `pyproject.toml` dependency declarations.

---

## 4. Data Flow Overview

A high-level view of what happens when a user scans a file:

```
User selects file
       |
       v
  [1] VALIDATE          Path safety, null bytes, traversal, permissions
       |
       v
  [2] METADATA          File size, modification time, entropy
       |
       v
  [3] HASH              Streaming multi-algorithm hash computation
       |
       v
  [4] LOOKUP            Cross-reference hashes against local DB / remote providers
       |
       v
  [5] VERDICT           Classify as KNOWN_MALICIOUS / UNKNOWN / CLEAN
       |
       v
  [6] CLEANUP           Release resources, update session, persist results
       |
       v
  Report generated      JSON / CSV / HTML / PDF / XML / Text
```

Each stage is cancellable. The `CancellationHandler` checks between stages and raises `CancelledError` if cancellation was requested. The `ProgressTracker` emits updates at every stage boundary.

---

## 5. Technology Stack

### Backend (Python 3.13+)

| Component | Technology |
|---|---|
| Language | Python 3.13+ with full type hints |
| Build System | Hatch (hatchling) |
| Hashing | `hashlib` (stdlib) with streaming chunk processing |
| Database | SQLite 3 with WAL journaling |
| Testing | pytest + pytest-cov |
| Linting | ruff, mypy (strict mode) |
| Error Handling | Custom `Result[T, E]` monad + `MHCError` hierarchy |
| Configuration | TOML files with schema validation |
| Logging | Structured logging with PII redaction |

### Frontend (Flutter)

| Component | Technology |
|---|---|
| Framework | Flutter 3.x (desktop) |
| Language | Dart 3.x |
| State Management | Provider / Riverpod |
| Platform Support | Windows, macOS, Linux |
| IPC | Method channels / FFI |

---

## 6. Cross-Platform Strategy

```
+-------------------+     +-------------------+     +-------------------+
|     Windows       |     |      macOS        |     |      Linux        |
+-------------------+     +-------------------+     +-------------------+
|  Flutter Desktop  |     |  Flutter Desktop  |     |  Flutter Desktop  |
|  (native render)  |     |  (native render)  |     |  (native render)  |
+-------------------+     +-------------------+     +-------------------+
          |                        |                        |
          +----------+-------------+-----------+------------+
                     |                         |
              Python Backend             Python Backend
              (bundled via                (bundled via
               PyInstaller)               PyInstaller)
                     |                         |
              SQLite (WAL)              SQLite (WAL)
              Local filesystem          Local filesystem
```

### Platform-Specific Considerations

- **File Permissions**: `FilePermissionInfo` and `PathSafetyResult` adapt checks to POSIX and NTFS semantics.
- **Path Handling**: All paths are `pathlib.Path` objects, ensuring OS-agnostic path operations.
- **Database Path**: Default database location follows XDG Base Directory Specification on Linux, `%LOCALAPPDATA%` on Windows, and `~/Library/Application Support` on macOS.
- **Packaging**: Python backend is bundled as a standalone executable using PyInstaller. Flutter frontend communicates via platform-specific IPC.

---

## 7. Key Design Decisions

### ADR-001: Monadic Error Handling

The `Result[T, E]` type (Ok/Err) replaces most exception-driven flows in the domain and application layers. Exceptions are reserved for truly unrecoverable situations (out-of-memory, interpreter faults). This forces callers to handle both success and error paths explicitly.

### ADR-002: Streaming Hash Computation

`HashBackend` reads files in adaptive chunks (default 8192 bytes, scaling up for large files). This keeps memory usage constant regardless of file size, enabling scanning of multi-gigabyte files on resource-constrained systems.

### ADR-003: 6-Stage Pipeline

The scan pipeline is decomposed into six discrete stages: Validate, Metadata, Hash, Lookup, Verdict, Cleanup. Each stage is independently testable and cancellable. The `ScanStateMachine` (9 states) enforces valid state transitions and prevents illegal operations.

### ADR-004: SQLite WAL Mode

The database layer enables Write-Ahead Logging (WAL) by default. This allows concurrent reads during writes, which is essential for the Scanner's lookup-during-hash pattern where the database may be updated by background sync while scans are in progress.

### ADR-005: Plugin-Based Extensibility

Custom hash algorithms, verdict generators, and threat intelligence providers are registered at runtime via a plugin interface. The system never hardcodes algorithm lists or verdict logic — everything is configurable and replaceable.
