# Performance Guide

Techniques, tools, and targets for optimizing Malware Hash Checker Pro.

## Table of Contents

- [Streaming Hash Computation](#streaming-hash-computation)
- [Adaptive Chunk Sizing](#adaptive-chunk-sizing)
- [Single-Pass Multi-Hash](#single-pass-multi-hash)
- [Database Indexing](#database-indexing)
- [Caching Strategies](#caching-strategies)
- [Profiling Tools](#profiling-tools)
- [Benchmarking Methodology](#benchmarking-methodology)
- [Performance Targets](#performance-targets)

---

## Streaming Hash Computation

MHCP never loads an entire file into memory. Files are read in chunks, and the hash is updated incrementally.

### How It Works

```python
from mhcp_scanner.engine.backend import HashBackend
from mhcp_hashing.algorithm import HashAlgorithm

backend = HashBackend(HashAlgorithm.SHA256)
digest = backend.compute_file("/path/to/large/file.bin")
```

Internally, `compute_file` opens the file in binary mode and reads it in chunks:

```python
hasher = hashlib.new(self._algorithm.value)
with open(path, "rb") as fh:
    while True:
        chunk = fh.read(self.chunk_size)
        if not chunk:
            break
        hasher.update(chunk)
return hasher.hexdigest()
```

### Memory Characteristics

- **Constant memory usage** — Memory consumption is independent of file size.
- **Peak memory** — Roughly `chunk_size` bytes plus the hash state (a few hundred bytes).
- **No temporary files** — No intermediate files are written to disk.

### Progress Reporting

During streaming, a callback reports cumulative bytes processed:

```python
from mhcp_scanner.engine.backend import HashBackend
from mhcp_hashing.algorithm import HashAlgorithm

backend = HashBackend(HashAlgorithm.SHA256)

def on_progress(bytes_read: int) -> None:
    print(f"Processed {bytes_read} bytes")

digest = backend.compute_file(
    "/path/to/large/file.bin",
    progress_callback=on_progress,
)
```

### Cancellation Support

Streaming operations check for cancellation between chunks:

```python
from mhcp_scanner.engine.cancellation import CancellationHandler
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline

handler = CancellationHandler()
# handler.request_cancellation() from another thread

pipeline = ScanPipeline(
    config=PipelineConfig(),
    cancellation_handler=handler,
)
# Pipeline will stop at the next chunk boundary if cancelled
```

---

## Adaptive Chunk Sizing

The `HashBackend` automatically adjusts chunk size based on file size to optimize for both latency (small files) and throughput (large files).

### Algorithm

```python
def adaptive_chunk_size(self, file_size: int) -> int:
    """Return an appropriate chunk size for the given file size."""
    if file_size <= 0:
        return self.chunk_size  # Default: 8192

    if file_size <= 8192:
        return file_size  # Read entire small file in one chunk

    if file_size <= 1024 * 1024:
        return 8192  # 8KB chunks for medium files

    return 64 * 1024  # 64KB chunks for large files
```

### Rationale

| File Size | Chunk Size | Benefit |
|-----------|-----------|---------|
| <= 8 KB | File size | Single read call, minimal overhead |
| 8 KB - 1 MB | 8 KB | Balanced latency and throughput |
| > 1 MB | 64 KB | Maximum throughput, fewer syscalls |

### Custom Chunk Size

Override the default chunk size:

```python
backend = HashBackend(HashAlgorithm.SHA256, chunk_size=4096)
```

---

## Single-Pass Multi-Hash

`HashBackend.compute_file_multi()` computes multiple hash algorithms in a single pass over the file, avoiding redundant I/O.

### Usage

```python
from mhcp_scanner.engine.backend import HashBackend
from mhcp_hashing.algorithm import HashAlgorithm

backend = HashBackend(HashAlgorithm.SHA256)
hashes = backend.compute_file_multi(
    Path("/path/to/file.bin"),
    [HashAlgorithm.SHA256, HashAlgorithm.MD5, HashAlgorithm.SHA512],
)
# hashes = {"sha256": "...", "md5": "...", "sha512": "..."}
```

### How It Works

1. All hashers are initialized in parallel.
2. The file is read once in chunks.
3. Each chunk is fed to every hasher simultaneously.
4. All digests are computed at the end.

This is approximately as fast as computing a single hash, regardless of how many algorithms are requested.

### Benchmark Comparison

| Algorithms | Sequential | Single-Pass |
|-----------|-----------|-------------|
| SHA-256 only | 1.0x | 1.0x |
| SHA-256 + MD5 | ~2.0x | ~1.0x |
| SHA-256 + MD5 + SHA-512 | ~3.0x | ~1.0x |

---

## Database Indexing

### Hash Value Index

The primary index on `hash_records` is on the `hash_value` column:

```sql
CREATE INDEX idx_hash_value ON hash_records (hash_value)
```

This enables O(log n) lookups instead of O(n) full table scans.

### WAL Mode

SQLite Write-Ahead Logging (WAL) mode is enabled by default:

```sql
PRAGMA journal_mode = wal
```

**Benefits:**
- Concurrent readers while a writer is active.
- Faster writes than the default rollback journal.
- Crash recovery without data loss.

### Query Optimization

Use parameterized queries for predictable plan caching:

```python
# Correct — parameterized
db.fetchone(
    "SELECT * FROM hash_records WHERE hash_value = ?",
    (hash_value,),
)

# Incorrect — string formatting (SQL injection risk)
db.fetchone(f"SELECT * FROM hash_records WHERE hash_value = '{hash_value}'")
```

### Schema Design

The `hash_records` table schema:

```sql
CREATE TABLE hash_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash_value TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    source TEXT,
    threat_type TEXT,
    severity TEXT,
    first_seen TEXT,
    last_seen TEXT,
    metadata TEXT
);
CREATE INDEX idx_hash_value ON hash_records (hash_value);
```

**Design decisions:**
- `hash_value` is indexed for fast lookups.
- `algorithm` is stored alongside the hash for multi-algorithm databases.
- `metadata` is stored as JSON text for flexibility.
- Timestamps are stored as ISO 8601 text for portability.

---

## Caching Strategies

### In-Memory Session Caching

Cache repeated lookups within a scan session to avoid redundant network or database calls:

```python
class ThreatIntelProvider:
    def __init__(self) -> None:
        self._cache: dict[str, list[dict[str, Any]]] = {}

    def __call__(self, hashes: dict[str, str]) -> list[dict[str, Any]]:
        all_records: list[dict[str, Any]] = []

        for algorithm, hex_digest in hashes.items():
            cache_key = f"{algorithm}:{hex_digest}"

            if cache_key in self._cache:
                all_records.extend(self._cache[cache_key])
                continue

            records = self._query_api(algorithm, hex_digest)
            self._cache[cache_key] = records
            all_records.extend(records)

        return all_records
```

### Cache Invalidation

Session caches are automatically invalidated when the session ends. For persistent caches:

```python
from datetime import datetime, timedelta

class PersistentCache:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._cache: dict[str, tuple[Any, datetime]] = {}
        self._ttl = timedelta(seconds=ttl_seconds)

    def get(self, key: str) -> Any | None:
        if key in self._cache:
            value, timestamp = self._cache[key]
            if datetime.now() - timestamp < self._ttl:
                return value
            del self._cache[key]
        return None

    def set(self, key: str, value: Any) -> None:
        self._cache[key] = (value, datetime.now())
```

### Database Connection Pooling

For high-throughput scenarios, use connection pooling:

```python
from mhcp_database.connection import DatabaseConnection

class ConnectionPool:
    def __init__(self, db_path: str, pool_size: int = 5) -> None:
        self._pool: list[DatabaseConnection] = []
        self._db_path = db_path
        for _ in range(pool_size):
            conn = DatabaseConnection(db_path)
            conn.connect()
            self._pool.append(conn)

    def acquire(self) -> DatabaseConnection:
        return self._pool.pop()

    def release(self, conn: DatabaseConnection) -> None:
        self._pool.append(conn)
```

---

## Profiling Tools

### cProfile

Profile function call timing:

```bash
python -m cProfile -s cumtime -m pytest tests/ -v
```

### py-spy

Sampling profiler with low overhead:

```bash
pip install py-spy

# Profile a running process
py-spy top --pid <PID>

# Record a flame graph
py-spy record -o profile.svg --pid <PID>
```

### line_profiler

Profile individual lines of code:

```bash
pip install line_profiler

# Add @profile decorator to target function, then:
kernprof -l -v your_script.py
```

### tracemalloc

Built-in memory tracing:

```python
import tracemalloc

tracemalloc.start()

# ... code to profile ...

snapshot = tracemalloc.take_snapshot()
top_stats = snapshot.statistics("lineno")

for stat in top_stats[:10]:
    print(stat)
```

### pytest-benchmark

Run benchmarks as part of the test suite:

```bash
python -m pytest benchmarks/ -m benchmark --benchmark-only -v
```

### memory-profiler

Profile memory usage line by line:

```bash
pip install memory-profiler
python -m memory_profiler your_script.py
```

---

## Benchmarking Methodology

### Running Benchmarks

```bash
# Run all benchmarks
python -m pytest benchmarks/ -m benchmark --benchmark-only -v

# Run package-specific benchmarks
python -m pytest packages/scanner/benchmarks/ -v

# Run with custom minimum rounds
python -m pytest benchmarks/ --benchmark-min-rounds=20

# Compare against a previous run
python -m pytest benchmarks/ --benchmark-save=baseline
python -m pytest benchmarks/ --benchmark-compare=baseline
```

### Using the Dev Script

```bash
python scripts/dev/dev.py bench
python scripts/dev/dev.py bench --compare=baseline
python scripts/dev/dev.py bench --min-rounds=20
```

### Benchmark Best Practices

1. **Warm up** — Let the benchmark run at least one warm-up round.
2. **Stable environment** — Run benchmarks on a quiet system with consistent CPU frequency.
3. **Isolate** — Run benchmarks in isolation from other tests.
4. **Multiple rounds** — Use `--benchmark-min-rounds=10` for statistical significance.
5. **Baseline comparison** — Save a baseline before optimization, then compare after.

### Interpreting Results

A benchmark report shows:

```
Name                              Min       Max      Mean    StdDev  Median
test_benchmark_single_file_scan   1.23ms    2.45ms   1.67ms   0.34ms  1.58ms
```

- **Min/Max** — Best and worst case.
- **Mean** — Average across all rounds.
- **StdDev** — Consistency (lower is better).
- **Median** — Middle value, less affected by outliers.

---

## Performance Targets

### Hash Computation

| Metric | Target | Measurement |
|--------|--------|-------------|
| SHA-256 1KB file | < 1ms | `pytest-benchmark` |
| SHA-256 1MB file | < 50ms | `pytest-benchmark` |
| SHA-256 100MB file | < 5s | `pytest-benchmark` |
| Multi-hash (3 algos) 1MB | < 55ms | `pytest-benchmark` |

### Database Operations

| Metric | Target | Measurement |
|--------|--------|-------------|
| Single lookup | < 1ms | `pytest-benchmark` |
| Batch lookup (100) | < 10ms | `pytest-benchmark` |
| Table insert (1000) | < 100ms | `pytest-benchmark` |

### Scan Pipeline

| Metric | Target | Measurement |
|--------|--------|-------------|
| Single file scan (1KB) | < 5ms | `pytest-benchmark` |
| Batch scan (10 files, 1KB each) | < 50ms | `pytest-benchmark` |
| Full pipeline (hash + lookup + verdict) | < 10ms | `pytest-benchmark` |

### Memory Usage

| Metric | Target | Measurement |
|--------|--------|-------------|
| Peak memory (1KB file) | < 1MB | `memory-profiler` |
| Peak memory (100MB file) | < 2MB | `memory-profiler` |
| Database connection | < 5MB | `psutil` |

### Test Suite

| Metric | Target | Measurement |
|--------|--------|-------------|
| Unit tests (total) | < 5s | `pytest --duration` |
| Integration tests (total) | < 30s | `pytest --duration` |
| Full test suite | < 60s | `pytest --duration` |

### Optimization Checklist

When optimizing performance:

- [ ] Profile before and after changes
- [ ] Run benchmarks on a stable system
- [ ] Verify memory usage stays within targets
- [ ] Run the full test suite to catch regressions
- [ ] Document the optimization in commit message
- [ ] Update benchmarks if targets change
