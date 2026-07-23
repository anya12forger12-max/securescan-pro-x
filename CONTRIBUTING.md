# Contributing to SecureScan Pro X

Thank you for your interest in contributing to SecureScan Pro X! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing Requirements](#testing-requirements)
- [Documentation Requirements](#documentation-requirements)
- [Accessibility Requirements](#accessibility-requirements)
- [Security Requirements](#security-requirements)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)

## Code of Conduct

We follow the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold its standards.

## Getting Started

### Prerequisites

- Python 3.13+
- Node.js 20+
- Rust (latest stable)
- pnpm
- Git

### Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/securescan-pro-x.git
cd securescan-pro-x

# Create a branch
git checkout -b feature/your-feature-name

# Set up development environment
./scripts/dev/setup.sh
```

See [docs/guides/getting-started.md](docs/guides/getting-started.md) for detailed setup instructions.

## Development Workflow

### Branch Naming

| Prefix | Purpose |
|---|---|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation changes |
| `refactor/` | Code refactoring |
| `test/` | Test additions/fixes |
| `chore/` | Maintenance tasks |
| `security/` | Security improvements |
| `accessibility/` | Accessibility improvements |

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(auth): add RBAC permission checking
fix(api): handle empty assessment list correctly
docs(readme): update quick start section
security(plugins): validate plugin signatures
accessibility(ui): add ARIA labels to dashboard
test(services): add workspace service unit tests
refactor(core): extract configuration service interface
```

### Commit Requirements

Every commit must:

1. **Pass all CI checks** (linting, type checking, tests)
2. **Include tests** for new functionality
3. **Include documentation** updates
4. **Follow accessibility guidelines**
5. **Pass security review** for security-sensitive changes

## Code Standards

### Python (Backend)

- **Formatter**: Ruff (line length: 88)
- **Linter**: Ruff (with `SEC`, `B`, `S` rules enabled)
- **Type Checker**: MyPy (strict mode)
- **Style**: Follow PEP 8 with Ruff defaults

```python
# Example: Service interface
from abc import ABC, abstractmethod
from typing import Optional

class WorkspaceService(ABC):
    """Interface for workspace management operations."""

    @abstractmethod
    async def create_workspace(
        self,
        name: str,
        description: Optional[str] = None,
    ) -> Workspace:
        """Create a new workspace.

        Args:
            name: Unique workspace name.
            description: Optional description.

        Returns:
            The created workspace.

        Raises:
            WorkspaceExistsError: If name is already taken.
            PermissionError: If user lacks create permission.
        """
        ...
```

### TypeScript (Frontend)

- **Formatter**: Prettier
- **Linter**: ESLint
- **Style**: Strict TypeScript, functional components, hooks

```typescript
// Example: Accessible component
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  'aria-describedby'?: string;
}

export function Button({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
  'aria-describedby': describedBy,
}: ButtonProps): JSX.Element {
  return (
    <button
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      type="button"
    >
      {label}
    </button>
  );
}
```

### General Rules

1. **No comments** unless requested or required for complex logic
2. **Type hints** on all public functions
3. **Docstrings** on all public classes and functions (Google style)
4. **Error handling** — never swallow exceptions silently
5. **Logging** — structured logging with context
6. **Security** — never log secrets, validate all inputs

## Testing Requirements

### Test Categories

| Category | Tool | Requirement |
|---|---|---|
| Unit Tests | pytest | Required for all services |
| Integration Tests | pytest + httpx | Required for API endpoints |
| E2E Tests | Playwright | Required for critical workflows |
| Accessibility Tests | axe-core | Required for UI components |
| Type Checking | MyPy | Must pass strict mode |
| Linting | Ruff | Must pass with zero warnings |

### Test Standards

```python
# Example: Service unit test
import pytest
from unittest.mock import AsyncMock, MagicMock

class TestWorkspaceService:
    """Tests for WorkspaceService implementation."""

    @pytest.fixture
    def service(self) -> InMemoryWorkspaceService:
        """Create service with in-memory storage."""
        return InMemoryWorkspaceService()

    @pytest.mark.asyncio
    async def test_create_workspace_success(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Creating a workspace with valid data succeeds."""
        workspace = await service.create_workspace(
            name="Test Workspace",
            description="A test workspace",
        )
        assert workspace.name == "Test Workspace"
        assert workspace.id is not None

    @pytest.mark.asyncio
    async def test_create_workspace_duplicate_name(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Creating a workspace with duplicate name raises error."""
        await service.create_workspace(name="Existing")
        with pytest.raises(WorkspaceExistsError):
            await service.create_workspace(name="Existing")
```

### Coverage Requirements

- **Minimum**: 80% overall
- **Services**: 90% minimum
- **API Endpoints**: 95% minimum
- **Critical Paths**: 100%

## Documentation Requirements

### Code Documentation

- All public APIs must have docstrings
- Complex algorithms must have explanatory comments
- Architecture decisions must be documented in `docs/decisions/`

### User Documentation

- New features require user guides
- API changes require OpenAPI spec updates
- Breaking changes require migration guides

## Accessibility Requirements

All UI contributions must meet **WCAG 2.2 AA**:

- Keyboard navigable
- Screen reader compatible
- Proper ARIA attributes
- Sufficient color contrast (4.5:1 minimum)
- Focus indicators visible
- Reduced motion supported
- Large click targets (44x44px minimum)

See [ACCESSIBILITY.md](ACCESSIBILITY.md) for complete guidelines.

## Security Requirements

### Code Security

- Never hardcode secrets or credentials
- Validate all user inputs
- Use parameterized queries (no SQL injection)
- Follow OWASP guidelines
- Run `bandit` before submitting

### Dependency Security

- No new dependencies without review
- Prefer well-maintained, audited libraries
- Check `safety` scan before adding

### Plugin Security

- New plugins must declare permissions
- Plugin code must not access filesystem outside sandbox
- No dynamic code execution in plugins

## Pull Request Process

### Before Submitting

1. [ ] All tests pass (`pytest`, `pnpm test`)
2. [ ] Type checking passes (`mypy`, `pnpm typecheck`)
3. [ ] Linting passes (`ruff check`, `pnpm lint`)
4. [ ] Formatting is correct (`ruff format`, `pnpm format`)
5. [ ] Documentation is updated
6. [ ] Accessibility is verified
7. [ ] Security implications reviewed
8. [ ] CHANGELOG.md updated (if applicable)

### PR Template

```markdown
## Summary

Brief description of changes.

## Changes

- Change 1
- Change 2

## Testing

How was this tested?

## Accessibility

- [ ] Keyboard navigation verified
- [ ] Screen reader tested
- [ ] Color contrast checked
- [ ] ARIA attributes added

## Security

- [ ] No secrets committed
- [ ] Input validated
- [ ] Permissions checked
- [ ] Audit logging added

## Documentation

- [ ] Code documented
- [ ] User docs updated
- [ ] API docs updated
- [ ] CHANGELOG updated
```

### Review Process

1. Automated CI must pass
2. At least one maintainer review required
3. Security-sensitive changes require security review
4. UI changes require accessibility review
5. Documentation changes require docs review

## Issue Guidelines

### Bug Reports

- Include steps to reproduce
- Include expected vs actual behavior
- Include environment details
- Include screenshots if applicable

### Feature Requests

- Use the feature request template
- Explain the use case
- Describe the security value
- Note accessibility considerations

### Security Issues

**Do not** open public issues for security vulnerabilities. Follow the process in [SECURITY.md](SECURITY.md).

## Questions?

- **General**: GitHub Discussions
- **Development**: #development channel
- **Security**: security@securescan.dev
