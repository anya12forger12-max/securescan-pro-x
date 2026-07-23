"""Plugin interfaces — abstract base classes for plugin types."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from sdk.models import Asset, CheckResult, PluginContext, ReportData, ReportOutput


class BasePlugin(ABC):
    """Base class for all plugin types."""

    id: str
    name: str
    version: str
    description: str
    permissions: list[str] = []
    target_types: list[str] = []

    async def initialize(self, context: PluginContext) -> None:
        """Called when the plugin is loaded.

        Override to perform initialization (load config, connect to services, etc.).

        Args:
            context: Plugin context with access to workspace and storage.
        """
        pass

    async def cleanup(self) -> None:
        """Called when the plugin is unloaded.

        Override to perform cleanup (close connections, release resources).
        """
        pass

    def get_info(self) -> dict[str, Any]:
        """Return plugin metadata.

        Returns:
            Dictionary of plugin metadata.
        """
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "permissions": self.permissions,
            "target_types": self.target_types,
        }


class CheckPlugin(BasePlugin):
    """Base class for security check plugins."""

    @abstractmethod
    async def check(self, asset: Asset) -> CheckResult:
        """Execute the check against a target asset.

        Args:
            asset: The target asset to assess.

        Returns:
            CheckResult with findings.
        """
        ...


class ReportPlugin(BasePlugin):
    """Base class for report generator plugins."""

    supported_formats: list[str] = []

    @abstractmethod
    async def generate(
        self,
        data: ReportData,
        format: str,
    ) -> ReportOutput:
        """Generate a report from assessment data.

        Args:
            data: Assessment data to include in the report.
            format: Output format (e.g., 'html', 'json', 'pdf').

        Returns:
            Generated report output.
        """
        ...


class KnowledgePlugin(BasePlugin):
    """Base class for knowledge source plugins."""

    @abstractmethod
    async def lookup(self, cve_id: str) -> Optional[dict[str, Any]]:
        """Look up vulnerability information by CVE ID.

        Args:
            cve_id: CVE identifier to look up.

        Returns:
            Vulnerability information, or None if not found.
        """
        ...

    @abstractmethod
    async def get_mitigations(self, cwe_id: str) -> list[str]:
        """Get mitigation recommendations for a CWE.

        Args:
            cwe_id: CWE identifier.

        Returns:
            List of mitigation recommendations.
        """
        ...
