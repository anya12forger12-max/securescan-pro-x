# Data Flow Diagram

> Visual representation of data flowing through the MHCP system.

---

## 1. End-to-End Data Flow

```
+-------------+     +----------+     +----------+     +----------+
|  User /     |     |  File    |     |  Hash    |     | Database |
|  CLI / UI   |     |  System  |     | Engine   |     | / Provider|
+------+------+     +----+-----+     +----+-----+     +----+-----+
       |                 |                |                |
       |  select file    |                |                |
       +---------------->|                |                |
       |                 |                |                |
       |                 |  file path     |                |
       |                 +--------------->|                |
       |                 |                |                |
       |                 |  file content  |                |
       |                 |  (streaming)   |                |
       |                 +--------------->|                |
       |                 |                |                |
       |                 |                |  hash queries  |
       |                 |                +--------------->|
       |                 |                |                |
       |                 |                |  match records |
       |                 |                |<---------------+
       |                 |                |                |
       |                 |                |  verdict       |
       |                 |                |  computation   |
       |                 |                |                |
       |  result dict    |                |                |
       |<----------------+----------------+                |
       |                 |                |                |
       |  report         |                |                |
       +----------------------------------------------->   |
       |                 |                |                |
       v                 v                v                v
```

---

## 2. File → Scan Pipeline Data Flow

```
                    +==================================+
                    |        INPUT DATA                 |
                    +==================================+
                              |
                              v
+===========================================================================+
|                      SCAN PIPELINE                                         |
|                                                                           |
|  +--------------------------------------------------------------------+  |
|  | STAGE 1: VALIDATE                                                   |  |
|  |                                                                     |  |
|  | Input:  Path (str | Path)                                           |  |
|  | Output: PathSafetyResult {                                          |  |
|  |   is_safe: bool,                                                    |  |
|  |   sanitised: str,                                                   |  |
|  |   issues: list[str]                                                 |  |
|  | }                                                                   |  |
|  |                                                                     |  |
|  | Data transformed: raw path -> validated/sanitized path              |  |
|  +--------------------------------------------------------------------+  |
|                              |                                            |
|                              v                                            |
|  +--------------------------------------------------------------------+  |
|  | STAGE 2: METADATA                                                   |  |
|  |                                                                     |  |
|  | Input:  validated Path                                              |  |
|  | Output: {                                                           |  |
|  |   file_path: str,                                                   |  |
|  |   file_size: int,                                                   |  |
|  |   modification_time: datetime,                                      |  |
|  |   creation_time: datetime,                                          |  |
|  |   file_permissions: FilePermissionInfo,                             |  |
|  |   shannon_entropy: float (optional)                                 |  |
|  | }                                                                   |  |
|  +--------------------------------------------------------------------+  |
|                              |                                            |
|                              v                                            |
|  +--------------------------------------------------------------------+  |
|  | STAGE 3: HASH                                                       |  |
|  |                                                                     |  |
|  | Input:  file_path + algorithms list                                 |  |
|  | Output: {                                                           |  |
|  |   "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",                 |  |
|  |   "md5":    "d41d8cd98f00b204e9800998ecf8427e",                    |  |
|  |   "sha512": "cf83e1357eefb8bdf1542850d66d8007d..."                 |  |
|  | }                                                                   |  |
|  |                                                                     |  |
|  | Data flow: file bytes -> hashlib objects -> hex digests             |  |
|  +--------------------------------------------------------------------+  |
|                              |                                            |
|                              v                                            |
|  +--------------------------------------------------------------------+  |
|  | STAGE 4: LOOKUP                                                     |  |
|  |                                                                     |  |
|  | Input:  {algorithm: hex_digest}                                     |  |
|  | Output: [                                                           |  |
|  |   {                                                                  |  |
|  |     hash_value: "e3b0c44298fc1c14...",                              |  |
|  |     algorithm: "sha256",                                            |  |
|  |     source: "virustotal",                                           |  |
|  |     threat_type: "trojan",                                          |  |
|  |     severity: "high",                                               |  |
|  |     first_seen: "2024-01-15T00:00:00Z",                            |  |
|  |     last_seen: "2024-12-01T00:00:00Z",                             |  |
|  |     metadata: {tags: ["emotet"]}                                    |  |
|  |   },                                                                |  |
|  |   ...                                                               |  |
|  | ]                                                                   |  |
|  +--------------------------------------------------------------------+  |
|                              |                                            |
|                              v                                            |
|  +--------------------------------------------------------------------+  |
|  | STAGE 5: VERDICT                                                    |  |
|  |                                                                     |  |
|  | Input:  lookup_results + error states                               |  |
|  | Output: Verdict {                                                   |  |
|  |   verdict_type: VerdictType (KNOWN_MALICIOUS | UNKNOWN | CLEAN),   |  |
|  |   evidence: VerdictEvidence { matched_records: [...] },             |  |
|  |   limitations: ["Hash not found in database", ...],                 |  |
|  |   is_malicious: bool,                                               |  |
|  |   is_unknown: bool,                                                 |  |
|  |   human_readable: "KNOWN MALICIOUS: trojan (severity: high)"       |  |
|  | }                                                                   |  |
|  +--------------------------------------------------------------------+  |
|                              |                                            |
|                              v                                            |
|  +--------------------------------------------------------------------+  |
|  | STAGE 6: CLEANUP                                                    |  |
|  |                                                                     |  |
|  | Input:  scan session + results                                      |  |
|  | Output: finalized session with:                                     |  |
|  |   - completed_at timestamp                                          |  |
|  |   - duration_ms computed                                            |  |
|  |   - all file handles closed                                         |  |
|  |   - progress at 100%                                                |  |
|  +--------------------------------------------------------------------+  |
|                                                                           |
+===========================================================================+
                              |
                              v
+===========================================================================+
|                         OUTPUT DATA                                        |
|                                                                           |
|  {                                                                        |
|    "file_path": "/path/to/suspect.bin",                                   |
|    "file_size": 245760,                                                   |
|    "hashes": {                                                            |
|      "sha256": "a1b2c3d4...",                                            |
|      "md5": "d41d8cd9..."                                                 |
|    },                                                                     |
|    "verdict": Verdict {                                                   |
|      "type": "KNOWN_MALICIOUS",                                           |
|      "evidence": {...},                                                   |
|      "limitations": []                                                    |
|    },                                                                     |
|    "session": ScanSession {                                               |
|      "scan_id": "550e8400-...",                                           |
|      "started_at": "2024-12-15T10:30:00Z",                              |
|      "completed_at": "2024-12-15T10:30:01Z",                            |
|      "duration_ms": 1023.45                                               |
|    },                                                                     |
|    "metrics": PerformanceMetrics {                                        |
|      "hash_duration_ms": 45.2,                                            |
|      "lookup_duration_ms": 120.8,                                         |
|      "verdict_duration_ms": 5.1                                           |
|    }                                                                      |
|  }                                                                        |
+===========================================================================+
```

---

## 3. Hash Computation Data Flow (Detailed)

```
File on disk
     |
     |  open(path, 'rb')
     v
+----+----------------------------------------+
|  File Handle (binary, read-only)            |
|                                             |
|  +--------------------------------------+   |
|  |  Read loop                          |   |
|  |                                     |   |
|  |  while True:                        |   |
|  |    chunk = fh.read(chunk_size)      |   |
|  |    if not chunk: break              |   |
|  |                                     |   |
|  |    +-----+  +-----+  +------+     |   |
|  |    |SHA  |  |MD5  |  |SHA-  |     |   |
|  |    |256  |  |     |  |512   |     |   |
|  |    |.up- |  |.up- |  |.up-  |     |   |
|  |    |date |  |date |  |date  |     |   |
|  |    |(chk)|  |(chk)|  |(chk) |     |   |
|  |    +--+--+  +--+--+  +--+---+     |   |
|  |       |        |         |         |   |
|  |    bytes_read = len(chunk)          |   |
|  |    progress_callback(bytes_read)    |   |
|  |                                     |   |
|  +--------------------------------------+   |
|                                             |
|  sha256_digest = sha256.hexdigest()         |
|  md5_digest    = md5.hexdigest()            |
|  sha512_digest = sha512.hexdigest()         |
+----+----------------------------------------+
     |
     v
dict[str, str]
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  "md5":    "d41d8cd98f00b204e9800998ecf8427e"
  "sha512": "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
```

### Adaptive Chunk Size Selection

```
file_size (bytes)           chunk_size (bytes)
        |                         |
        v                         v
   0 .................> 0        8192 (minimum)
   1 .................> 1        8192
   8192 ..............> 8192     8192
   65536 .............> 64KB     65536
   1048576 ...........> 1MB      262144
   10485760 ..........> 10MB     262144
   104857600 .........> 100MB    1048576
   >104857600 ........> >100MB   1048576 (maximum)
```

---

## 4. Database Lookup Data Flow

```
Computed hashes dict
  {"sha256": "abc123...", "md5": "def456..."}
          |
          +-------------------------------------+
          |                                     |
          v                                     v
+---------+-----------+            +------------+-----------+
|  Local Database     |            |  External Provider     |
|  Lookup             |            |  Lookup                |
+---------+-----------+            +------------+-----------+
          |                                     |
          v                                     v
+---------+-----------+            +------------+-----------+
| SQL Query:          |            | HTTP Request:          |
| SELECT * FROM       |            | POST /api/v1/lookup    |
| hash_records        |            | Body: {algorithm,      |
| WHERE hash_value = ?|            |        hash}           |
| AND algorithm = ?   |            | Headers: Auth token    |
+---------+-----------+            +------------+-----------+
          |                                     |
          v                                     v
+---------+-----------+            +------------+-----------+
| Query Results:      |            | API Response:          |
| [HashRecord, ...]   |            | [record, ...]          |
+---------+-----------+            +------------+-----------+
          |                                     |
          +------------------+------------------+
                             |
                             v
                   +---------+-----------+
                   |  Merge Results       |
                   |  Deduplicate by      |
                   |  (algorithm, hash)   |
                   |  Sort by severity    |
                   +---------+-----------+
                             |
                             v
                   list[dict] (unified records)
```

---

## 5. Verdict Generation Data Flow

```
Input records
  [
    {threat_type: "trojan", severity: "high", source: "virustotal"},
    {threat_type: "worm", severity: "critical", source: "abuse.ch"}
  ]
          |
          v
+-------------------------------------------+
|  Severity Aggregation                     |
|                                           |
|  Sort records by severity:                |
|    critical > high > medium > low > info  |
|                                           |
|  Select primary record (highest severity) |
|  Aggregate threat types                   |
|  Collect all sources                      |
+-------------------------------------------+
          |
          v
+-------------------------------------------+
|  Verdict Classification                   |
|                                           |
|  if records:                              |
|    verdict_type = KNOWN_MALICIOUS         |
|    evidence = {                           |
|      matched_records: records,            |
|      primary_threat: "worm",              |
|      severity: "critical",               |
|      sources: ["virustotal", "abuse.ch"]  |
|    }                                      |
|                                           |
|  elif database_error:                     |
|    verdict_type = UNKNOWN                 |
|    limitations = [error_reason]           |
|                                           |
|  elif cancelled:                          |
|    verdict_type = UNKNOWN                 |
|    limitations = ["Scan was cancelled"]   |
|                                           |
|  else (no matches):                       |
|    verdict_type = UNKNOWN                 |
|    limitations = [                        |
|      "Hash not found in database",        |
|      "Database may be outdated"           |
|    ]                                      |
+-------------------------------------------+
          |
          v
Verdict {
  verdict_type: VerdictType,
  evidence: VerdictEvidence | None,
  limitations: list[str],
  is_malicious: bool,
  is_unknown: bool,
  human_readable: str
}
          |
          v
+-------------------------------------------+
|  Human-Readable Generation                |
|                                           |
|  KNOWN_MALICIOUS:                         |
|    "KNOWN MALICIOUS: {threat_type}        |
|     (severity: {severity})                |
|     Source: {source}"                     |
|                                           |
|  UNKNOWN:                                 |
|    "UNKNOWN: {limitations joined}"        |
|                                           |
|  CLEAN:                                   |
|    "CLEAN: No matching records found"     |
+-------------------------------------------+
```

---

## 6. Report Generation Data Flow

```
Scan results list
  [{file_path, hashes, verdict, metrics}, ...]
          |
          v
+-------------------------------------------+
|  Summary Computation                      |
|                                           |
|  total_files    = len(results)            |
|  malicious      = count(UNKNOWN_MALICIOUS)|
|  clean          = count(CLEAN)            |
|  unknown        = count(UNKNOWN)          |
|  total_bytes    = sum(file_size)          |
|  total_duration = sum(duration_ms)        |
+-------------------------------------------+
          |
          v
+-------------------------------------------+
|  Format Selection                         |
|                                           |
|  OutputFormat.JSON   -> JSONRenderer      |
|  OutputFormat.CSV    -> CSVRenderer       |
|  OutputFormat.HTML   -> HTMLRenderer      |
|  OutputFormat.PDF    -> PDFRenderer       |
|  OutputFormat.TEXT   -> TextRenderer      |
|  OutputFormat.XML    -> XMLRenderer       |
+-------------------------------------------+
          |
          v
+-------------------------------------------+
|  Rendering                                |
|                                           |
|  For each result in results:              |
|    - Map fields to format columns/tags    |
|    - Escape special characters            |
|    - Apply formatting rules               |
|                                           |
|  Add summary header/footer                |
|  Add metadata (timestamp, version)        |
+-------------------------------------------+
          |
          v
bytes (encoded report content)
          |
          +--------------------+
          |                    |
          v                    v
   File on disk         Returned to caller
   output_dir/          (for streaming/API)
   report.{ext}
```
