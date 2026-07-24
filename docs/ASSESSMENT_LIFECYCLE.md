# Assessment Lifecycle

## State Diagram

```
                    ┌──────────┐
                    │  Draft   │
                    └────┬─────┘
                         │ queue
                         ▼
                    ┌──────────┐
                    │  Queued  │
                    └────┬─────┘
                         │ prepare
                         ▼
                    ┌──────────┐
                    │ Preparing│
                    └────┬─────┘
                         │ start
                         ▼
                    ┌──────────┐
            ┌──────│ Running  │──────┐
            │      └────┬─────┘      │
            │ pause     │ collect    │ fail
            │           ▼            │
            │  ┌─────────────────┐   │
            │  │Collecting Evid. │   │
            │  └────────┬────────┘   │
            │           │ normalize  │
            │           ▼            │
            │  ┌─────────────────┐   │
            │  │Normalizing Res. │   │
            │  └────────┬────────┘   │
            │           │ correlate  │
            │           ▼            │
            │  ┌─────────────────┐   │
            │  │   Correlating   │   │
            │  └────────┬────────┘   │
            │           │ report     │
            │           ▼            │
            │  ┌─────────────────┐   │
            │  │Generating Report│   │
            │  └────────┬────────┘   │
            │           │ complete   │
            │           ▼            │
            │  ┌─────────────────┐   │
            └─▶│    Paused       │   │
               └─────────────────┘   │
                                     │
                    ┌──────────┐     │
                    │Completed │◀────┘
                    └────┬─────┘
                         │ archive
                         ▼
                    ┌──────────┐
                    │ Archived │
                    └──────────┘

         Any non-terminal state ──cancel──▶ Cancelled
         Failed state ──retry──▶ Queued
```

## Valid Transitions

| From | To | Trigger |
|------|-----|---------|
| Draft | Queued | queue() |
| Draft | Cancelled | cancel() |
| Queued | Preparing | start() |
| Queued | Cancelled | cancel() |
| Preparing | Running | start() |
| Preparing | Failed | error |
| Preparing | Cancelled | cancel() |
| Running | Collecting Evidence | auto |
| Running | Paused | pause() |
| Running | Failed | error |
| Running | Cancelled | cancel() |
| Collecting Evidence | Normalizing Results | auto |
| Collecting Evidence | Paused | pause() |
| Collecting Evidence | Failed | error |
| Collecting Evidence | Cancelled | cancel() |
| Normalizing Results | Correlating | auto |
| Normalizing Results | Paused | pause() |
| Normalizing Results | Failed | error |
| Normalizing Results | Cancelled | cancel() |
| Correlating | Generating Report | auto |
| Correlating | Paused | pause() |
| Correlating | Failed | error |
| Correlating | Cancelled | cancel() |
| Generating Report | Completed | complete() |
| Generating Report | Paused | pause() |
| Generating Report | Failed | error |
| Generating Report | Cancelled | cancel() |
| Completed | Archived | archive() |
| Paused | Running | resume() |
| Failed | Queued | retry() |
| Failed | Cancelled | cancel() |

## Terminal States

Once an assessment reaches `Archived` or `Cancelled`, no further transitions are possible.

## Retry Policy

- Failed assessments can be retried up to `max_retries` times (default: 3).
- Each retry increments `retry_count`.
- Retrying transitions Failed → Queued for re-execution.

## Progress Tracking

| State | Progress % |
|-------|-----------|
| Draft | 0% |
| Queued | 5% |
| Preparing | 10% |
| Running | 20% |
| Collecting Evidence | 50% |
| Normalizing Results | 70% |
| Correlating | 80% |
| Generating Report | 90% |
| Completed | 100% |
| Archived | 100% |
| Paused | Unknown (-1) |
| Failed | Unknown (-1) |
| Cancelled | Unknown (-1) |

## Recovery

The orchestrator can recover assessments that were interrupted (stuck in active states) by resetting them to `Queued` for re-execution. This handles cases where the application crashed during assessment execution.
