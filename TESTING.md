# Testing Guide — SecureScan Pro X

## Overview

SecureScan Pro X follows a comprehensive testing strategy to ensure reliability, security, and accessibility. Every feature must include appropriate tests.

## Test Pyramid

```
        /\
       /  \        E2E Tests (Playwright)
      /    \       Few, critical workflows
     /------\
    /        \     Integration Tests (pytest + httpx)
   /          \    API endpoints, service interactions
  /------------\
 /              \  Unit Tests (pytest)
/                \ Fast, isolated, comprehensive
```

## Test Categories

### Unit Tests

**Tool**: pytest
**Location**: `backend/tests/unit/`, `frontend/tests/unit/`
**Target**: 90% coverage for services

Isolated tests of individual functions and methods.

```python
# backend/tests/unit/test_configuration_service.py
import pytest
from app.services.configuration import ConfigurationService

class TestConfigurationService:
    """Tests for ConfigurationService."""

    @pytest.fixture
    def service(self) -> ConfigurationService:
        """Create a fresh configuration service."""
        return ConfigurationService()

    def test_get_default_value(self, service: ConfigurationService) -> None:
        """Default values are returned for unset keys."""
        result = service.get("nonexistent.key", default="fallback")
        assert result == "fallback"

    def test_set_and_get(self, service: ConfigurationService) -> None:
        """Values persist within a session."""
        service.set("app.name", "TestApp")
        assert service.get("app.name") == "TestApp"
```

### Integration Tests

**Tool**: pytest + httpx
**Location**: `backend/tests/integration/`
**Target**: 95% coverage for API endpoints

Tests that verify interactions between components.

```python
# backend/tests/integration/test_workspace_api.py
import pytest
from httpx import AsyncClient

class TestWorkspaceAPI:
    """Integration tests for workspace API endpoints."""

    @pytest.mark.asyncio
    async def test_create_workspace(self, client: AsyncClient) -> None:
        """POST /api/v1/workspaces creates a workspace."""
        response = await client.post(
            "/api/v1/workspaces",
            json={"name": "Test Workspace"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Test Workspace"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_list_workspaces(self, client: AsyncClient) -> None:
        """GET /api/v1/workspaces lists all workspaces."""
        # Create test data
        await client.post(
            "/api/v1/workspaces",
            json={"name": "Workspace 1"},
        )
        response = await client.get("/api/v1/workspaces")
        assert response.status_code == 200
        assert len(response.json()) >= 1
```

### End-to-End Tests

**Tool**: Playwright
**Location**: `frontend/tests/e2e/`
**Target**: Critical user workflows

Full-stack tests simulating real user interactions.

```typescript
// frontend/tests/e2e/workspace.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Workspace Management', () => {
  test('can create a new workspace', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="create-workspace"]');
    await page.fill('[data-testid="workspace-name"]', 'My Workspace');
    await page.click('[data-testid="save-workspace"]');
    await expect(page.locator('text=My Workspace')).toBeVisible();
  });
});
```

### Accessibility Tests

**Tool**: axe-core + Playwright
**Location**: `frontend/tests/e2e/`

```typescript
// frontend/tests/e2e/accessibility.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('dashboard has no accessibility violations', async ({ page }) => {
    await page.goto('/dashboard');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
```

## Running Tests

### Backend Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/unit/test_configuration_service.py

# Run specific test class
pytest tests/unit/ -k "TestConfigurationService"

# Run with verbose output
pytest -v

# Run only marked tests
pytest -m "slow"
```

### Frontend Tests

```bash
cd frontend

# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Accessibility tests
pnpm test:a11y

# Coverage
pnpm test:coverage
```

## Test Markers

```python
# pytest markers
@pytest.mark.unit          # Unit test
@pytest.mark.integration   # Integration test
@pytest.mark.e2e           # End-to-end test
@pytest.mark.slow          # Long-running test
@pytest.mark.security      # Security test
@pytest.mark.accessibility # Accessibility test
```

## Test Data Management

### Fixtures

Use pytest fixtures for test data:

```python
@pytest.fixture
async def sample_workspace(db_session: AsyncSession) -> Workspace:
    """Create a sample workspace for testing."""
    workspace = Workspace(name="Test Workspace", description="Test")
    db_session.add(workspace)
    await db_session.commit()
    return workspace
```

### Factories

Use factory pattern for complex objects:

```python
class WorkspaceFactory:
    """Factory for creating test workspaces."""

    _counter = 0

    @classmethod
    def create(cls, **kwargs) -> Workspace:
        cls._counter += 1
        defaults = {
            "name": f"Workspace {cls._counter}",
            "description": f"Test workspace {cls._counter}",
        }
        defaults.update(kwargs)
        return Workspace(**defaults)
```

## Performance Tests

**Tool**: pytest-benchmark

```python
# backend/tests/benchmarks/test_search_benchmark.py
import pytest

class TestSearchBenchmark:
    """Performance benchmarks for search functionality."""

    def test_search_1000_findings(self, benchmark) -> None:
        """Search across 1000 findings completes in <100ms."""
        result = benchmark(search_findings, query="critical", limit=100)
        assert result is not None
```

## Security Tests

```python
# backend/tests/security/test_input_validation.py
import pytest

class TestInputValidation:
    """Security tests for input validation."""

    def test_sql_injection_prevented(self, client) -> None:
        """SQL injection attempts are rejected."""
        response = client.post(
            "/api/v1/workspaces",
            json={"name": "'; DROP TABLE workspaces; --"},
        )
        assert response.status_code == 422  # Validation error

    def test_xss_prevention(self, client) -> None:
        """XSS attempts are sanitized."""
        response = client.post(
            "/api/v1/workspaces",
            json={"name": "<script>alert('xss')</script>"},
        )
        assert "<script>" not in response.json().get("name", "")
```

## CI Integration

Tests run automatically in CI:

1. **Lint** — Code style and formatting
2. **Type Check** — MyPy strict mode
3. **Unit Tests** — Fast feedback
4. **Integration Tests** — Component interaction
5. **Security Tests** — Vulnerability detection
6. **Accessibility Tests** — WCAG compliance
7. **E2E Tests** — Critical workflows
8. **Coverage** — Threshold enforcement

## Coverage Thresholds

| Category | Minimum |
|---|---|
| Overall | 80% |
| Services | 90% |
| API Endpoints | 95% |
| Critical Paths | 100% |

## Writing Good Tests

### Principles

1. **Arrange, Act, Assert** — Clear test structure
2. **One assertion per concept** — Tests should verify one thing
3. **Descriptive names** — Test names explain what they test
4. **Independent** — Tests don't depend on each other
5. **Deterministic** — Same input, same output
6. **Fast** — Unit tests in milliseconds

### Anti-Patterns to Avoid

- Tests that depend on execution order
- Tests that modify shared state
- Tests that require network access (unless integration)
- Tests with hardcoded timestamps
- Tests that catch and ignore exceptions
- Tests without assertions
