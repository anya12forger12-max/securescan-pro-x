# Style Guide — SecureScan Pro X

## Overview

This guide establishes coding standards for all SecureScan Pro X contributions. Consistency improves readability, maintainability, and collaboration.

## Python (Backend)

### Formatting

- **Formatter**: Ruff
- **Line Length**: 88 characters
- **Quotes**: Double quotes for strings
- **Trailing Commas**: Yes, on multiline

### Import Order

```python
# Standard library
import os
from pathlib import Path

# Third-party
import sqlalchemy as sa
from fastapi import APIRouter
from pydantic import BaseModel

# Local
from app.core.config import settings
from app.services.workspace import WorkspaceService
```

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Module | snake_case | `workspace_service.py` |
| Class | PascalCase | `WorkspaceService` |
| Function | snake_case | `create_workspace()` |
| Method | snake_case | `get_workspace()` |
| Variable | snake_case | `workspace_name` |
| Constant | UPPER_SNAKE | `MAX_RETRIES` |
| Type Variable | PascalCase + T | `ServiceT` |
| Private | _leading | `_internal_state` |
| Protected | _leading | `_shared_cache` |

### Type Hints

Every public function must have complete type hints:

```python
async def create_workspace(
    self,
    name: str,
    description: Optional[str] = None,
    owner_id: Optional[UUID] = None,
) -> Workspace:
    """Create a new workspace."""
    ...
```

### Docstrings

Google style docstrings for all public functions:

```python
async def assess_asset(
    self,
    asset_id: UUID,
    checks: List[str],
    config: Optional[AssessmentConfig] = None,
) -> AssessmentResult:
    """Run security assessment against a target asset.

    Executes the specified checks against the given asset and
    returns a consolidated assessment result.

    Args:
        asset_id: Unique identifier of the target asset.
        checks: List of check IDs to execute.
        config: Optional assessment configuration overrides.

    Returns:
        Consolidated assessment result with all findings.

    Raises:
        AssetNotFoundError: If the asset does not exist.
        PermissionError: If the user lacks assessment permission.
        AssessmentError: If the assessment fails to complete.
    """
```

### Error Handling

Define typed exceptions:

```python
class SecureScanError(Exception):
    """Base exception for all application errors."""

class WorkspaceNotFoundError(SecureScanError):
    """Raised when a workspace does not exist."""

class AssessmentError(SecureScanError):
    """Raised when an assessment fails."""
```

### Logging

Structured logging with context:

```python
from app.core.logging import get_logger

logger = get_logger(__name__)

logger.info(
    "assessment.started",
    assessment_id=str(assessment.id),
    target=asset.identifier,
    check_count=len(checks),
)
```

## TypeScript (Frontend)

### Formatting

- **Formatter**: Prettier
- **Line Length**: 100 characters
- **Quotes**: Single quotes for strings
- **Semicolons**: Always

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| File | kebab-case | `workspace-card.tsx` |
| Component | PascalCase | `WorkspaceCard` |
| Function | camelCase | `useWorkspace()` |
| Variable | camelCase | `workspaceName` |
| Type | PascalCase | `WorkspaceData` |
| Interface | PascalCase | `ButtonProps` |
| Constant | UPPER_SNAKE | `MAX_WORKSPACES` |
| CSS Class | BEM | `workspace__card--active` |

### Component Structure

```typescript
// workspace-card.tsx
import React from 'react';
import { Workspace } from '../../types/workspace';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

interface WorkspaceCardProps {
  workspace: Workspace;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  'aria-describedby'?: string;
}

export function WorkspaceCard({
  workspace,
  onSelect,
  onDelete,
  'aria-describedby': describedBy,
}: WorkspaceCardProps): JSX.Element {
  return (
    <Card
      className="workspace-card"
      role="article"
      aria-label={`Workspace: ${workspace.name}`}
      aria-describedby={describedBy}
    >
      <h3>{workspace.name}</h3>
      <p>{workspace.description}</p>
      <div className="workspace-card__actions">
        <Button
          onClick={() => onSelect(workspace.id)}
          aria-label={`Open workspace ${workspace.name}`}
        >
          Open
        </Button>
        {onDelete && (
          <Button
            variant="danger"
            onClick={() => onDelete(workspace.id)}
            aria-label={`Delete workspace ${workspace.name}`}
          >
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
```

### Hooks

```typescript
// use-workspace.ts
import { useState, useEffect } from 'react';
import { Workspace } from '../types/workspace';

export function useWorkspace(id: string) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await workspaceApi.get(id);
        if (!cancelled) {
          setWorkspace(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  return { workspace, loading, error };
}
```

## Git

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `security`, `accessibility`

### Branch Naming

`type/short-description`

Examples:
- `feature/workspace-management`
- `fix/assessment-timeout`
- `docs/api-reference`
- `security/plugin-validation`

## Documentation

### Markdown

- Use ATX-style headers (`#`, `##`)
- Maximum 80 characters per line
- Include language in fenced code blocks
- Use relative links for internal references
- Include Mermaid diagrams for architecture

### API Documentation

- Every endpoint documented with OpenAPI
- Request/response examples
- Error response documentation
- Authentication requirements

## Accessibility

- All interactive elements must be keyboard accessible
- All images require alt text
- Form inputs must have associated labels
- Color must not be the only indicator
- Focus order must be logical
- Minimum touch target: 44x44px

See [ACCESSIBILITY.md](ACCESSIBILITY.md) for complete guidelines.

## Security

- No hardcoded secrets
- Input validation on all user data
- Parameterized queries only
- No `eval()` or equivalent
- No `exec()` or equivalent
- No dynamic imports from user input
- Logging must not include sensitive data

## Review Checklist

Before submitting code, verify:

- [ ] Formatting passes (Ruff/Prettier)
- [ ] Type checking passes (MyPy/TypeScript)
- [ ] Linting passes (Ruff/ESLint)
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Accessibility verified
- [ ] No secrets committed
- [ ] Error handling adequate
- [ ] Logging present
- [ ] Changelog updated
