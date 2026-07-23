# SDK Guide — SecureScan Pro X

## Overview

The SecureScan Pro X SDK provides libraries for building plugins and extending the platform. Two SDKs are available:

- **Python SDK** — For backend plugins (checks, reports, knowledge)
- **TypeScript SDK** — For frontend plugins (UI extensions)

## Python SDK

### Installation

```bash
pip install securescan-sdk
```

### Core Concepts

#### Plugin Context

The SDK provides access to the platform through a `PluginContext`:

```python
from sdk import PluginContext

context = PluginContext(
    workspace_id="workspace-1",
    permissions=["filesystem:read"],
    storage=PluginStorage(plugin_id="my-plugin"),
    logger=PluginLogger(plugin_id="my-plugin"),
)

# Access workspace data
assets = await context.get_assets()
assessments = await context.get_assessments()

# Store plugin data
await context.storage.set("key", "value")
value = await context.storage.get("key")
```

#### Asset Model

Assets represent assessable targets:

```python
from sdk import Asset, AssetType

asset = Asset(
    id="asset-1",
    type=AssetType.HOST,
    identifier="192.168.1.1",
    name="Web Server",
    metadata={
        "os": "Linux",
        "services": ["http", "https", "ssh"],
    },
)
```

#### Finding Model

Findings represent security observations:

```python
from sdk import Finding, Severity

finding = Finding(
    title="SSH Root Login Enabled",
    description="The SSH service allows root login.",
    severity=Severity.HIGH,
    category="authentication",
    recommendation="Disable root login in sshd_config",
    evidence="PermitRootLogin yes found in /etc/ssh/sshd_config",
    references=["https://www.ssh-audit.com/hardening_guides.html"],
    cwe_ids=["CWE-250"],
)
```

#### Check Result

```python
from sdk import CheckResult

result = CheckResult(
    plugin_id="my-check",
    asset_id="asset-1",
    status="completed",
    findings=[finding],
    duration_ms=1234,
    metadata={"checks_run": 5},
)
```

### Building a Check Plugin

```python
from sdk import CheckPlugin, CheckResult, Asset, PluginContext

class SSHSecurityCheck(CheckPlugin):
    """Checks SSH configuration security."""

    id = "ssh-security"
    name = "SSH Security Check"
    version = "1.0.0"
    description = "Validates SSH server configuration."
    permissions = ["system:read"]
    target_types = ["host"]

    async def initialize(self, context: PluginContext) -> None:
        """Load any required resources."""
        self.config = await context.storage.get("config", default={})

    async def check(self, asset: Asset) -> CheckResult:
        """Run SSH security checks."""
        findings = []

        # Your check logic here
        # Example: read sshd_config, analyze settings

        return CheckResult(
            plugin_id=self.id,
            asset_id=asset.id,
            status="completed",
            findings=findings,
        )

    async def cleanup(self) -> None:
        """Clean up resources."""
        pass
```

### Building a Report Plugin

```python
from sdk import ReportPlugin, ReportData, ReportOutput

class CustomReportPlugin(ReportPlugin):
    """Generates custom formatted reports."""

    id = "custom-report"
    name = "Custom Report"
    version = "1.0.0"
    supported_formats = ["html", "json"]

    async def generate(
        self,
        data: ReportData,
        format: str,
    ) -> ReportOutput:
        """Generate a report from assessment data."""
        if format == "html":
            html = self._render_html(data)
            return ReportOutput(
                content=html,
                content_type="text/html",
                filename="report.html",
            )
        elif format == "json":
            json_data = self._render_json(data)
            return ReportOutput(
                content=json.dumps(json_data),
                content_type="application/json",
                filename="report.json",
            )
```

### Building a Knowledge Plugin

```python
from sdk import KnowledgePlugin, KnowledgeEntry

class CustomKnowledgePlugin(KnowledgePlugin):
    """Provides custom vulnerability knowledge."""

    id = "custom-knowledge"
    name = "Custom Knowledge Base"
    version = "1.0.0"

    async def lookup(self, cve_id: str) -> Optional[KnowledgeEntry]:
        """Look up vulnerability information."""
        # Query your knowledge source
        entry = await self._query_source(cve_id)
        return entry

    async def get_mitigations(
        self,
        cwe_id: str,
    ) -> list[str]:
        """Get mitigation recommendations."""
        return await self._query_mitigations(cwe_id)
```

## TypeScript SDK

### Installation

```bash
npm install @securescan/sdk
```

### UI Extension Points

```typescript
import { PluginAPI, ExtensionPoint } from '@securescan/sdk';

export function activate(api: PluginAPI): void {
  // Register dashboard widget
  api.registerExtensionPoint(
    ExtensionPoint.DASHBOARD_WIDGET,
    {
      id: 'my-widget',
      name: 'My Widget',
      component: MyWidgetComponent,
      position: 100,
    }
  );

  // Register navigation item
  api.registerExtensionPoint(
    ExtensionPoint.NAVIGATION_ITEM,
    {
      id: 'my-nav',
      label: 'My Plugin',
      icon: 'my-icon',
      route: '/my-plugin',
    }
  );
}
```

### Component API

```typescript
import { usePluginContext, useAsset } from '@securescan/sdk';

export function MyWidget() {
  const context = usePluginContext();
  const { asset, loading } = useAsset(context.assetId);

  if (loading) return <Spinner />;

  return (
    <Card>
      <h3>{asset?.name}</h3>
      {/* Your widget content */}
    </Card>
  );
}
```

## API Reference

### Python SDK

See the generated API reference:

```bash
cd sdk/python
pdoc --html --output-dir docs api/
```

### TypeScript SDK

See the TypeScript type definitions:

```bash
cd sdk/typescript
pnpm docs
```

## Examples

See the [examples/plugins/](examples/plugins/) directory for complete plugin examples:

- [examples/plugins/basic-check/](examples/plugins/basic-check/) — Simple check plugin
- [examples/plugins/advanced-check/](examples/plugins/advanced-check/) — Advanced check with context
- [examples/plugins/custom-report/](examples/plugins/custom-report/) — Custom report generator
- [examples/plugins/ui-extension/](examples/plugins/ui-extension/) — UI extension plugin

## Support

- **Documentation**: [docs/guides/plugins/](docs/guides/plugins/)
- **Examples**: [examples/plugins/](examples/plugins/)
- **Issues**: [GitHub Issues](https://github.com/securescan/securescan-pro-x/issues)
- **Discussions**: [GitHub Discussions](https://github.com/securescan/securescan-pro-x/discussions)
