# Component Diagram

> ASCII component diagram showing package components and their interfaces.

---

## 1. High-Level Component Diagram

```
+===========================================================================+
|                         MHCP System Components                            |
+===========================================================================+
|                                                                           |
|  +-------------------------------------------------------------------+   |
|  |                    PRESENTATION LAYER                             |   |
|  |                                                                   |   |
|  |  +------------------+    +------------------+    +-------------+  |   |
|  |  |  Flutter Desktop  |    |  Shared UI       |    |  Status Bar |  |   |
|  |  |  Application      |    |  Components      |    |  Widget     |  |   |
|  |  |  (Dart)           |    |  (Python)        |    |             |  |   |
|  |  +--------+---------+    +--------+---------+    +------+------+  |   |
|  |           |                      |                      |        |   |
|  |           +----------+-----------+----------+-----------+        |   |
|  |                      |  IPC Bridge  |                           |   |
|  +======================|==============|===========================+   |
|                         |              |                               |
|  +======================|==============|===========================+   |
|  |                 APPLICATION LAYER   |                           |   |
|  |                      |              |                           |   |
|  |  +-------------------v--------------v---------------------+    |   |
|  |  |              ScanPipeline                              |    |   |
|  |  |                                                        |    |   |
|  |  |  +----------+  +--------+  +-------+  +-----------+   |    |   |
|  |  |  | Validate |->| Metadata|->| Hash  |->| Lookup    |   |    |   |
|  |  |  | Stage    |  | Stage  |  | Stage |  | Stage     |   |    |   |
|  |  |  +----------+  +--------+  +-------+  +-----------+   |    |   |
|  |  |                                                        |    |   |
|  |  |  +-----------+  +---------+                            |    |   |
|  |  |  | Verdict   |->| Cleanup |                            |    |   |
|  |  |  | Stage     |  | Stage   |                            |    |   |
|  |  |  +-----------+  +---------+                            |    |   |
|  |  +----------+------------------+------------------------+    |   |
|  |             |                  |                              |   |
|  |  +----------v---------+  +----v-----------------------+     |   |
|  |  |  ScanStateMachine  |  |  Scheduler                 |     |   |
|  |  |                    |  |                            |     |   |
|  |  |  IDLE              |  |  ScanPriority queue        |     |   |
|  |  |  PREPARING         |  |  Worker pool               |     |   |
|  |  |  HASHING           |  |  Request tracking          |     |   |
|  |  |  LOOKING_UP        |  +----------------------------+     |   |
|  |  |  GENERATING_VERDICT|                                    |   |
|  |  |  COMPLETED         |  +----------------------------+     |   |
|  |  |  FAILED            |  |  ProgressTracker           |     |   |
|  |  |  CANCELLED         |  |                            |     |   |
|  |  |  RECOVERING        |  |  Stages, percentages       |     |   |
|  |  +--------------------+  |  Byte counting             |     |   |
|  |                          |  ETA estimation             |     |   |
|  |  +--------------------+  +----------------------------+     |   |
|  |  |  CancellationHandler|                                   |   |
|  |  |                    |  +----------------------------+     |   |
|  |  |  Thread-safe flag  |  |  ScanSession               |     |   |
|  |  |  Callbacks         |  |  UUID, timestamps          |     |   |
|  |  |  Cleanup handlers  |  |  Warnings, errors          |     |   |
|  |  +--------------------+  |  Hashes, metrics           |     |   |
|  |                          +----------------------------+     |   |
|  +================================================================+   |
|                                                                           |
|  +================================================================+   |
|  |                       DOMAIN LAYER                              |   |
|  |                                                                 |   |
|  |  +------------------+  +------------------+  +----------------+ |   |
|  |  |  mhcp-core       |  |  mhcp-hashing    |  |  mhcp-security | |   |
|  |  |                  |  |                  |  |                | |   |
|  |  |  MHCError        |  |  HashAlgorithm   |  |  SignatureVerifier| |
|  |  |  Result[T,E]     |  |  HashBackend     |  |  PathSafetyResult| |
|  |  |  Severity        |  |  HashComputer    |  |  FilePermissionInfo| |
|  |  |  Ok / Err        |  |  Validator       |  |  is_safe_path  | |   |
|  |  +------------------+  +------------------+  +----------------+ |   |
|  |                                                                 |   |
|  |  +------------------+  +------------------+                     |   |
|  |  |  mhcp-database   |  |  mhcp-reports    |                     |   |
|  |  |                  |  |                  |                     |   |
|  |  |  DatabaseConnection| |  OutputFormat    |                     |   |
|  |  |  HashRecord      |  |  ReportGenerator |                     |   |
|  |  |  ScanResult      |  |  JSON/CSV/HTML   |                     |   |
|  |  |  BaseRepository  |  |  PDF/XML/Text    |                     |   |
|  |  +------------------+  +------------------+                     |   |
|  +================================================================+   |
|                                                                           |
|  +================================================================+   |
|  |                  INFRASTRUCTURE LAYER                           |   |
|  |                                                                 |   |
|  |  +------------------+  +------------------+  +----------------+ |   |
|  |  |  mhcp-logging    |  |  mhcp-config     |  |  External      | |   |
|  |  |                  |  |                  |  |  Providers     | |   |
|  |  |  MHCPLogger      |  |  ConfigurationManager| |                | |   |
|  |  |  LogCategory     |  |  ConfigSchema    |  |  OTX           | |   |
|  |  |  PII Redaction   |  |  FieldDefinition |  |  VirusTotal    | |   |
|  |  |  Audit Trail     |  |  TOML loading    |  |  Abuse.ch      | |   |
|  |  +------------------+  +------------------+  +----------------+ |   |
|  +================================================================+   |
|                                                                           |
+===========================================================================+
```

---

## 2. Scanner Engine Component Detail

```
+===========================================================================+
|                    ScanPipeline Internal Components                        |
+===========================================================================+
|                                                                           |
|  +-------------------+     +-------------------+     +-----------------+ |
|  |  PipelineConfig    |     |  ScanSession      |     |  Performance    | |
|  |                    |     |                    |     |  Metrics        | |
|  |  algorithms: list  |     |  scan_id: str      |     |                 | |
|  |  chunk_size: int   |     |  started_at: dt    |     |  hash_ms: float | |
|  |  timeout: int      |     |  completed_at: dt  |     |  lookup_ms: flo | |
|  |  max_file_size: int|     |  warnings: list    |     |  verdict_ms: flo| |
|  +--------+----------+     |  errors: list      |     +-----------------+ |
|           |                 |  hashes: dict       |                         |
|           |                 +--------+------------+                         |
|           |                          |                                      |
|           v                          v                                      |
|  +--------v--------------------------v----------------------------------+  |
|  |                          ScanPipeline                                |  |
|  |                                                                      |  |
|  |  +------------------+  +-------------------+  +-------------------+  |  |
|  |  |  HashBackend     |  |  HashRecordRepo   |  |  VerdictGenerator |  |  |
|  |  |                  |  |                   |  |                   |  |  |
|  |  |  algorithm       |  |  connection       |  |  generate()       |  |  |
|  |  |  chunk_size      |  |  lookup()         |  |  Verdict          |  |  |
|  |  |  compute_file()  |  |  insert()         |  |  VerdictType      |  |  |
|  |  |  compute_bytes() |  |  update()         |  |  VerdictEvidence  |  |  |
|  |  |  compute_multi() |  |                   |  |                   |  |  |
|  |  +------------------+  +-------------------+  +-------------------+  |  |
|  |                                                                      |  |
|  |  +-------------------+  +-------------------+  +-------------------+  |  |
|  |  |  ScanStateMachine |  |  Cancellation     |  |  ProgressTracker |  |  |
|  |  |                   |  |  Handler           |  |                   |  |  |
|  |  |  current_state    |  |  is_cancelled      |  |  stage           |  |  |
|  |  |  transition()     |  |  check_raises()    |  |  percentage      |  |  |
|  |  |  reset()          |  |  add_callback()    |  |  update()        |  |  |
|  |  |  history          |  |  wait()            |  |  complete()      |  |  |
|  |  |  add_listener()   |  |  register_cleanup()|  |  fail()          |  |  |
|  |  +-------------------+  +-------------------+  +-------------------+  |  |
|  |                                                                      |  |
|  |  +-------------------+                                               |  |
|  |  |  Scheduler        |                                               |  |
|  |  |                   |                                               |  |
|  |  |  submit()         |                                               |  |
|  |  |  get_status()     |                                               |  |
|  |  |  shutdown()       |                                               |  |
|  |  |  queue_length     |                                               |  |
|  |  +-------------------+                                               |  |
|  +======================================================================+  |
|                                                                           |
+===========================================================================+
```

---

## 3. Database Component Detail

```
+===========================================================================+
|                    Database Package Components                             |
+===========================================================================+
|                                                                           |
|  +-------------------+     +-------------------+     +-----------------+ |
|  |  DatabaseConnection|     |  HashRecord       |     |  ScanResult     | |
|  |                    |     |  (dataclass)      |     |  (dataclass)    | |
|  |  connect()         |     |                    |     |                 | |
|  |  close()           |     |  id: int | None    |     |  file_path: str | |
|  |  execute()         |     |  hash_value: str   |     |  status: str    | |
|  |  executemany()     |     |  algorithm: str    |     |  hashes: dict   | |
|  |  fetchone()        |     |  source: str       |     |  verdict: str   | |
|  |  fetchall()        |     |  threat_type: str  |     |  timestamp: dt  | |
|  |  transaction()     |     |  severity: str     |     |                 | |
|  |  WAL mode          |     |  first_seen: dt    |     +-----------------+ |
|  |                    |     |  last_seen: dt     |                         |
|  +--------+----------+     |  metadata: dict    |                         |
|           |                 +--------+-----------+                         |
|           |                          |                                      |
|           v                          v                                      |
|  +--------v--------------------------v----------------------------------+  |
|  |                        SQLite Database                                |  |
|  |                                                                       |  |
|  |  +------------------------------------------------------------+      |  |
|  |  |  hash_records table                                         |      |  |
|  |  |                                                             |      |  |
|  |  |  id (PK)  hash_value  algorithm  source  threat_type       |      |  |
|  |  |  severity  first_seen  last_seen  metadata                  |      |  |
|  |  +------------------------------------------------------------+      |  |
|  |                                                                       |  |
|  |  +------------------------------------------------------------+      |  |
|  |  |  scan_results table                                         |      |  |
|  |  |                                                             |      |  |
|  |  |  id (PK)  scan_id  file_path  file_size  verdict           |      |  |
|  |  |  hashes  scan_timestamp  duration_ms                        |      |  |
|  |  +------------------------------------------------------------+      |  |
|  |                                                                       |  |
|  |  +------------------------------------------------------------+      |  |
|  |  |  database_metadata table                                    |      |  |
|  |  |                                                             |      |  |
|  |  |  key (PK)  value  updated_at                                |      |  |
|  |  +------------------------------------------------------------+      |  |
|  +=======================================================================+  |
|                                                                           |
+===========================================================================+
```

---

## 4. Error Hierarchy Component

```
+===========================================================================+
|                      Error Hierarchy Components                            |
+===========================================================================+
|                                                                           |
|  +--------------------------------------------------------------------+  |
|  |                          MHCError                                   |  |
|  |                     (base exception)                                 |  |
|  |                                                                    |  |
|  |  Attributes:                                                       |  |
|  |    error_code: str         (e.g., "HASH_COMPUTE_FAILED")           |  |
|  |    message: str            (human-readable description)             |  |
|  |    severity: Severity      (CRITICAL / ERROR / WARNING / INFO)     |  |
|  |    recovery_suggestion: str (actionable fix hint)                   |  |
|  |                                                                    |  |
|  |  Methods:                                                          |  |
|  |    to_dict() -> dict       (serializable representation)            |  |
|  |    __repr__() -> str       (developer-friendly repr)                |  |
|  +--------------------------------------------------------------------+  |
|           |          |          |          |          |          |         |
|           v          v          v          v          v          v         |
|  +--------+--+ +----+-----+ +--+------+ +--+------+ +--+------+ +------+ |
|  |Application| |Config    | |Database| |File    | |Hash   | |Security| |
|  |Error     | |Error     | |Error   | |system  | |Error  | |Error   | |
|  +----------+ +----------+ +--------+ |Error   | +-------+ +--------+ |
|                                       +--------+                        |
|                                                                           |
|  +--------------------------------------------------------------------+  |
|  |                         Severity Enum                               |  |
|  |                                                                    |  |
|  |  CRITICAL  = "critical"   Unrecoverable, immediate termination     |  |
|  |  ERROR     = "error"      Operation failed, app continues          |  |
|  |  WARNING   = "warning"    Non-fatal, may affect results            |  |
|  |  INFO      = "info"       Informational, no action needed          |  |
|  +--------------------------------------------------------------------+  |
|                                                                           |
|  +--------------------------------------------------------------------+  |
|  |                      Result[T, E] Monad                              |  |
|  |                                                                    |  |
|  |  Ok[T]                    Err[E]                                    |  |
|  |  +----------+            +----------+                               |  |
|  |  | _value:T |            | _error:E |                               |  |
|  |  +----------+            +----------+                               |  |
|  |                                                                    |  |
|  |  Methods:                                                          |  |
|  |    is_ok() -> bool                                                 |  |
|  |    is_err() -> bool                                                |  |
|  |    unwrap() -> T | raises E                                        |  |
|  |    unwrap_or(default) -> T                                          |  |
|  |    map(fn) -> Result[U, E]                                         |  |
|  |    flat_map(fn) -> Result[U, E]                                    |  |
|  |    map_err(fn) -> Result[T, Any]                                   |  |
|  +--------------------------------------------------------------------+  |
|                                                                           |
+===========================================================================+
```
