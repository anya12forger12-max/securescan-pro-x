# Layer Diagram

> Clean Architecture layer visualization with dependency directions.

---

## 1. Four-Layer Clean Architecture

```
+===========================================================================+
|                                                                           |
|   OUTER                                                          INNER    |
|                                                                           |
|   +===================================================================+  |
|   |                                                                   |  |
|   |   PRESENTATION  <--->  APPLICATION  <--->  DOMAIN  <---> INFRA   |  |
|   |                                                                   |  |
|   +===================================================================+  |
|                                                                           |
|   Dependencies flow INWARD only (right).                                  |
|   Outer layers depend on inner layers.                                    |
|   Inner layers NEVER depend on outer layers.                              |
|                                                                           |
+===========================================================================+
```

---

## 2. Layer Visualization

```
+===========================================================================+
|                                                                           |
|   +-------------------------------------------------------------------+  |
|   |                                                                   |  |
|   |   LAYER 4: PRESENTATION (outermost)                               |  |
|   |                                                                   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |   | Flutter Desktop App (Dart)                                |   |  |
|   |   |                                                           |   |  |
|   |   |   +------------------+  +------------------+              |   |  |
|   |   |   |  Scan Dashboard  |  |  Report Viewer   |              |   |  |
|   |   |   +------------------+  +------------------+              |   |  |
|   |   |   +------------------+  +------------------+              |   |  |
|   |   |   |  Settings Panel  |  |  Progress Bar    |              |   |  |
|   |   |   +------------------+  +------------------+              |   |  |
|   |   |   +------------------+  +------------------+              |   |  |
|   |   |   |  Notifications   |  |  Accessibility   |              |   |  |
|   |   |   +------------------+  +------------------+              |   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |                                                                   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |   | Shared UI Components (Python)                             |   |  |
|   |   |                                                           |   |  |
|   |   |   Status bar, notifications, accessibility helpers        |   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |                                                                   |  |
|   |   Responsibility: User interaction, rendering, input handling    |  |
|   |   Depends on: Application layer (via IPC/FFI)                   |  |
|   +-------------------------------------------------------------------+  |
|                                    |                                      |
|                                    | depends on                           |
|                                    v                                      |
|   +-------------------------------------------------------------------+  |
|   |                                                                   |  |
|   |   LAYER 3: APPLICATION                                            |  |
|   |                                                                   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |   | ScanPipeline                                               |   |  |
|   |   |                                                           |   |  |
|   |   |   Validate -> Metadata -> Hash -> Lookup -> Verdict ->    |   |  |
|   |   |   Cleanup                                                  |   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |                                                                   |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |   | ScanStateMachine |  | Scheduler        |  | ScanSession   |  |  |
|   |   | (9 states)       |  | (priority queue) |  | (tracking)    |  |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |                                                                   |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |   | Cancellation     |  | ProgressTracker  |  | Verdict       |  |  |
|   |   | Handler          |  | (stages/%)       |  | Generator     |  |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |                                                                   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |   | ConfigurationManager                                       |   |  |
|   |   |   Load, validate, read, write, save config                |   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |                                                                   |  |
|   |   Responsibility: Use-case orchestration, workflow control       |  |
|   |   Depends on: Domain layer                                       |  |
|   +-------------------------------------------------------------------+  |
|                                    |                                      |
|                                    | depends on                           |
|                                    v                                      |
|   +-------------------------------------------------------------------+  |
|   |                                                                   |  |
|   |   LAYER 2: DOMAIN                                                 |  |
|   |                                                                   |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |   | mhcp-core        |  | mhcp-hashing     |  | mhcp-security |  |  |
|   |   |                  |  |                  |  |               |  |  |
|   |   | MHCError         |  | HashAlgorithm    |  | SignatureVerif|  |  |
|   |   | Result[T,E]      |  | HashBackend      |  | PathSafety    |  |  |
|   |   | Severity         |  | HashComputer     |  | FilePermInfo  |  |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |                                                                   |  |
|   |   +------------------+  +------------------+                     |  |
|   |   | mhcp-database    |  | mhcp-reports     |                     |  |
|   |   |   (models)       |  |   (OutputFormat) |                     |  |
|   |   |                  |  |                  |                     |  |
|   |   | HashRecord       |  | ReportGenerator  |                     |  |
|   |   | ScanResult       |  | JSON/CSV/HTML    |                     |  |
|   |   | DatabaseMetadata |  | PDF/XML/Text     |                     |  |
|   |   | BaseRepository   |  |                  |                     |  |
|   |   +------------------+  +------------------+                     |  |
|   |                                                                   |  |
|   |   Responsibility: Business rules, entities, value objects         |  |
|   |   Depends on: Infrastructure layer (implements interfaces)       |  |
|   +-------------------------------------------------------------------+  |
|                                    |                                      |
|                                    | depends on                           |
|                                    v                                      |
|   +-------------------------------------------------------------------+  |
|   |                                                                   |  |
|   |   LAYER 1: INFRASTRUCTURE (innermost)                             |  |
|   |                                                                   |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |   | mhcp-logging     |  | mhcp-config      |  | mhcp-database |  |  |
|   |   |                  |  |   (connection)   |  |   (connection)|  |  |
|   |   | MHCPLogger       |  |                  |  |               |  |  |
|   |   | LogCategory      |  | ConfigSchema     |  | DatabaseConn  |  |  |
|   |   | PII Redaction    |  | FieldDefinition  |  | SQLite WAL    |  |  |
|   |   | Audit Trail      |  | TOML parsing     |  | Transactions  |  |  |
|   |   +------------------+  +------------------+  +---------------+  |  |
|   |                                                                   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |   | External Providers                                        |   |  |
|   |   |                                                           |   |  |
|   |   |   OTX, VirusTotal, Abuse.ch, Custom APIs                  |   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |                                                                   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |   | Filesystem                                                |   |  |
|   |   |                                                           |   |  |
|   |   |   File I/O, path resolution, temp files, WAL journaling   |   |  |
|   |   +-----------------------------------------------------------+   |  |
|   |                                                                   |  |
|   |   Responsibility: I/O, external systems, platform integration    |  |
|   |   Depends on: Nothing (innermost layer)                          |  |
|   +-------------------------------------------------------------------+  |
|                                                                           |
+===========================================================================+
```

---

## 3. Dependency Direction Summary

```
    PRESENTATION
         |
         | depends on
         v
    APPLICATION
         |
         | depends on
         v
      DOMAIN
         |
         | depends on (implements interfaces)
         v
  INFRASTRUCTURE
```

### What Each Layer Can See

| Layer | Can see | Cannot see |
|---|---|---|
| Presentation | Application, Domain, Infrastructure | — |
| Application | Domain, Infrastructure | Presentation |
| Domain | Infrastructure (interfaces only) | Application, Presentation |
| Infrastructure | Nothing (innermost) | Application, Presentation, Domain (logic) |

### What Each Layer Provides

| Layer | Provides |
|---|---|
| Presentation | UI widgets, event handlers, rendering |
| Application | Use cases, workflow orchestration, session management |
| Domain | Entities, value objects, business rules, error types |
| Infrastructure | Database access, logging, configuration, external APIs |

---

## 4. Package-to-Layer Mapping

```
+-------------------------------------------------------------------+
|  Layer          |  Packages                                       |
+-------------------------------------------------------------------+
|  Presentation   |  mhcp-ui (Flutter + Python shared components)   |
+-------------------------------------------------------------------+
|  Application    |  mhcp-scanner (pipeline, scheduler, session)    |
|                 |  mhcp-config (ConfigurationManager)              |
+-------------------------------------------------------------------+
|  Domain         |  mhcp-core (errors, Result, Severity)           |
|                 |  mhcp-hashing (HashAlgorithm, HashBackend)       |
|                 |  mhcp-security (PathSafety, Signatures)          |
|                 |  mhcp-database (HashRecord, ScanResult models)   |
|                 |  mhcp-reports (OutputFormat, ReportGenerator)    |
+-------------------------------------------------------------------+
|  Infrastructure |  mhcp-logging (MHCPLogger, redaction)            |
|                 |  mhcp-config (schema, TOML parsing)              |
|                 |  mhcp-database (DatabaseConnection, SQLite WAL)  |
|                 |  External providers (APIs, plugins)              |
+-------------------------------------------------------------------+
```

---

## 5. Interface Boundaries

```
+===========================================================================+
|                    INTERFACE BOUNDARIES                                     |
+===========================================================================+
|                                                                           |
|  Presentation -> Application                                              |
|  =========================================================================|  |
|  |                                                                       |  |
|  |  IPC / FFI                                                            |  |
|  |                                                                       |  |
|  |  Flutter sends:                                                       |  |
|  |    - scan_file(path)                                                  |  |
|  |    - cancel_scan()                                                    |  |
|  |    - get_status()                                                     |  |
|  |    - get_config()                                                     |  |
|  |                                                                       |  |
|  |  Python returns:                                                      |  |
|  |    - ScanResult (serialized dict)                                     |  |
|  |    - ProgressUpdate (serialized dict)                                 |  |
|  |    - ConfigState (serialized dict)                                    |  |
|  |                                                                       |  |
|  +-----------------------------------------------------------------------+  |
|                                                                           |
|  Application -> Domain                                                    |
|  =========================================================================|  |
|  |                                                                       |  |
|  |  Direct Python imports                                                |  |
|  |                                                                       |  |
|  |  ScanPipeline uses:                                                   |  |
|  |    - HashBackend (from mhcp-hashing)                                  |  |
|  |    - VerdictGenerator (from mhcp-scanner)                             |  |
|  |    - HashRecordRepository (from mhcp-scanner)                         |  |
|  |    - Result[T, E] (from mhcp-core)                                    |  |
|  |    - MHCError hierarchy (from mhcp-core)                              |  |
|  |                                                                       |  |
|  +-----------------------------------------------------------------------+  |
|                                                                           |
|  Domain -> Infrastructure                                                 |
|  =========================================================================|  |
|  |                                                                       |  |
|  |  Abstract interfaces implemented by infrastructure                    |  |
|  |                                                                       |  |
|  |  DatabaseConnection implements:                                        |  |
|  |    - connect(), close(), execute(), fetchone(), fetchall()            |  |
|  |    - transaction() context manager                                    |  |
|  |                                                                       |  |
|  |  MHCPLogger implements:                                               |  |
|  |    - debug(), info(), warning(), error(), critical()                  |  |
|  |    - audit(), performance(), security()                               |  |
|  |                                                                       |  |
|  |  ConfigurationManager implements:                                     |  |
|  |    - load(), get(), set(), save(), as_dict()                          |  |
|  |                                                                       |  |
|  +-----------------------------------------------------------------------+  |
|                                                                           |
+===========================================================================+
```

---

## 6. Hexagonal Architecture Analogy

MHCP's architecture maps to the hexagonal (ports & adapters) pattern:

```
                      +-----------------+
                      |   Application   |
                      |   (ScanPipeline)|
                      +--------+--------+
                               |
                    +----------+----------+
                    |                     |
              +-----v-----+        +-----v------+
              |   PORT     |        |   PORT     |
              |  (Hash)    |        |  (Lookup)  |
              +-----+------+        +-----+------+
                    |                     |
           +--------+--------+    +------+--------+
           |                 |    |               |
     +-----v------+   +-----v----v-+   +---------v-------+
     |   ADAPTER   |   |   ADAPTER   |   |   ADAPTER       |
     | HashBackend |   | DB Repo     |   | External API    |
     | (stdlib)    |   | (SQLite)    |   | (HTTP)          |
     +-------------+   +-------------+   +-----------------+
```

- **Ports:** Abstract interfaces (HashComputer, lookup callable)
- **Adapters:** Concrete implementations (HashBackend, HashRecordRepository, ThreatIntelProvider)
- **Application:** Orchestration logic (ScanPipeline)
