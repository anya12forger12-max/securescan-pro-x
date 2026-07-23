# Plugin Development Guide — SecureScan Pro X

## Overview

SecureScan Pro X uses a plugin-driven architecture. Plugins extend the platform with custom checks, report generators, knowledge sources, and integrations.

## Plugin Types

| Type | Purpose | SDK |
|---|---|---|
| **Check** | Custom security checks | Python SDK |
| **Report** | Custom report formats | Python SDK |
| **Knowledge** | Vulnerability intelligence | Python SDK |
| **Integration** | External tool connectivity | Python SDK |
| **UI** | Frontend extensions | TypeScript SDK |

## Quick Start

### 1. Create a Plugin

```bash
# Using the CLI
securescan plugin create my-plugin --type check

# Or manually
mkdir plugins/my-plugin
cd plugins/my-plugin
```

### 2. Define the Plugin

```python
# plugins/my-plugin/plugin.py
from sdk import CheckPlugin, CheckResult, Asset

class MyCheckPlugin(CheckPlugin):
    """Example security check plugin."""

    id = "my-check"
    name = "My Security Check"
    version = "1.0.0"
    description = "Checks for a specific security configuration."

    # Declare required permissions
    permissions = ["filesystem:read"]

    # Declare target types
    target_types = ["host", "network"]

    async def check(self, asset: Asset) -> CheckResult:
        """Execute the check against the target asset."""
        # Implement your check logic here
        findings = []

        return CheckResult(
            plugin_id=self.id,
            asset_id=asset.id,
            status="completed",
            findings=findings,
        )
```

### 3. Create Metadata

```yaml
# plugins/my-plugin/plugin.yaml
id: my-check
name: My Security Check
version: 1.0.0
description: Checks for a specific security configuration.
author: Your Name
license: MIT
type: check
min_securescan_version: "0.1.0"
permissions:
  - filesystem:read
target_types:
  - host
  - network
```

### 4. Test the Plugin

```python
# plugins/my-plugin/tests/test_my_check.py
import pytest
from sdk.testing import MockAsset, MockPluginContext

class TestMyCheckPlugin:
    """Tests for MyCheckPlugin."""

    @pytest.fixture
    def plugin(self) -> MyCheckPlugin:
        return MyCheckPlugin()

    @pytest.fixture
    def asset(self) -> MockAsset:
        return MockAsset(type="host", identifier="192.168.1.1")

    @pytest.mark.asyncio
    async def test_check_returns_result(self, plugin, asset) -> None:
        """Check returns a valid result."""
        result = await plugin.check(asset)
        assert result.status == "completed"
        assert result.plugin_id == "my-check"
```

## Plugin Structure

```
my-plugin/
├── plugin.py          # Plugin implementation
├── plugin.yaml        # Metadata
├── requirements.txt   # Dependencies
├── README.md          # Documentation
├── LICENSE            # License file
├── tests/
│   └── test_my_check.py
└── README.md          # Plugin documentation
```

## Plugin Interface

### CheckPlugin

```python
from abc import ABC, abstractmethod
from sdk import CheckPlugin, CheckResult, Asset, PluginContext

class CheckPlugin(ABC):
    """Base class for check plugins."""

    id: str
    name: str
    version: str
    description: str
    permissions: list[str]
    target_types: list[str]

    @abstractmethod
    async def check(self, asset: Asset) -> CheckResult:
        """Execute the check against the target."""
        ...

    async def initialize(self, context: PluginContext) -> None:
        """Called when the plugin is loaded."""
        pass

    async def cleanup(self) -> None:
        """Called when the plugin is unloaded."""
        pass

    def get_info(self) -> dict:
        """Return plugin metadata."""
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
        }
```

### Finding

```python
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum

class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

@dataclass
class Finding:
    """A single security finding."""
    title: str
    description: str
    severity: Severity
    category: str
    recommendation: Optional[str] = None
    references: list[str] = field(default_factory=list)
    evidence: Optional[str] = None
    cvss_score: Optional[float] = None
    cwe_ids: list[str] = field(default_factory=list)
```

## Permissions

Plugins must declare required permissions:

| Permission | Description |
|---|---|
| `filesystem:read` | Read files on the target |
| `network:scan` | Perform network scanning |
| `network:connect` | Establish network connections |
| `process:read` | Read process information |
| `system:read` | Read system configuration |
| `credential:read` | Access stored credentials |
| `report:write` | Generate reports |
| `plugin:manage` | Manage other plugins |

## Sandboxing

Plugins run in a sandboxed context with:

- Isolated filesystem access
- Network restrictions
- Memory limits (default: 512MB)
- CPU limits (default: 50%)
- Time limits (default: 300 seconds per check)
- No access to other plugins' data

## Publishing

### Package Structure

```
my-plugin-1.0.0.tar.gz
├── plugin.py
├── plugin.yaml
├── requirements.txt
└── README.md
```

### Publishing Process

1. Ensure all tests pass
2. Update version in `plugin.yaml`
3. Update CHANGELOG
4. Create a signed release
5. Publish to the plugin registry

```bash
securescan plugin publish ./my-plugin
```

## Best Practices

1. **Minimal permissions** — Request only what you need
2. **Idempotent checks** — Running twice produces the same result
3. **Graceful failure** — Handle errors without crashing
4. **Clear findings** — Provide actionable recommendations
5. **Well-documented** — Explain what the check does and why
6. **Tested** — Include unit and integration tests
7. **Versioned** — Follow semantic versioning

## Security Considerations

- All plugin code is reviewed before publication
- Plugins cannot access the host system outside their sandbox
- Plugin signatures are verified on load
- Plugins must not store credentials persistently
- Plugins must not make network requests without permission
- Plugins must not execute arbitrary code from external sources

## Troubleshooting

### Plugin Not Loading

1. Check `plugin.yaml` syntax
2. Verify all dependencies are installed
3. Check permissions are valid
4. Review application logs

### Permission Denied

1. Check declared permissions match actual usage
2. Ensure permission was granted in UI
3. Review sandbox configuration

### Performance Issues

1. Profile with `securescan plugin profile my-plugin`
2. Check resource limits in configuration
3. Optimize database queries
4. Use async operations for I/O
