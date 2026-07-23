# Data Flow Documentation

> Detailed data flow descriptions for every major operation in MHCP.

---

## 1. File Scanning Data Flow

The primary data flow — scanning a single file through the complete pipeline.

```
                      File Path (str | Path)
                              |
                              v
              +-------------------------------+
              |  [STAGE 1: VALIDATE]          |
              |                               |
              |  Security.is_safe_path(path)  |
              |  Security.sanitize_path(path) |
              |                               |
              |  Checks:                      |
              |    - Null bytes               |
              |    - Path traversal            |
              |    - Symbolic links            |
              |    - Control characters        |
              |    - Permission bits           |
              +------+--------+---------------+
                     |        |
              safe   |        |  unsafe
              +------v--+  +--v------------------+
              | continue |  | PathSafetyResult     |
              +------+---+  | is_safe=False        |
                     |       | issues=[...]         |
                     v       | Stop pipeline        |
              +-----------+  +---------------------+
              |           |
              |  Result[PathSafetyResult, SecurityError]
              |           |
              +-----+-----+
                    |
                    v
              +-------------------------------+
              |  [STAGE 2: METADATA]          |
              |                               |
              |  os.stat(path)                |
              |                               |
              |  Extracts:                    |
              |    - file_size (bytes)        |
              |    - modification_time        |
              |    - creation_time            |
              |    - file_permissions         |
              +------+------------------------+
                     |
                     v
              +-------------------------------+
              |  [STAGE 3: HASH]              |
              |                               |
              |  HashBackend.compute_file()   |
              |    or                         |
              |  HashBackend.compute_file_multi() |
              |                               |
              |  For each algorithm:          |
              |    open(path, 'rb')           |
              |    while chunk := read(N):    |
              |      algo.update(chunk)       |
              |      progress_callback(bytes) |
              |    digest = algo.hexdigest()  |
              |                               |
              |  Output: {algo: hex_digest}   |
              +------+------------------------+
                     |
                     v
              +-------------------------------+
              |  [STAGE 4: LOOKUP]            |
              |                               |
              |  For each (algo, digest):     |
              |    HashRecordRepository       |
              |      .lookup({algo: digest})  |
              |                               |
              |  Optionally:                  |
              |    external_provider(hashes)  |
              |                               |
              |  Output: list[dict] records   |
              +------+------------------------+
                     |
                     v
              +-------------------------------+
              |  [STAGE 5: VERDICT]           |
              |                               |
              |  VerdictGenerator.generate()  |
              |                               |
              |  Logic:                       |
              |    if records:                |
              |      -> KNOWN_MALICIOUS       |
              |    elif error:                |
              |      -> UNKNOWN (with reason) |
              |    else:                      |
              |      -> UNKNOWN               |
              |                               |
              |  Output: Verdict              |
              +------+------------------------+
                     |
                     v
              +-------------------------------+
              |  [STAGE 6: CLEANUP]           |
              |                               |
              |  Session.mark_completed()     |
              |  Close file handles           |
              |  Update progress to 100%      |
              |  Record PerformanceMetrics    |
              +------+------------------------+
                     |
                     v
              dict {
                file_path: str,
                file_size: int,
                hashes: {algo: digest},
                verdict: Verdict,
                session: ScanSession,
                metrics: PerformanceMetrics
              }
```

### Cancellation Checkpoints

Cancellation is checked between every stage:

```
[VALIDATE] --cancel-check--> [METADATA] --cancel-check--> [HASH]
  --cancel-check--> [LOOKUP] --cancel-check--> [VERDICT]
  --cancel-check--> [CLEANUP]
```

If `CancellationHandler.is_cancelled` is `True` at any checkpoint, `CancelledError` is raised and the state machine transitions to `CANCELLED`.

---

## 2. Hash Computation Flow

Detailed view of how file content becomes hex digests.

```
File on disk
     |
     v
+----+--------------------------------------+
|  HashBackend.compute_file(path)           |
|                                           |
|  1. Validate file exists                  |
|     - Raise HashError if not found        |
|                                           |
|  2. Compute adaptive chunk size           |
|     - file_size < 64KB  ->  8KB chunks    |
|     - file_size < 1MB   -> 64KB chunks    |
|     - file_size < 100MB -> 256KB chunks   |
|     - file_size >= 100MB -> 1MB chunks    |
|                                           |
|  3. Open file handle (binary, read-only)  |
|                                           |
|  4. For each algorithm in requested list: |
|     - Create hashlib.new(algo.value)      |
|     - Read chunk                          |
|     - algo.update(chunk)                  |
|     - Invoke progress_callback(bytes_read)|
|     - Repeat until EOF                    |
|     - hex_digest = algo.hexdigest()       |
|                                           |
|  5. Return {algo_name: hex_digest}        |
+----+--------------------------------------+
     |
     v
dict[str, str]
  "sha256": "e3b0c44298fc1c149afbf4c8996fb924..."
  "md5":    "d41d8cd98f00b204e9800998ecf8427e"
```

### Multi-Algorithm Optimization

When computing multiple algorithms simultaneously (`compute_file_multi`), the file is read **once** and all hash objects are updated with each chunk:

```
chunk = file.read(chunk_size)
  |
  +---> sha256.update(chunk)
  +---> md5.update(chunk)
  +---> sha512.update(chunk)
  |
  (repeat until EOF)

sha256_digest = sha256.hexdigest()
md5_digest    = md5.hexdigest()
sha512_digest = sha512.hexdigest()
```

This avoids reading multi-gigabyte files multiple times.

---

## 3. Database Lookup Flow

How hashes are cross-referenced against the threat intelligence database.

```
Computed hashes
  {"sha256": "abc123...", "md5": "def456..."}
          |
          v
+-------------------------------------------+
|  HashRecordRepository.lookup(hashes)      |
|                                           |
|  For each (algorithm, digest) pair:       |
|                                           |
|    1. Sanitise digest                     |
|       - Strip whitespace                  |
|       - Lowercase hex                     |
|       - Validate hex length matches       |
|         algorithm.hex_digest_length       |
|                                           |
|    2. Execute SQL query:                  |
|       SELECT * FROM hash_records          |
|       WHERE hash_value = ?               |
|         AND algorithm = ?                |
|                                           |
|    3. Map rows to HashRecord dataclasses  |
|                                           |
|    4. Accumulate matched records          |
|                                           |
|  Return: list[HashRecord]                |
+-------------------------------------------+
          |
          v
list[dict]
  [
    {
      hash_value: "abc123...",
      algorithm: "sha256",
      source: "virustotal",
      threat_type: "trojan",
      severity: "high",
      first_seen: "2024-01-15T00:00:00Z",
      last_seen: "2024-12-01T00:00:00Z",
      metadata: {tags: ["emotet", "banker"]}
    }
  ]
```

### External Provider Flow

When an external threat intelligence provider is configured:

```
Computed hashes
  {"sha256": "abc123..."}
          |
          v
+-------------------------------------------+
|  Provider.__call__(hashes)                |
|                                           |
|  1. Check in-memory cache                 |
|     - Cache key = "sha256:abc123..."      |
|     - Return cached if found              |
|                                           |
|  2. Build HTTP request:                   |
|     POST https://api.example.com/v1/lookup|
|     Headers:                              |
|       Content-Type: application/json      |
|       Authorization: Bearer <api_key>     |
|     Body: {"algorithm": "sha256",         |
|            "hash": "abc123..."}           |
|                                           |
|  3. Send request with timeout             |
|                                           |
|  4. Parse JSON response                   |
|                                           |
|  5. Normalise to MHCP record schema:      |
|     {hash_value, algorithm, source,       |
|      threat_type, severity, ...}          |
|                                           |
|  6. Cache result                          |
|                                           |
|  7. Return list[dict]                     |
+-------------------------------------------+
```

---

## 4. Verdict Generation Flow

How lookup results are classified into a final verdict.

```
Lookup results (list[dict])
  + database_error (optional str)
  + scan_error (optional str)
  + cancelled (bool)
          |
          v
+-------------------------------------------+
|  VerdictGenerator.generate(...)           |
|                                           |
|  1. Check for error conditions:           |
|     if cancelled:                         |
|       -> UNKNOWN + "Scan was cancelled"   |
|     if database_error:                    |
|       -> UNKNOWN + error reason           |
|     if scan_error:                        |
|       -> UNKNOWN + error reason           |
|                                           |
|  2. Check lookup results:                 |
|     if len(records) > 0:                  |
|       -> KNOWN_MALICIOUS                  |
|       -> Evidence: matched_records        |
|       -> Severity from highest record     |
|       -> Threat type from primary record  |
|                                           |
|  3. No matches found:                     |
|       -> UNKNOWN                          |
|       -> Limitations:                     |
|          "Hash not found in database"     |
|          "Database may be outdated"       |
|                                           |
|  4. Return Verdict                        |
+-------------------------------------------+
          |
          v
Verdict {
  verdict_type: VerdictType,
  evidence: VerdictEvidence | None,
  limitations: list[str],
  is_malicious: bool,
  is_unknown: bool,
  human_readable: str,
  to_dict() -> dict
}
```

### Extended Verdict Logic (Custom)

When using `ExtendedVerdictGenerator` (from the plugin system):

```
Base Verdict (UNKNOWN)
          |
          v
+-------------------------------------------+
|  1. Policy Check (hard block):            |
|     - Check file extension against        |
|       blocked_extensions list             |
|     - Check file size against             |
|       max_file_size_bytes                 |
|     -> POLICY_BLOCK if any rule matches   |
|                                           |
|  2. Heuristic Check:                      |
|     - Double extension (e.g., .pdf.exe)   |
|     - High entropy (> 7.5) = packing      |
|     - Very small executable (< 1KB)       |
|     -> SUSPICIOUS if any heuristic fires  |
|                                           |
|  3. Fall through to base UNKNOWN          |
+-------------------------------------------+
```

---

## 5. Report Generation Flow

How scan results become human-readable or machine-readable reports.

```
list[ScanResult]
  [
    {file_path, file_size, hashes, verdict, ...},
    {file_path, file_size, hashes, verdict, ...},
    ...
  ]
          |
          v
+-------------------------------------------+
|  ReportGenerator.generate(results, format)|
|                                           |
|  1. Compute summary statistics:           |
|     - total_files                         |
|     - malicious_count                     |
|     - clean_count                         |
|     - unknown_count                       |
|     - total_bytes                         |
|     - scan_duration_total                 |
|                                           |
|  2. Format-specific rendering:            |
|                                           |
|  JSON:                                    |
|    {report: {title, format, version},     |
|     summary: {...},                       |
|     results: [...]}                       |
|                                           |
|  CSV:                                     |
|    Header row + one row per result        |
|    Columns: file_path, sha256, md5,       |
|             verdict, severity, ...        |
|                                           |
|  HTML:                                    |
|    Full HTML document with styled table   |
|    Summary banner + detail rows           |
|                                           |
|  TEXT:                                    |
|    Formatted plain text with alignment    |
|                                           |
|  XML:                                     |
|    Structured XML with schema             |
|                                           |
|  PDF:                                     |
|    Rendered from HTML template            |
+-------------------------------------------+
          |
          v
bytes (encoded report content)
          |
          v
+-------------------------------------------+
|  Write to disk:                           |
|    output_dir / f"report.{format.ext}"    |
|                                           |
|  Or return to caller for streaming        |
+-------------------------------------------+
```

---

## 6. Scan Session Lifecycle Data Flow

How a `ScanSession` tracks state through the entire scan process.

```
ScanSession created
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
    add_warning(ScanWarning(...))
          |
          v
    mark_completed()
  completed_at = datetime.now(UTC)
  duration_ms = (completed - started).total_seconds() * 1000
          |
          v
    to_dict() -> {
      scan_id, started_at, completed_at,
      duration_ms, warnings, errors, hashes
    }
          |
          v
    to_summary() -> {
      scan_id, duration_ms, warning_count, error_count
    }
```

---

## 7. State Machine Transition Data Flow

How the `ScanStateMachine` enforces valid transitions.

```
Input: transition(target_state)
          |
          v
+-------------------------------------------+
|  1. Look up allowed transitions for       |
|     current_state in transition_table:    |
|                                           |
|     IDLE        -> [PREPARING]            |
|     PREPARING   -> [HASHING, CANCELLED]   |
|     HASHING     -> [LOOKING_UP, FAILED]   |
|     LOOKING_UP  -> [GENERATING_VERDICT,   |
|                     CANCELLED]            |
|     GENERATING_VERDICT -> [COMPLETED,     |
|                            FAILED]        |
|     RECOVERING  -> [PREPARING]            |
|     COMPLETED   -> [] (terminal)          |
|     FAILED      -> [RECOVERING]           |
|     CANCELLED   -> [] (terminal)          |
|                                           |
|  2. If target_state not in allowed set:   |
|       raise ValueError                    |
|                                           |
|  3. Update current_state = target_state   |
|                                           |
|  4. Append (from, to, timestamp) to       |
|     history                               |
|                                           |
|  5. Notify all registered listeners       |
|                                           |
|  6. Return None                           |
+-------------------------------------------+
```

### Reset Flow

```
reset()
  |
  v
+-------------------------------------------+
|  1. Check current_state is terminal:      |
|     COMPLETED, FAILED, CANCELLED only     |
|                                           |
|  2. If not terminal:                      |
|       raise ValueError                    |
|                                           |
|  3. current_state = IDLE                  |
|  4. Append (RECOVERING, IDLE, timestamp)  |
|  5. Notify listeners                      |
+-------------------------------------------+
```

---

## 8. Configuration Loading Data Flow

How configuration is loaded, validated, and applied.

```
Config file path (TOML)
          |
          v
+-------------------------------------------+
|  ConfigurationManager.load(path)          |
|                                           |
|  1. Read TOML file                        |
|  2. Parse into dict                       |
|  3. Apply environment variable overrides: |
|     MCP_<SECTION>__<KEY> = value          |
|  4. Merge with defaults                   |
|  5. Validate against ConfigSchema:        |
|     - Type checking                       |
|     - Required field presence             |
|     - Custom validator execution          |
|  6. If validation fails:                  |
|       raise ConfigurationError            |
|  7. Store validated config                |
+-------------------------------------------+
          |
          v
ConfigurationManager {
  get("logging.level") -> "INFO"
  set("logging.level", "DEBUG")
  as_dict() -> {full config}
  save(path) -> write TOML
}
```

### Environment Variable Override Flow

```
Environment: MCP_SECURITY__API_TIMEOUT_SECONDS=120
          |
          v
+-------------------------------------------+
|  1. Scan os.environ for MCP_ prefix       |
|  2. Parse: section = SECURITY             |
|            key = API_TIMEOUT_SECONDS      |
|  3. Convert value: "120" -> 120 (int)     |
|  4. Override: config["security"]          |
|               ["api_timeout_seconds"] = 120|
+-------------------------------------------+
```
