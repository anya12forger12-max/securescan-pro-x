# Testing — SecureScan Pro X

## Backend Tests

```bash
cd backend
pip install -e ".[dev]"
pytest tests/ -v --cov=app --cov-report=term-missing
```

### Test Structure

- `tests/conftest.py` — Shared fixtures (async client, auth, services)
- `tests/unit/` — Unit tests for all services
  - `test_lifecycle.py` — Assessment state machine
  - `test_orchestrator.py` — Assessment orchestration
  - `test_workspace_service.py` — Workspace CRUD
  - `test_asset_service.py` — Asset CRUD
  - `test_audit_service.py` — Audit logging
  - `test_evidence_normalization.py` — Finding normalization
  - `test_profiles_policies.py` — Profiles and policies
  - `test_reports.py` — Report generation
  - `test_correlation.py` — Correlation engine
  - `test_configuration_service.py` — Configuration
  - `test_knowledge.py` — Knowledge base

## Frontend Tests

```bash
cd frontend
pnpm install
pnpm test
```

## Running All Checks

```bash
# Backend
cd backend
ruff check app/
ruff format --check app/
mypy app/ --ignore-missing-imports
bandit -r app/ -ll
pytest tests/ -v --cov=app

# Frontend
cd frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
