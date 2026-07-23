# ADR-005: Cancellation and Recovery Strategy

## Status

Accepted

## Context

Scans may need to be cancelled for several reasons: user request, timeout, resource pressure, or system shutdown. When a scan is cancelled, resources must be cleaned up properly and no side effects should leak. Partial results should be preserved where possible to enable later analysis or resumption.

The cancellation mechanism must:
- Be thread-safe (cancellation may come from a different thread)
- Be non-blocking (the cancelling thread should not wait for the scan to finish)
- Guarantee cleanup execution even on cancellation
- Preserve partial results for debugging and reporting
- Support timeout-based automatic cancellation

## Decision

Thread-safe cancellation via `threading.Event`. Each pipeline stage checks for cancellation before proceeding. Cleanup callbacks are registered and executed on cancellation. `ScanSession` preserves partial results.

### Implementation Details

- **Cancellation signal**: `threading.Event` — thread-safe, non-blocking, O(1) check
- **Stage checks**: Each stage calls `cancellation_handler.is_cancelled()` before starting work
- **Cleanup callbacks**: Registered via `cancellation_handler.on_cancel(callback)`. Executed in LIFO order on cancellation
- **Partial results**: The `ScanContext` is preserved on cancellation. The session records which stages completed
- **Timeout**: Optional per-scan timeout. The cancellation handler registers a timer that fires the cancellation event after the configured duration
- **Context manager**: `with cancellation_handler.scoped():` ensures cleanup runs on any exit path

### Cancellation Flow

```
Cancellation Requested
        │
        ▼
┌─────────────────┐
│ Set Event Flag   │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Current Stage    │
│ Completes (if    │
│ already running) │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Next Stage       │
│ Checks Flag      │
│ → Raises         │
│   ScanCancelled  │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Cleanup Callbacks│
│ Execute (LIFO)   │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Session Marked   │
│ CANCELLED        │
│ Partial Results  │
│ Preserved        │
└─────────────────┘
```

## Consequences

### Positive

- Cancellation is non-blocking and thread-safe — the cancelling thread returns immediately
- Cleanup is guaranteed via callback registration — no resource leaks from interrupted scans
- Partial results are preserved in the session — enables debugging and partial reporting
- The `threading.Event` mechanism is well-tested and has no known race conditions
- Timeout support prevents runaway scans from consuming resources indefinitely
- Context manager pattern ensures cleanup on any exit path (normal, exception, cancellation)

### Negative

- The cancellation check adds a small overhead at each stage boundary (negligible in practice)
- Cleanup callbacks must be written carefully to avoid introducing new failure modes
- If a cleanup callback itself fails, other callbacks in the LIFO chain may not execute (mitigated by exception handling in the cleanup executor)

### Neutral

- The `threading.Event` approach is standard for Python cancellation patterns
- The callback-based cleanup model is familiar from context manager patterns
- Recovery from failures (FAILED → RECOVERING → PREPARING) uses the same cleanup infrastructure
