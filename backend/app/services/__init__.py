"""Service layer — Business logic and service interfaces.

Each service follows the Interface Segregation Principle:
services communicate through well-defined abstract interfaces.

Imports are lazy to avoid circular dependencies and premature
mapper configuration when subpackages are loaded.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.configuration import ConfigurationService
    from app.services.logging_service import LoggingService
    from app.services.workspace import WorkspaceService
    from app.services.asset import AssetService
    from app.services.assessment import InMemoryOrchestrator
    from app.services.plugin import PluginManager
    from app.services.audit import AuditService
    from app.services.reports import ReportGenerationService
    from app.services.knowledge import InMemoryVulnKnowledgeService

_LAZY_IMPORTS: dict[str, tuple[str, str]] = {
    "ConfigurationService": ("app.services.configuration", "ConfigurationService"),
    "LoggingService": ("app.services.logging_service", "LoggingService"),
    "WorkspaceService": ("app.services.workspace", "WorkspaceService"),
    "AssetService": ("app.services.asset", "AssetService"),
    "InMemoryOrchestrator": ("app.services.assessment", "InMemoryOrchestrator"),
    "PluginManager": ("app.services.plugin", "PluginManager"),
    "AuditService": ("app.services.audit", "AuditService"),
    "ReportGenerationService": ("app.services.reports", "ReportGenerationService"),
    "InMemoryVulnKnowledgeService": ("app.services.knowledge", "InMemoryVulnKnowledgeService"),
}

__all__ = list(_LAZY_IMPORTS)


def __getattr__(name: str) -> object:
    if name in _LAZY_IMPORTS:
        module_path, attr = _LAZY_IMPORTS[name]
        import importlib

        module = importlib.import_module(module_path)
        return getattr(module, attr)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
