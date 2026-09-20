# Assessment Architecture

## Overview

The Assessment Framework is the core module of SecureScan Pro X. It coordinates the complete lifecycle of security assessments from creation through completion, including evidence collection, result normalization, correlation, and report generation.

**No actual vulnerability detection or network probing is implemented.** The framework operates with demo data and imported results only.

## Architecture Layers

```
┌─────────────────────────────────────────┐
│         API Layer (FastAPI)              │
├─────────────────────────────────────────┤
│     Assessment Orchestrator             │
├──────────┬──────────┬───────────────────┤
│ Lifecycle│ Evidence │ Normalization     │
│ State    │ Pipeline │ Engine            │
│ Machine  │          │                   │
├──────────┴──────────┴───────────────────┤
│   Profiles  │  Policies  │ Correlation  │
├─────────────┴────────────┴──────────────┤
│        Report Pipeline                   │
├─────────────────────────────────────────┤
│     Knowledge Integration               │
├─────────────────────────────────────────┤
│        Event Bus                         │
├─────────────────────────────────────────┤
│     Persistence Layer (In-Memory/DB)    │
└─────────────────────────────────────────┘
```

## Core Components

### Assessment Orchestrator
Central coordinator managing the full assessment lifecycle. Responsibilities:
- Assessment creation and configuration
- State transition management
- Job queuing and execution coordination
- Event publishing
- Progress tracking
- Failure recovery

### Lifecycle State Machine
Deterministic state machine governing assessment transitions:
- **Draft** → Queued → Preparing → Running → Collecting Evidence → Normalizing Results → Correlating → Generating Report → Completed → Archived
- **Pause/Resume** supported from Running through Generating Report
- **Cancel** supported from all non-terminal states
- **Retry** supported from Failed state

### Evidence Pipeline
Manages evidence collection, integrity verification, and retention:
- SHA-256 integrity hashing
- Classification (Public/Internal/Confidential/Restricted)
- Source tracking and provenance
- Retention policies

### Result Normalization
All assessment modules must output `NormalizedFinding` objects:
- Title, summary, severity, confidence
- Evidence references and recommendations
- Plugin attribution
- No proprietary formats allowed

### Report Pipeline
Generates reports in multiple formats:
- **JSON** — Machine-readable structured data
- **Markdown** — Human-readable documentation
- **HTML** — Interactive web report with dark theme
- **CSV** — Spreadsheet-compatible findings table

Each report includes:
- Executive summary
- Assessment metadata
- Severity distribution
- Findings with details
- Evidence summary
- Timeline
- Appendix

### Event Bus
Publishes events for all assessment lifecycle changes:
- Assessment created/started/paused/completed/failed
- Evidence added
- Report generated
- Subscribers can listen to specific event types or all events

## Data Model

### Assessment
Core entity with:
- Full lifecycle timestamps
- Progress tracking
- Retry management
- Profile and policy references
- Soft delete support

### Assessment Job
Discrete unit of work within an assessment:
- Plugin association
- Target reference
- Timeout management
- Result storage

### Assessment Target
Links assessments to assets with evaluation context.

### Evidence
Collected data with:
- Integrity hash for tamper detection
- Classification and retention
- Source provenance
- Finding association

### Finding
Normalized security observations with severity, confidence, and knowledge links.

### Recommendation
Actionable remediation guidance with explanations and learning resources.

## Profiles

Reusable assessment configurations:
- Quick Review (600s, summary)
- Baseline Review (3600s, standard)
- Configuration Audit (7200s, detailed)
- Compliance Review (10800s, compliance)
- Demo Assessment (300s, summary)

## Policies

Governance rules controlling:
- Maximum runtime and resource limits
- Logging level
- Retention and export rules
- Approval requirements
- Plugin permissions

## Integration Points

### Plugin System
Assessment jobs invoke check plugins to evaluate targets. The orchestrator coordinates plugin execution and collects results.

### Knowledge Service
Findings are enriched with contextual knowledge entries providing explanations, actions, and learning resources.

### Correlation Engine
Future engine will merge duplicate findings, detect related issues, and track recurring patterns. Currently a no-op interface.
