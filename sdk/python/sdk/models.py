"""Plugin models — data classes for plugin data structures."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class Severity(str, Enum):
    """Severity levels for findings."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AssetType(str, Enum):
    """Types of assessable assets."""

    HOST = "host"
    NETWORK = "network"
    WEB = "web"
    CLOUD = "cloud"
    CONTAINER = "container"


@dataclass
class Asset:
    """Represents an assessable target."""

    id: str
    type: AssetType
    identifier: str
    name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Finding:
    """A single security finding from a check."""

    title: str
    description: str
    severity: Severity
    category: str
    recommendation: Optional[str] = None
    references: list[str] = field(default_factory=list)
    evidence: Optional[str] = None
    cvss_score: Optional[float] = None
    cwe_ids: list[str] = field(default_factory=list)


@dataclass
class CheckResult:
    """Result of executing a check plugin."""

    plugin_id: str
    asset_id: str
    status: str
    findings: list[Finding] = field(default_factory=list)
    duration_ms: Optional[int] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class PluginContext:
    """Context provided to plugins for accessing platform services."""

    workspace_id: str
    permissions: list[str] = field(default_factory=list)
    storage: Any = None  # PluginStorage instance
    logger: Any = None   # PluginLogger instance


@dataclass
class PluginInfo:
    """Metadata about a plugin."""

    id: str
    name: str
    version: str
    description: str
    author: str = ""
    plugin_type: str = "check"
    permissions: list[str] = field(default_factory=list)
    target_types: list[str] = field(default_factory=list)


@dataclass
class ReportData:
    """Data passed to report plugins for generation."""

    assessment_id: str
    assessment_name: str
    workspace_name: str
    findings: list[Finding] = field(default_factory=list)
    assets: list[Asset] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReportOutput:
    """Output from a report plugin."""

    content: str
    content_type: str
    filename: str
    metadata: dict[str, Any] = field(default_factory=dict)
