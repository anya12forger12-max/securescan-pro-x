# Architecture Overview

## System Architecture

SecureScan Pro X follows a strict layered architecture that enforces separation of concerns.

## Layers

### 1. Presentation Layer

**Location**: `frontend/src/`, `backend/app/api/`

Responsible for user interaction.

- **React UI** — Rendered via Tauri webview
- **REST API** — FastAPI endpoints
- **CLI** — Typer commands

### 2. Workspace Layer

**Location**: `backend/app/services/workspace.py`

Manages sessions and projects.

- Workspace CRUD
- Session management
- Permission checks

### 3. Assessment Layer

**Location**: `backend/app/services/assessment/`

Orchestrates security assessments.

- Assessment lifecycle
- Check orchestration
- Plugin invocation
- Result collection

### 4. Correlation Layer

Cross-references findings.

- Finding correlation
- Deduplication
- Impact clustering

### 5. Risk Engine

Calculates risk scores.

- CVSS scoring
- Risk rating
- Priority ordering

### 6. Knowledge Engine

Manages vulnerability intelligence.

- CVE/CWE mapping
- Compliance frameworks
- Mitigation recommendations

### 7. Reporting Layer

Generates assessment reports.

- Report generation (HTML, PDF, JSON)
- Template management
- Custom report builder

### 8. Platform Services

Cross-cutting concerns.

- Configuration
- Logging
- Audit
- Notifications
- Localization
- Theming

### 9. Infrastructure Layer

Platform-specific implementations.

- Filesystem operations
- Network utilities
- Cryptographic operations

### 10. Persistence Layer

Data storage.

- SQLAlchemy ORM
- Alembic migrations
- Repository pattern

## Dependency Flow

```
Presentation → Workspace → Assessment → Correlation
                   ↓            ↓            ↓
              Platform Services (shared)
                   ↓
              Infrastructure → Persistence
```

**Rule**: No layer may import from a layer above it.

## Security Architecture

- RBAC model with four roles
- Encrypted data at rest
- Audit logging for all operations
- Plugin sandboxing
- No network calls without consent

## Performance Targets

| Metric | Target |
|---|---|
| Startup | < 3 seconds |
| API response (p95) | < 100ms |
| Memory (idle) | < 200MB |
