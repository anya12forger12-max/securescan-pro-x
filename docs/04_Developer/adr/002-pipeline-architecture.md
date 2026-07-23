# ADR-002: Pipeline Architecture

## Status

Accepted

## Context

File scanning involves multiple sequential steps: validation, metadata collection, hash generation, database lookup, verdict generation, and cleanup. Each step has different failure modes, performance characteristics, and requirements. A monolithic scan function would be difficult to test, extend, and debug.

The pipeline must support:
- Independent testing of each stage
- Per-stage error handling and recovery
- Cancellation between stages without wasted computation
- Performance metrics per stage for optimization
- Future extensibility (adding new stages without modifying existing ones)

## Decision

Implement a deterministic pipeline where each stage is an independent, testable method. The pipeline orchestrates stages in sequence with error handling at each step.

### Implementation Details

- Each stage is a method on `ScanPipeline` that receives and returns a `ScanContext`
- Stages execute in a fixed, documented order
- The `ScanContext` carries all state through the pipeline
- Error handling is localized to each stage boundary
- Cancellation is checked between stages (not within them)
- Per-stage timing is recorded automatically
- Stage hooks allow pre/post processing without modifying stage code

### Stage Execution Order

```
validate → collect_metadata → hash_generate → lookup → generate_verdict → cleanup
```

## Consequences

### Positive

- Each stage is independently testable with a `ScanContext` fixture
- Error handling is localized — a stage failure doesn't corrupt other stages
- Pipeline can be extended by adding new stages without modifying existing ones
- Cancellation is checked at natural boundaries between stages
- Performance metrics are captured per-stage, enabling targeted optimization
- Stages can be skipped or reordered for different scan profiles (e.g., quick scan vs. full scan)

### Negative

- The strict sequential execution model cannot express stage parallelism (e.g., hash and metadata collection could theoretically overlap)
- The `ScanContext` object accumulates state from all stages, which could become a large object for complex scans
- Debugging requires understanding the full pipeline flow, not just a single function

### Neutral

- The pipeline pattern is well-understood and widely used in data processing frameworks
- The stage-based architecture maps naturally to both synchronous and future async implementations
