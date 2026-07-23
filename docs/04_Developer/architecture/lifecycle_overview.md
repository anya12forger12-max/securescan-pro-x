# Lifecycle Overview

> Application startup, scan lifecycle, session management, updates, and shutdown.

---

## 1. Application Startup

The startup sequence initializes all subsystems in dependency order.

```
Process start
      |
      v
+-------------------------------------------+
|  Phase 1: Core Initialization             |
|                                           |
|  1. Parse command-line arguments          |
|  2. Detect platform and architecture      |
|  3. Initialize logging subsystem:         |
|     - MHCPLogger.create()                 |
|     - Configure log level from defaults   |
|     - Set up PII redaction filters        |
|     - Open log file handler               |
|  4. Load DEFAULT_CONFIG                   |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 2: Configuration Loading           |
|                                           |
|  1. Locate config file:                   |
|     - CLI argument (--config)             |
|     - MCP_CONFIG env var                  |
|     - ~/.config/mhcp/mhcp.toml           |
|     - /etc/mhcp/mhcp.toml                |
|  2. Load TOML file                        |
|  3. Apply environment variable overrides  |
|  4. Run schema validation                 |
|  5. Apply config migrations if needed     |
|  6. Update log level from config          |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 3: Database Initialization         |
|                                           |
|  1. Resolve database path from config     |
|  2. Create DatabaseConnection             |
|  3. Enable WAL mode                       |
|  4. Run schema migrations                 |
|  5. Create hash_records table if needed   |
|  6. Build indexes (hash_value, algorithm) |
|  7. Populate DatabaseMetadata             |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 4: Scanner Initialization          |
|                                           |
|  1. Initialize HashBackend instances:     |
|     - SHA-256 (always)                    |
|     - MD5 (if configured)                 |
|     - SHA-512 (if configured)             |
|  2. Initialize HashRecordRepository       |
|  3. Initialize VerdictGenerator           |
|  4. Initialize ScanStateMachine           |
|  5. Initialize Scheduler                  |
|  6. Initialize CancellationHandler        |
|  7. Register external providers           |
|     (if configured and enabled)           |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 5: Plugin Loading                  |
|                                           |
|  1. Scan plugin directories               |
|  2. Load plugin manifests                 |
|  3. Import plugin modules                 |
|  4. Register plugin components            |
|  5. Apply plugin configurations           |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 6: UI Initialization               |
|                                           |
|  Flutter frontend:                        |
|  1. Launch Flutter desktop window         |
|  2. Connect to Python backend via IPC     |
|  3. Load UI state from persistence        |
|  4. Render initial dashboard              |
|                                           |
|  CLI mode:                                |
|  1. Print startup banner                  |
|  2. Display configuration summary         |
|  3. Enter command loop                    |
+-------------------------------------------+
      |
      v
  Application Ready
```

### Startup Timing

| Phase | Typical Duration |
|---|---|
| Core | 50-100ms |
| Configuration | 20-50ms |
| Database | 10-30ms |
| Scanner | 5-15ms |
| Plugins | 100-500ms |
| UI | 500-2000ms |
| **Total** | **~1-3 seconds** |

### Startup Error Handling

- **ConfigurationError:** Application falls back to defaults, logs warning, continues.
- **DatabaseError:** Application starts in offline-only mode (no DB lookups).
- **PluginError:** Failing plugin is skipped, others continue loading.
- **SecurityError:** Application refuses to start (fatal).

---

## 2. Scan Lifecycle

The complete lifecycle of a single file scan.

```
Scan Request Received
      |
      v
+-------------------------------------------+
|  Phase 1: Request Validation              |
|                                           |
|  1. Validate file_path exists             |
|  2. Check file_size against limits        |
|  3. Verify path safety (traversal, etc.)  |
|  4. Check CancellationHandler state       |
|  5. Create ScanSession                    |
|  6. Assign scan_id (UUID4)                |
|  7. Transition: IDLE -> PREPARING         |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 2: Preparation                     |
|                                           |
|  1. Open file handle (read-only)          |
|  2. Verify file is readable               |
|  3. Record file metadata:                 |
|     - file_size                           |
|     - modification_time                   |
|     - creation_time                       |
|     - file_permissions                    |
|  4. Compute Shannon entropy (optional)    |
|  5. Initialize ProgressTracker            |
|  6. Mark session started                  |
|  7. Transition: PREPARING -> HASHING      |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 3: Hash Computation                |
|                                           |
|  Check: CancellationHandler.is_cancelled? |
|     YES -> transition to CANCELLED        |
|     NO  -> continue                       |
|                                           |
|  1. Select algorithms from config         |
|  2. For each algorithm:                   |
|     a. Create hashlib.new(algo)           |
|     b. Read file in adaptive chunks       |
|     c. algo.update(chunk)                 |
|     d. Report progress to ProgressTracker |
|     e. Record bytes_processed             |
|  3. Collect all hex digests               |
|  4. Store hashes in ScanSession           |
|  5. Record hash_duration_ms               |
|  6. Transition: HASHING -> LOOKING_UP     |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 4: Database Lookup                 |
|                                           |
|  Check: CancellationHandler.is_cancelled? |
|     YES -> transition to CANCELLED        |
|     NO  -> continue                       |
|                                           |
|  1. For each (algorithm, digest) pair:    |
|     a. Query hash_records table           |
|     b. Collect matching records           |
|  2. If external provider configured:      |
|     a. Query provider API                 |
|     b. Merge with local results           |
|  3. Record lookup_duration_ms             |
|  4. Transition: LOOKING_UP ->             |
|     GENERATING_VERDICT                    |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 5: Verdict Generation              |
|                                           |
|  Check: CancellationHandler.is_cancelled? |
|     YES -> transition to CANCELLED        |
|     NO  -> continue                       |
|                                           |
|  1. Pass records to VerdictGenerator      |
|  2. Generator applies rules:              |
|     - Known malicious -> record severity  |
|     - No matches -> UNKNOWN               |
|     - Error -> UNKNOWN with reason        |
|  3. Record verdict_duration_ms            |
|  4. Store verdict in ScanSession          |
|  5. Transition: GENERATING_VERDICT ->     |
|     COMPLETED                             |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 6: Cleanup                         |
|                                           |
|  1. Close file handles                    |
|  2. Mark session completed                |
|  3. Compute total duration_ms             |
|  4. Update ProgressTracker to 100%        |
|  5. Record PerformanceMetrics             |
|  6. Persist ScanResult to database        |
|     (if configured)                       |
|  7. Return result dict to caller          |
+-------------------------------------------+
      |
      v
  Scan Complete
  Result: {
    file_path, file_size, hashes,
    verdict, session, metrics
  }
```

### Scan Cancellation

```
Cancellation requested
        |
        v
+-------------------------------------------+
|  CancellationHandler.request_cancellation()|
|                                           |
|  1. Set is_cancelled = True               |
|  2. Notify registered callbacks           |
|  3. Execute cleanup callbacks             |
+-------------------------------------------+
        |
        v
Next cancellation checkpoint in pipeline:
        |
        v
+-------------------------------------------+
|  handler.check_raises()                   |
|                                           |
|  Raises CancelledError                    |
+-------------------------------------------+
        |
        v
+-------------------------------------------+
|  ScanStateMachine transitions to          |
|  CANCELLED (terminal state)               |
|                                           |
|  Session marked as cancelled              |
|  Partial results discarded                |
+-------------------------------------------+
```

---

## 3. Session Management

`ScanSession` tracks the full lifecycle of a scan.

### Session Fields

```python
class ScanSession:
    scan_id: str               # UUID4, auto-generated
    started_at: datetime | None
    completed_at: datetime | None
    duration_ms: float | None  # Computed on completion
    warnings: list[ScanWarning]
    errors: list[str]
    hashes: dict[str, str]     # algo -> hex_digest
```

### Session Lifecycle

```
ScanSession()
  scan_id = uuid4()
  started_at = None
  completed_at = None
  warnings = []
  errors = []
  hashes = {}
        |
        v
  mark_started()
  started_at = datetime.now(UTC)
        |
        v
  set_hash("sha256", "abc...")
  set_hash("md5", "def...")
  add_warning(ScanWarning(message="...", code="SIZE_EXCEEDED"))
  add_error("hash computation failed for sha512")
        |
        v
  mark_completed()
  completed_at = datetime.now(UTC)
  duration_ms = (completed - started).total_seconds() * 1000
        |
        v
  to_dict() -> full serialization
  to_summary() -> brief summary
```

### Session Serialization

```python
session.to_dict() == {
    "scan_id": "550e8400-e29b-41d4-a716-446655440000",
    "started_at": "2024-12-15T10:30:00+00:00",
    "completed_at": "2024-12-15T10:30:01+00:00",
    "duration_ms": 1023.45,
    "warnings": [{"message": "file too large", "code": "SIZE_EXCEEDED"}],
    "errors": [],
    "hashes": {"sha256": "abc...", "md5": "def..."},
}

session.to_summary() == {
    "scan_id": "550e8400-e29b-41d4-a716-446655440000",
    "duration_ms": 1023.45,
    "warning_count": 1,
    "error_count": 0,
}
```

---

## 4. Update Lifecycle

How MHCP handles updates to itself and its hash database.

### Application Update

```
Check for updates
        |
        v
+-------------------------------------------+
|  1. Query update server for latest version|
|  2. Compare with current version          |
|  3. If no update available:               |
|       -> Return (no action needed)        |
|  4. If update available:                  |
|       -> Download update package          |
|       -> Verify signature (SignatureVerifier) |
|       -> Create backup of current version |
|       -> Apply update                     |
|       -> Run migration if needed          |
|       -> Restart application              |
+-------------------------------------------+
```

### Hash Database Update

```
Database sync triggered
        |
        v
+-------------------------------------------+
|  Phase 1: Preparation                     |
|                                           |
|  1. Check last_sync timestamp             |
|  2. Check if sync interval elapsed        |
|  3. Open database connection              |
|  4. Begin transaction                     |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 2: Download                        |
|                                           |
|  1. Fetch hash database delta from server |
|  2. Verify package signature              |
|  3. Parse update records                  |
|  4. Validate record schema                |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 3: Merge                           |
|                                           |
|  1. For each new/updated record:          |
|     a. Check if hash_value exists         |
|     b. Insert or update as needed         |
|     c. Update last_seen timestamp         |
|  2. Update DatabaseMetadata               |
|  3. Update last_sync timestamp            |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 4: Finalization                    |
|                                           |
|  1. Commit transaction                    |
|  2. Verify integrity (checksum)           |
|  3. Log sync summary                      |
|  4. Release connection                    |
+-------------------------------------------+
```

### Database Schema Migration

```
Schema version mismatch detected
        |
        v
+-------------------------------------------+
|  1. Read current schema version           |
|  2. Read target schema version            |
|  3. Load migration chain:                 |
|     v1 -> v2 -> v3 (target)               |
|  4. Create backup of database             |
|  5. For each migration:                   |
|     a. Begin transaction                  |
|     b. Apply DDL changes                  |
|     c. Migrate data if needed             |
|     d. Update schema version              |
|     e. Commit transaction                 |
|  6. Verify final schema                   |
+-------------------------------------------+
```

---

## 5. Shutdown and Cleanup

Graceful shutdown ensures all resources are released and state is persisted.

```
Shutdown signal received (SIGINT / SIGTERM / UI close)
        |
        v
+-------------------------------------------+
|  Phase 1: Signal Processing               |
|                                           |
|  1. Set shutdown_flag = True              |
|  2. Log shutdown initiated                |
|  3. Prevent new scan submissions          |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 2: Active Scan Cancellation        |
|                                           |
|  1. For each active scan:                 |
|     a. CancellationHandler                |
|        .request_cancellation()            |
|     b. Wait for scan to reach terminal    |
|        state (with timeout)               |
|     c. If timeout: force abort            |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 3: Scheduler Shutdown              |
|                                           |
|  1. Scheduler.shutdown(wait=True)         |
|  2. Drain pending scan requests           |
|  3. Wait for worker threads to finish     |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 4: Plugin Cleanup                  |
|                                           |
|  1. For each loaded plugin:               |
|     a. Call plugin.on_unload()            |
|     b. Release plugin resources           |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 5: Database Cleanup                |
|                                           |
|  1. Flush any pending writes              |
|  2. Run WAL checkpoint (PRAGMA wal_checkpoint) |
|  3. Close database connection             |
|  4. Verify WAL file is clean              |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 6: Logging Cleanup                 |
|                                           |
|  1. Flush log buffers                     |
|  2. Write shutdown summary to log         |
|  3. Close log file handlers               |
+-------------------------------------------+
      |
      v
+-------------------------------------------+
|  Phase 7: Finalization                    |
|                                           |
|  1. Release temp files                    |
|  2. Print shutdown summary to console     |
|  3. Exit process with code 0              |
+-------------------------------------------+
```

### Shutdown Timeout

| Phase | Timeout |
|---|---|
| Active scan cancellation | 30 seconds |
| Scheduler shutdown | 10 seconds |
| Plugin cleanup | 5 seconds per plugin |
| Database WAL checkpoint | 5 seconds |
| **Total maximum** | **60 seconds** |

### Forced Shutdown

If the total shutdown time exceeds 60 seconds, or if a `SIGKILL` is received:

1. All file handles are released by the OS.
2. SQLite WAL is recovered on next startup.
3. No data corruption occurs (WAL provides atomicity).
4. On next startup, a database integrity check runs automatically.

### Cleanup Checklist

| Resource | Cleanup Action |
|---|---|
| File handles | `close()` on all open handles |
| Database connections | `close()` + WAL checkpoint |
| Thread pools | `shutdown(wait=True)` |
| Temp files | `unlink()` on all created temp files |
| Log handlers | `flush()` + `close()` |
| Plugin state | `on_unload()` callback |
| IPC channels | `disconnect()` from Flutter frontend |
| Progress callbacks | Clear listener lists |
| Cancellation callbacks | Clear callback lists |
