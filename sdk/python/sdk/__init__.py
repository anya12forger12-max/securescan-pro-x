"""SecureScan Pro X — Python Plugin SDK.

Provides interfaces, base classes, and utilities for building
SecureScan Pro X plugins.

Usage:
    from sdk import CheckPlugin, CheckResult, Asset, PluginContext

    class MyCheck(CheckPlugin):
        id = "my-check"
        name = "My Check"
        version = "1.0.0"
        description = "Checks for a specific condition."
        permissions = ["system:read"]
        target_types = ["host"]

        async def check(self, asset: Asset) -> CheckResult:
            findings = []
            # Your check logic here
            return CheckResult(
                plugin_id=self.id,
                asset_id=asset.id,
                status="completed",
                findings=findings,
            )
"""

from sdk.interfaces import (
    CheckPlugin,
    ReportPlugin,
    KnowledgePlugin,
)
from sdk.models import (
    Asset,
    AssetType,
    CheckResult,
    Finding,
    PluginContext,
    PluginInfo,
    Severity,
)

__version__ = "0.1.0"

__all__ = [
    "CheckPlugin",
    "ReportPlugin",
    "KnowledgePlugin",
    "Asset",
    "AssetType",
    "CheckResult",
    "Finding",
    "PluginContext",
    "PluginInfo",
    "Severity",
]
