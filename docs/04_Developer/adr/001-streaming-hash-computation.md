# ADR-001: Streaming Hash Computation

## Status

Accepted

## Context

Files being scanned may range from a few bytes to multiple gigabytes. Loading entire files into memory for hash computation is impractical and poses denial-of-service risks. A user scanning a multi-gigabyte file should not cause the application to exhaust available memory, nor should scanning small files incur unnecessary overhead from chunked read machinery.

The hash engine must also support computing multiple algorithm digests simultaneously to avoid redundant I/O — reading the same file multiple times for different algorithms is wasteful and slow.

## Decision

Use streaming reads with adaptive chunk sizing. The `HashBackend` reads files in configurable chunks (default 64KB), adapting the chunk size based on file size. Multiple algorithms can be computed in a single pass to avoid redundant I/O.

### Implementation Details

- **Chunk sizes** are selected based on file size thresholds:
  - Files < 1MB: 4KB chunks (low latency for small reads)
  - Files 1MB–100MB: 64KB chunks (balanced throughput)
  - Files > 100MB: 256KB chunks (maximum throughput)
- **Single-pass computation** feeds each chunk to all active hash algorithms simultaneously
- **Progress reporting** occurs per-chunk, providing natural granularity for long-running scans
- **Cancellation checks** happen between chunks, ensuring timely response to user cancellation

## Consequences

### Positive

- Memory usage stays constant regardless of file size — a 10GB file uses the same memory as a 1KB file
- Single-pass multi-hash eliminates redundant reads, reducing I/O by a factor equal to the number of algorithms
- Adaptive chunk sizes optimize for both small files (low latency) and large files (high throughput)
- Progress reporting is natural and accurate (per-chunk granularity)
- Cancellation is responsive (checked between chunks, not mid-read)

### Negative

- Slightly more complex than single-call `hashlib.file_digest()` usage
- Manual chunk management introduces more code surface area
- Adaptive chunk sizing adds a decision branch that must be tested

### Neutral

- The implementation uses only the standard library (`hashlib`), introducing no new dependencies
- Chunk size configuration is exposed for benchmarking and tuning
