# ADR-003: Deterministic State Machine

## Status

Accepted

## Context

Scan operations have a lifecycle with strict ordering requirements. A scan cannot be hashing before validation passes, and a completed scan should not accept new work. Invalid state transitions can cause data corruption, inconsistent results, or resource leaks.

The state machine must:
- Prevent invalid transitions at the type level
- Support debugging via transition history
- Allow UI binding without tight coupling to the pipeline
- Model recovery paths for transient failures
- Enforce proper cleanup at terminal states

## Decision

Use a finite state machine with validated transitions. All state changes go through the state machine which validates legality, records history, and notifies listeners.

### States

```
IDLE → PREPARING → HASHING → LOOKING_UP → GENERATING_VERDICT → COMPLETED
                                                            ↓
Any active state → FAILED / CANCELLED
                   ↓
              RECOVERING → PREPARING
```

### Implementation Details

- All transitions are validated against a transition table before execution
- Invalid transitions raise `StateTransitionError` with context
- Complete state history is maintained as an ordered list of `(state, timestamp)` tuples
- Listeners are notified synchronously on each transition
- Terminal states (`COMPLETED`, `FAILED`, `CANCELLED`) can only transition back to `IDLE`
- Recovery transitions are explicitly modeled (FAILED → RECOVERING → PREPARING)

## Consequences

### Positive

- Invalid transitions are prevented at the type level — a scan cannot jump from IDLE to LOOKING_UP
- State history enables debugging and audit trails (every transition is recorded)
- Listeners allow UI binding without tight coupling — the UI observes state changes without polling
- Terminal states enforce proper cleanup — a scan must be completed or cancelled before starting a new one
- Recovery paths are explicitly modeled, not implicit

### Negative

- The state machine adds a layer of indirection between the pipeline and its state
- The transition table must be maintained as the pipeline evolves
- Listener notification is synchronous, which could block the pipeline if a listener is slow

### Neutral

- The finite state machine pattern is well-established and has strong formal foundations
- The state machine is isolated from the pipeline logic — it can be replaced or extended independently
