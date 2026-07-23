# Scan Engine Developer Guide

This guide covers the practical aspects of using, extending, and debugging the MHCP Scan Engine.

## Quick Start

### Running a Single File Scan

```python
from mhcp_scanner.engine import MHCPFileScanner
from pathlib import Path

scanner = MHCPFileScanner()
result = scanner.scan_file(Path("/path/to/file"))
print(result)
```

The `scan_file` method runs the full pipeline: validation, metadata collection, hash generation, database lookup, verdict generation, and cleanup. The returned result contains the verdict, timing data, and any errors encountered.

### Using the Pipeline Directly

For finer control, use the `ScanPipeline` directly:

```python
from mhcp_scanner.engine import ScanPipeline, PipelineConfig
from mhcp_hashing.algorithm import HashAlgorithm
from pathlib import Path

config = PipelineConfig(algorithms=[HashAlgorithm.SHA256])
pipeline = ScanPipeline(config=config)
session = pipeline.scan(Path("/path/to/file"))
```

This gives you access to the intermediate scan context, stage-by-stage timing, and the ability to customize the pipeline configuration.

### Custom Lookup Function

Override the default database lookup with your own implementation:

```python
from mhcp_scanner.engine import MHCPFileScanner
from mhcp_hashing.algorithm import HashAlgorithm

def my_lookup(hash_value: str, algorithm: HashAlgorithm) -> list[dict]:
    # Query your own database or API
    response = requests.get(f"https://api.example.com/check/{hash_value}")
    return response.json().get("matches", [])

scanner = MHCPFileScanner(
    hash_lookup_fn=my_lookup,
    algorithms=[HashAlgorithm.SHA256],
)
result = scanner.scan_file(Path("/path/to/file"))
```

The lookup function receives a hex-encoded hash string and the algorithm used, and returns a list of match records.

## Architecture Overview

The scan engine follows a layered architecture:

```
Public API (MHCPFileScanner)
    │
    ▼
Pipeline Orchestration (ScanPipeline)
    │
    ├── Validation
    ├── Metadata Collection
    ├── Hash Generation (HashBackend)
    ├── Database Lookup (Repository)
    ├── Verdict Generation
    └── Cleanup
    │
    ▼
Supporting Systems
    ├── State Machine
    ├── Progress Tracker
    ├── Cancellation Handler
    └── Session Manager
```

For the full architecture document, see [scan_engine_architecture.md](scan_engine_architecture.md).

## Components

### HashBackend

The `HashBackend` is a concrete implementation of file hashing using Python's `hashlib` module. It handles streaming reads, adaptive chunk sizing, and multi-algorithm computation.

Key characteristics:
- Streaming read with configurable chunk sizes
- Single-pass multi-algorithm computation (one read, multiple digests)
- Adaptive chunk sizing based on file size
- Progress reporting per chunk
- Thread-safe for concurrent access

```python
from mhcp_scanner.engine.backend import HashBackend
from mhcp_hashing.algorithm import HashAlgorithm

backend = HashBackend(
    algorithms=[HashAlgorithm.SHA256, HashAlgorithm.MD5],
    chunk_size=65536,
)
hashes = backend.hash_file(Path("/path/to/file"))
# Returns: {"sha256": "abc123...", "md5": "def456..."}
```

### ScanPipeline

The `ScanPipeline` orchestrates the six scanning stages in deterministic sequence. Each stage is an independent method that receives and enriches the scan context.

Key characteristics:
- Deterministic stage execution order
- Error handling at each stage boundary
- Cancellation checks between stages
- Per-stage performance metrics
- Extensible via stage hooks

```python
from mhcp_scanner.engine import ScanPipeline, PipelineConfig

pipeline = ScanPipeline(config=PipelineConfig())

# Run individual stages
context = pipeline.validate(path)
context = pipeline.collect_metadata(context)
context = pipeline.hash_generate(context)
context = pipeline.lookup(context)
context = pipeline.generate_verdict(context)
context = pipeline.cleanup(context)
```

### ScanStateMachine

The `ScanStateMachine` enforces valid state transitions and tracks the scan lifecycle.

Key characteristics:
- Type-safe state transitions
- Complete state history for audit trails
- Listener support for UI binding
- Terminal state enforcement
- Recovery path modeling

```python
from mhcp_scanner.engine.state import ScanState

# The state machine prevents invalid transitions
# and records all transitions in its history
state.transition(ScanState.PREPARING)  # IDLE -> PREPARING
state.transition(ScanState.HASHING)    # PREPARING -> HASHING
# state.transition(ScanState.IDLE)     # Invalid: raises StateTransitionError
```

### ScanSession

The `ScanSession` holds all metadata and results for a single scan operation.

Key characteristics:
- Complete scan metadata (path, timing, algorithm results)
- Performance metrics (stage durations, total time)
- Serializable to JSON for reporting
- Partial results preserved on cancellation or failure

### VerdictGenerator

The `VerdictGenerator` produces transparent, evidence-based verdicts. It never claims a file is "safe" — it reports findings, absence of findings, and limitations.

Key characteristics:
- Transparent reasoning with cited evidence
- Confidence levels based on data quality
- Limitations always documented
- Recommended actions provided
- Serializable for reports

### ProgressTracker

The `ProgressTracker` provides percentage-based progress reporting suitable for terminal output and screen readers.

Key characteristics:
- Percentage-based (0-100)
- Stage-aware granularity
- Estimated time remaining
- Screen-reader accessible output
- Configurable callback interval

### CancellationHandler

The `CancellationHandler` provides thread-safe scan cancellation with guaranteed cleanup.

Key characteristics:
- Thread-safe via `threading.Event`
- Non-blocking cancellation check
- Guaranteed cleanup callback execution
- Context manager for scoped cancellation
- Preserves partial results

### Scheduler

The `Scheduler` manages scan execution, supporting both immediate and queued operations.

Key characteristics:
- Immediate execution mode
- Queue management for batch operations
- Priority support (critical scans first)
- Concurrency limiting
- Result aggregation for batch scans

### HashRecordRepository

The `HashRecordRepository` provides database access for hash lookups and storage.

Key characteristics:
- Indexed queries for O(1) lookups
- Bulk operations for batch scanning
- Transaction support
- Connection pooling
- Schema migration support

## Testing

### Running Unit Tests

```bash
cd packages/scanner
pytest tests/engine/ -v
```

### Running Specific Test Suites

```bash
# State machine tests
pytest tests/engine/test_state_machine.py -v

# Pipeline tests
pytest tests/engine/test_pipeline.py -v

# Hash backend tests
pytest tests/engine/test_hash_backend.py -v
```

### Test Fixtures

The scanner package provides common test fixtures in `conftest.py`:

- `tmp_scan_file`: Creates a temporary file with random content
- `small_file`: 1KB test file
- `medium_file`: 1MB test file
- `large_file`: 10MB test file
- `mock_repository`: In-memory hash repository
- `sample_verdict`: Pre-built verdict for testing

## Benchmarks

### Running Benchmarks

```bash
cd packages/scanner
pytest benchmarks/ -v --benchmark-only
```

### Benchmark Suites

**Hash Benchmarks** (`benchmarks/test_hash_benchmarks.py`):
- Hash throughput for different algorithms and file sizes
- Chunk size optimization measurement
- Single-pass multi-hash performance
- Direct bytes computation speed

**Pipeline Benchmarks** (`benchmarks/test_pipeline_benchmarks.py`):
- End-to-end scan latency
- Individual stage timing
- Batch scan throughput

### Interpreting Results

Benchmark results include:
- `min` / `max`: Best and worst case performance
- `mean`: Average execution time
- `stddev`: Performance consistency (lower is better)
- `iterations`: Number of samples taken

Compare benchmarks against baseline to detect performance regressions.

## Adding a New Pipeline Stage

To add a new stage to the scan pipeline:

### 1. Define the Stage Method

```python
# In ScanPipeline class
def my_new_stage(self, context: ScanContext) -> ScanContext:
    """Stage description."""
    if self._cancellation_requested():
        raise ScanCancelledError()

    # Stage logic here
    context.my_stage_result = compute_something(context)

    return context
```

### 2. Add the State Transition

```python
# In ScanStateMachine transitions
ScanState.HASHING -> ScanState.MY_NEW_STAGE -> ScanState.LOOKING_UP
```

### 3. Register in Pipeline Execution Order

```python
# In ScanPipeline._execute_stages
stages = [
    self.validate,
    self.collect_metadata,
    self.hash_generate,
    self.my_new_stage,  # New stage here
    self.lookup,
    self.generate_verdict,
    self.cleanup,
]
```

### 4. Write Tests

```python
def test_my_new_stage():
    pipeline = ScanPipeline(config=PipelineConfig())
    context = ScanContext(path=Path("test.txt"))
    context = pipeline.validate(context)
    context = pipeline.collect_metadata(context)
    context = pipeline.hash_generate(context)
    context = pipeline.my_new_stage(context)

    assert context.my_stage_result is not None
```

### 5. Update Documentation

Add the new stage to `scan_engine_architecture.md` under Pipeline Stages, including its checks, inputs, outputs, and failure modes.

## Debugging

### Enable Debug Logging

```python
import logging
logging.getLogger("mhcp_scanner").setLevel(logging.DEBUG)
```

### Inspect Scan History

```python
result = scanner.scan_file(Path("/path/to/file"))
print(result.session.state_history)
# [('IDLE', '2025-01-01T00:00:00'),
#  ('PREPARING', '2025-01-01T00:00:00'),
#  ('HASHING', '2025-01-01T00:00:00'),
#  ...]
```

### Review Stage Timing

```python
result = scanner.scan_file(Path("/path/to/file"))
for stage, duration in result.session.stage_durations.items():
    print(f"{stage}: {duration:.4f}s")
```

### Access Verdict Details

```python
result = scanner.scan_file(Path("/path/to/file"))
print(f"Type: {result.verdict.type}")
print(f"Reason: {result.verdict.reason}")
print(f"Evidence: {result.verdict.evidence}")
print(f"Limitations: {result.verdict.limitations}")
print(f"Recommended: {result.verdict.recommended_action}")
```
