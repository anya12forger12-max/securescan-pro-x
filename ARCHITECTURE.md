# Architecture — SecureScan Pro X

## 1. Overview

SecureScan Pro X is built on a strict layered architecture that enforces separation of concerns, prevents circular dependencies, and enables independent testing and evolution of each layer.

## 2. Architecture Principles

1. **Strict Layering** — Each layer only depends on layers below it. No upward or lateral dependencies.
2. **Dependency Injection** — Services are injected, not imported. Enables testing and modularity.
3. **Interface Segregation** — Layers communicate through well-defined interfaces (abstract base classes).
4. **Single Responsibility** — Each service does one thing well.
5. **Explicit Dependencies** — No hidden coupling. All dependencies declared.

## 3. Layer Architecture

### 3.1 Presentation Layer

**Location**: `frontend/src/`, `backend/app/api/`

Responsible for user interaction and data visualization.

- **Frontend**: React + TypeScript rendered via Tauri webview
- **API Layer**: FastAPI REST endpoints exposed to the frontend
- **CLI Layer**: Typer-based command-line interface

The presentation layer contains no business logic. It delegates all operations to the Workspace Layer.

```
┌────────────────────────────────────────────┐
│              Presentation Layer            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │  React   │  │ FastAPI  │  │  CLI     ││
│  │  UI      │  │ REST API │  │ (Typer)  ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘│
│       └──────────────┼──────────────┘      │
│                      ▼                     │
└────────────────────────────────────────────┘
```

### 3.2 Workspace Layer

**Location**: `backend/app/services/workspace.py`

Manages sessions, projects, and workspaces. This is the primary entry point for all business operations.

- Workspace CRUD (create, read, update, delete)
- Session management (active assessment contexts)
- State persistence
- Permission checks via RBAC

### 3.3 Assessment Layer

**Location**: `backend/app/services/assessment/`

Orchestrates security assessments against target assets.

- Assessment lifecycle (plan → execute → collect → analyze)
- Check orchestration
- Plugin invocation
- Result aggregation
- Progress tracking

**Note**: Phase 1A scaffolds this layer only. No scanning capability is implemented.

### 3.4 Correlation Layer

**Location**: `backend/app/services/correlation/`

Cross-references findings from multiple checks to identify patterns and compound risks.

- Finding correlation
- Deduplication
- Impact clustering
- Trend analysis

### 3.5 Risk Engine

**Location**: `backend/app/services/risk/`

Calculates and prioritizes risks based on findings.

- CVSS scoring (v3.1, v4.0)
- Risk rating computation
- Priority ordering
- Business impact mapping

### 3.6 Knowledge Engine

**Location**: `backend/app/services/knowledge/`

Manages vulnerability intelligence and compliance knowledge.

- Vulnerability database
- Compliance framework mapping
- Mitigation recommendations
- CVE/CWE correlation

### 3.7 Reporting Layer

**Location**: `backend/app/services/reporting/`

Generates assessment reports in multiple formats.

- Report generation (HTML, PDF, JSON, CSV)
- Template management
- Custom report builder
- Executive summaries

### 3.8 Platform Services

**Location**: `backend/app/services/`

Cross-cutting concerns used by all layers.

| Service | Purpose |
|---|---|
| Configuration | Application settings |
| Logging | Structured logging |
| Audit | Audit trail |
| Notification | User notifications |
| Localization | i18n/l10n |
| Theme | UI theming |
| Permission | RBAC enforcement |
| Scheduler | Task scheduling |
| Health | System health checks |
| Diagnostics | Self-diagnostics |
| Search | Full-text search |
| Backup | Data backup/restore |

### 3.9 Infrastructure Layer

**Location**: `backend/app/core/`

Platform-specific implementations.

- Filesystem operations
- Network utilities
- Cryptographic operations
- OS integration
- Process management

### 3.10 Persistence Layer

**Location**: `backend/app/models/`, `database/`

Data storage and retrieval.

- SQLAlchemy ORM models
- Alembic migrations
- Repository pattern
- Database abstraction (SQLite → PostgreSQL)

## 4. Dependency Flow

```
Presentation → Workspace → Assessment → Correlation
                   ↓            ↓            ↓
              Platform Services (shared)
                   ↓
              Infrastructure → Persistence
```

**Rule**: No layer may import from a layer above it. Cross-layer communication occurs through service interfaces.

## 5. Data Flow

```
User Action → API/CLI → Workspace Service → Assessment Service
                                                    ↓
                                            Plugin Manager
                                                    ↓
                                            Check Execution
                                                    ↓
                                            Result Collection
                                                    ↓
                                            Correlation Engine
                                                    ↓
                                            Risk Engine
                                                    ↓
                                            Report Generator
                                                    ↓
                                            Persistence + UI Update
```

## 6. Security Architecture

### 6.1 Authentication & Authorization

- **RBAC Model**: Role-Based Access Control with granular permissions
- **Roles**: Admin, Analyst, Viewer, Auditor
- **Permissions**: Scoped to workspace, assessment, and resource levels

### 6.2 Data Security

- All data at rest encrypted (AES-256-GCM)
- Credentials stored in OS keychain or encrypted file
- Audit log for all privileged operations
- No data leaves the local machine without explicit consent

### 6.3 Plugin Security

- Plugins run in sandboxed context
- Permission model: plugins declare required permissions
- Plugin signature verification
- Resource limits enforced

## 7. Plugin Architecture

```
┌──────────────────────────────────┐
│         Plugin Manager           │
├──────────────────────────────────┤
│   Plugin Registry                │
│   ├── Discovery (filesystem)     │
│   ├── Loading (dynamic import)   │
│   ├── Validation (schema check)  │
│   └── Lifecycle (init/run/stop)  │
├──────────────────────────────────┤
│   Plugin Context                 │
│   ├── Permissions                │
│   ├── Resources                  │
│   ├── EventBus                   │
│   └── Storage                    │
├──────────────────────────────────┤
│   SDK Interface                  │
│   ├── Check Interface            │
│   ├── Reporter Interface         │
│   └── Knowledge Interface        │
└──────────────────────────────────┘
```

## 8. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Desktop Framework | Tauri | Small binary, Rust security, web UI flexibility |
| Backend Language | Python 3.13+ | Rich ecosystem, fast development, security tooling |
| API Framework | FastAPI | Async support, auto-generated docs, type safety |
| ORM | SQLAlchemy 2.0+ | Mature, async support, PostgreSQL compatibility |
| Migrations | Alembic | Standard with SQLAlchemy, reversible |
| Validation | Pydantic v2 | Type-safe, fast, integrates with FastAPI |
| Frontend | React + TypeScript | Ecosystem, Tauri integration, accessibility |
| Database | SQLite | Zero-config, portable, sufficient for single-user |
| CLI | Typer | Modern, type-safe, auto-generates help |
| Documentation | MkDocs Material | Beautiful, searchable, Mermaid support |

## 9. Cross-Cutting Concerns

### 9.1 Logging

Structured JSON logging with correlation IDs. Log levels configurable per module.

```python
logger = get_logger(__name__)
logger.info("assessment.started", assessment_id=aid, target=target)
```

### 9.2 Audit Logging

Immutable audit trail for all security-relevant operations. Stored separately from application data.

### 9.3 Error Handling

- All errors are typed (custom exception hierarchy)
- User-facing errors are sanitized (no stack traces)
- Internal errors logged with full context
- Graceful degradation for non-critical failures

### 9.4 Configuration

Three-tier configuration:
1. **Defaults** — Built-in sensible defaults
2. **System** — Installed configuration
3. **User** — Per-user overrides

Later tiers override earlier tiers.

## 10. Performance Targets

| Metric | Target |
|---|---|
| Application startup | < 3 seconds |
| API response time (p95) | < 100ms |
| Assessment start latency | < 500ms |
| Report generation (100 findings) | < 5 seconds |
| Memory usage (idle) | < 200MB |
| Database query (p95) | < 50ms |

## 11. Testing Strategy

| Layer | Test Type | Tool |
|---|---|---|
| Unit | Service logic | pytest |
| Integration | API + DB | pytest + httpx |
| E2E | Full workflow | Playwright |
| Accessibility | WCAG compliance | axe-core |
| Security | SAST/DAST | Bandit, Safety |
| Performance | Benchmarks | pytest-benchmark |

## 12. Deployment Models

| Model | Description | Target |
|---|---|---|
| Desktop App | Native Tauri binary | All platforms |
| CLI | Python package + binary | All platforms |
| Docker | Containerized services | Server/cloud |
| Source | Development install | Contributors |

## 13. Future Considerations

- PostgreSQL support via repository abstraction
- Team collaboration via shared workspace protocol
- Multi-user RBAC with session management
- Remote assessment orchestration (opt-in only)
- API-first design for third-party integration
