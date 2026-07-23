# Scan Engine Architecture

## Overview

The Scan Engine is the orchestration layer that coordinates all subsystems of the Malware Hash Checker Pro into a unified scanning workflow. It transforms a file path into a transparent, evidence-based verdict through a deterministic pipeline of well-defined stages.

The design prioritizes safety, transparency, and testability. Every stage is independently verifiable, every decision is documented, and the engine never overstates its confidence.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    MHCPFileScanner                        │
│                (Public API Surface)                       │
├──────────────────────────────────────────────────────────┤
│                     ScanPipeline                          │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐ │
│  │ Validate │──▶│ Metadata │──▶│  Hash Generation     │ │
│  │          │   │Collection│   │  (Multi-Algorithm)   │ │
│  └──────────┘   └──────────┘   └──────────────────────┘ │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐ │
│  │  Lookup  │──▶│ Verdict  │──▶│     Cleanup          │ │
│  │          │   │Generation│   │                      │ │
│  └──────────┘   └──────────┘   └──────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│                   Supporting Systems                      │
│                                                          │
│  ┌───────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ State Machine │  │   Progress   │  │  Cancellation │ │
│  │               │  │   Tracker    │  │    Handler    │ │
│  └───────────────┘  └──────────────┘  └───────────────┘ │
│                                                          │
│  ┌───────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │    Session    │  │   Verdict    │  │    Results    │ │
│  │   Manager     │  │  Generator   │  │   Formatter   │ │
│  └───────────────┘  └──────────────┘  └───────────────┘ │
├──────────────────────────────────────────────────────────┤
│                    Infrastructure                         │
│                                                          │
│  ┌───────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  HashBackend  │  │  Repository  │  │   Scheduler   │ │
│  │  (hashlib)    │  │  (Database)  │  │               │ │
│  └───────────────┘  └──────────────┘  └───────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Pipeline Stages

The scan pipeline executes six stages in strict sequence. Each stage receives the output of the previous stage and may short-circuit on error or cancellation.

### Stage 1: Validation

The validation stage ensures a file is a safe and valid target before any processing occurs.

Checks performed:
- File exists at the specified path
- File is readable by the current process
- File size is within configured limits (prevents resource exhaustion)
- Path passes safety checks (no traversal, no symlinks to restricted areas)
- Path resolves to a regular file (not a directory, device, or socket)

On failure: the pipeline short-circuits immediately and returns a validation error verdict. No resources are allocated for subsequent stages.

### Stage 2: Metadata Collection

Gathers filesystem metadata without modifying the file.

Data collected:
- File size in bytes
- Last modification time
- Unix permissions and ownership flags
- Executable status (based on extension and permission bits)
- Absolute resolved path

Metadata is attached to the scan context for use in verdict generation and audit trails.

### Stage 3: Hash Generation

Computes cryptographic hashes of the file contents using the configured algorithms.

Features:
- Streaming read with configurable chunk sizes (default 64KB)
- Adaptive chunk sizing based on file size
- Single-pass multi-algorithm computation (avoids redundant I/O)
- Progress reporting per chunk for long-running scans
- Cancellation checks between chunks

The output is a dictionary mapping algorithm names to hex-encoded digest strings.

### Stage 4: Database Lookup

Compares computed hashes against the known malware hash database.

Behavior:
- Each hash algorithm is looked up independently
- Results are aggregated across algorithms
- Missing hashes are recorded (absence of evidence is not evidence of absence)
- Database unavailability is treated as an UNKNOWN result, not a failure
- Lookups use indexed queries for performance

### Stage 5: Verdict Generation

Produces a transparent, evidence-based verdict from all collected data.

A verdict contains:
- **Type**: MALICIOUS, SUSPICIOUS, UNKNOWN, or ERROR
- **Reason**: Human-readable explanation
- **Evidence**: Database matches, algorithms used, confidence level
- **Limitations**: What the engine cannot determine
- **Recommended action**: Next steps for the user

The engine NEVER declares a file "safe." It reports what was found, what was not found, and what it cannot determine.

### Stage 6: Cleanup

Finalizes the scan session and releases resources.

Actions:
- Session metadata is finalized (timing, stage durations)
- Temporary resources are released
- Final log entry is written
- Scan context is prepared for serialization

## State Machine

The scan lifecycle is managed by a finite state machine with validated transitions.

### States

| State | Description |
|---|---|
| `IDLE` | No scan in progress; ready to accept work |
| `PREPARING` | Validating input and collecting metadata |
| `HASHING` | Computing file hashes |
| `LOOKING_UP` | Querying the hash database |
| `GENERATING_VERDICT` | Producing the final verdict |
| `COMPLETED` | Scan finished successfully |
| `FAILED` | Scan encountered an unrecoverable error |
| `CANCELLED` | Scan was cancelled by user or system |
| `RECOVERING` | Attempting to recover from a transient failure |

### Transition Diagram

```
                    ┌──────────┐
         ┌─────────│   IDLE   │─────────┐
         │         └──────────┘         │
         │               │              │
         │               ▼              │
         │         ┌──────────┐         │
         │         │PREPARING │         │
         │         └──────────┘         │
         │          │       │           │
         │          ▼       ▼           │
         │   ┌──────────┐ ┌──────┐     │
         │   │ HASHING  │ │FAILED│     │
         │   └──────────┘ └──────┘     │
         │          │       ▲           │
         │          ▼       │           │
         │   ┌──────────┐  │           │
         │   │LOOKING_UP│  │           │
         │   └──────────┘  │           │
         │          │       │           │
         │          ▼       │           │
         │   ┌──────────┐  │           │
         │   │GENERATING│  │           │
         │   │ VERDICT  │  │           │
         │   └──────────┘  │           │
         │          │       │           │
         │          ▼       │           │
         │   ┌──────────┐  │           │
         └──▶│COMPLETED │  │           │
             └──────────┘  │           │
                  │        │           │
                  ▼        ▼           │
             ┌──────────────────┐      │
             │    RECOVERING    │──────┘
             └──────────────────┘
```

### Transition Rules

| From | To | Trigger |
|---|---|---|
| IDLE | PREPARING | Scan initiated |
| PREPARING | HASHING | Validation passed |
| PREPARING | FAILED | Validation error |
| HASHING | LOOKING_UP | Hashes computed |
| HASHING | FAILED | Read error or hash failure |
| LOOKING_UP | GENERATING_VERDICT | Lookup complete |
| LOOKING_UP | FAILED | Database error (non-recoverable) |
| GENERATING_VERDICT | COMPLETED | Verdict produced |
| GENERATING_VERDICT | FAILED | Verdict generation error |
| Any active | CANCELLED | Cancellation requested |
| FAILED | RECOVERING | Recovery initiated |
| RECOVERING | PREPARING | Recovery successful |
| COMPLETED | IDLE | Session reset |
| CANCELLED | IDLE | Session reset |

## Data Flow

```
File Path
    │
    ▼
┌────────────┐     ┌────────────┐     ┌────────────┐
│ Validation │────▶│  Metadata  │────▶│    Hash    │
│            │     │Collection  │     │Generation  │
└────────────┘     └────────────┘     └────────────┘
                                           │
                        Hash Dictionary    │
                        ┌──────────────────┘
                        │
                        ▼
                  ┌────────────┐     ┌────────────┐     ┌────────────┐
                  │  Database  │────▶│  Verdict   │────▶│  Session   │
                  │   Lookup   │     │Generation  │     │  Results   │
                  └────────────┘     └────────────┘     └────────────┘
```

Each arrow represents the scan context being enriched with additional data. The context object carries all state through the pipeline.

## Error Recovery

The engine implements a layered error recovery strategy:

### Read Interruption

When a file read is interrupted (e.g., file truncated during scan):
1. The current partial hash is discarded
2. The pipeline retries with a smaller chunk size
3. If retry fails, the scan is marked as FAILED with a descriptive error
4. The partial scan context is preserved for diagnostics

### Database Unavailable

When the hash database cannot be reached:
1. The lookup stage returns an empty result set
2. The verdict type is set to UNKNOWN
3. A limitation is recorded: "Database unavailable; hash comparison skipped"
4. The scan continues to verdict generation

### Cancellation

When a scan is cancelled:
1. The cancellation handler sets the cancellation event
2. Each stage checks for cancellation before processing
3. Cleanup callbacks are executed in reverse registration order
4. The session is marked as CANCELLED with partial results preserved

### Exception Handling

When an unexpected exception occurs:
1. The exception is caught and recorded in the scan context
2. The state machine transitions to FAILED
3. The error details are attached to the verdict
4. A stack trace is captured for debugging (sensitive data redacted)

## Performance Considerations

### Streaming I/O

Files are never loaded entirely into memory. The HashBackend reads files in chunks, keeping memory usage constant regardless of file size. This is critical for scanning large files on memory-constrained systems.

### Adaptive Chunk Sizing

Chunk sizes are adjusted based on file size:
- Small files (<1MB): 4KB chunks for low latency
- Medium files (1MB-100MB): 64KB chunks for balanced throughput
- Large files (>100MB): 256KB chunks for maximum throughput

### Single-Pass Multi-Hash

When multiple hash algorithms are configured, all algorithms are computed in a single read pass. This eliminates redundant disk I/O, which is the primary bottleneck for hash computation.

### Indexed Database Lookups

The hash repository uses indexed database queries. Lookups are O(1) per hash with proper indexing. Bulk operations are supported for batch scanning.

### In-Memory Caching

Recently looked-up hashes are cached in memory. This eliminates redundant database queries when the same file is scanned multiple times or when multiple algorithms produce the same hash.

## Security Considerations

### Path Traversal Prevention

All file paths are resolved to absolute paths before processing. Symlink targets are validated. Paths containing `..` components are rejected. The security module performs all path validation.

### Permission Checks

The engine checks file permissions before attempting reads. Read permission is required. The engine does not modify files, create temporary files in the scan target directory, or execute file contents.

### No File Execution

File contents are never executed, interpreted, or loaded as code. Files are read as raw bytes only. This prevents code execution attacks via malicious file contents.

### Sensitive Data Redaction

Log outputs automatically redact sensitive information (hashes in some contexts, full file paths in user-facing messages, configuration secrets). The logging module handles all redaction.

### Read-Only Operations

The scan engine performs only read operations on the filesystem. No files are created, modified, or deleted during a scan. Temporary resources are created in designated scratch directories and cleaned up after the scan.

## Extensibility

The architecture supports the following future extensions:

### Custom Hash Algorithms

New algorithms can be added by implementing the `HashAlgorithm` interface and registering with the backend. The pipeline adapts automatically.

### Custom Verdict Logic

Verdict generation is decoupled from the pipeline. Custom verdict generators can be injected to implement organization-specific heuristics.

### Plugin Providers

The pipeline supports pre-stage and post-stage hooks for external integrations (e.g., external threat intelligence lookups, custom logging).

### Async Pipeline

The current synchronous pipeline can be extended to an async variant with minimal changes. The stage-based architecture maps naturally to coroutine chains.
