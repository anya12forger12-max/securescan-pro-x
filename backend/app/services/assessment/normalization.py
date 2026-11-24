"""Result normalization — common schema for assessment module outputs.

Every assessment module (check plugin) must output results conforming to
`NormalizedFinding`. This ensures uniform handling by the correlation engine,
report pipeline, and storage layer. No proprietary formats are allowed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class NormalizedFinding:
    """Universal finding format returned by all assessment modules.

    This is the canonical representation of a security finding within the
    platform. Every check plugin must map its output to this schema.
    """

    title: str
    summary: str
    severity: str  # critical | high | medium | low | info
    confidence: float  # 0.0 to 1.0
    category: str
    status: str = "open"  # open | confirmed | fixed | false_positive
    evidence_references: list[str] = field(default_factory=list)
    recommendation: str | None = None
    references: list[str] = field(default_factory=list)
    related_assets: list[str] = field(default_factory=list)
    cvss_score: Optional[float] = None
    cwe_ids: list[str] = field(default_factory=list)
    plugin_id: str = ""
    plugin_version: str = ""
    target_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Validate field values after initialization."""
        valid_severities = {"critical", "high", "medium", "low", "info"}
        if self.severity not in valid_severities:
            raise ValueError(
                f"Invalid severity '{self.severity}'. Must be one of: {sorted(valid_severities)}"
            )
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"Confidence {self.confidence} out of range [0.0, 1.0]")
        if not self.title.strip():
            raise ValueError("Finding title must not be empty")


def normalize_finding(data: dict[str, Any]) -> NormalizedFinding:
    """Convert a raw finding dictionary into a NormalizedFinding.

    Applies default values and validation to ensure every finding
    conforms to the normalized schema.

    Args:
        data: Raw finding data from a check plugin.

    Returns:
        Validated NormalizedFinding instance.

    Raises:
        ValueError: If required fields are missing or invalid.
    """
    # Validate fields that used to pass through unchecked. The HTTP layer and
    # response models expect these exact types, so bad input must be rejected
    # here (as a ValueError -> 422) instead of surfacing as a 500 later.
    valid_statuses = {"open", "confirmed", "fixed", "false_positive"}
    status = str(data.get("status", "open")).lower()
    if status not in valid_statuses:
        raise ValueError(f"Invalid status '{status}'. Must be one of: {sorted(valid_statuses)}")

    cvss_score = data.get("cvss_score")
    if cvss_score is not None:
        try:
            cvss_score = float(cvss_score)
        except (TypeError, ValueError) as exc:
            raise ValueError("cvss_score must be a number") from exc
        if not 0.0 <= cvss_score <= 10.0:
            raise ValueError("cvss_score must be between 0.0 and 10.0")

    def _string_list(key: str) -> list[str]:
        value = data.get(key, [])
        if value is None:
            return []
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError(f"{key} must be a list of strings")
        return value

    return NormalizedFinding(
        title=str(data.get("title", "")).strip(),
        summary=str(data.get("summary", data.get("description", ""))).strip(),
        severity=str(data.get("severity", "info")).lower(),
        confidence=float(data.get("confidence", 0.5)),
        category=str(data.get("category", "general")),
        status=status,
        evidence_references=_string_list("evidence_references"),
        recommendation=data.get("recommendation"),
        references=_string_list("references"),
        related_assets=_string_list("related_assets"),
        cvss_score=cvss_score,
        cwe_ids=_string_list("cwe_ids"),
        plugin_id=str(data.get("plugin_id", "")),
        plugin_version=str(data.get("plugin_version", "")),
        target_id=data.get("target_id"),
        metadata=data.get("metadata", {}),
    )


def normalize_findings_batch(
    findings: list[dict[str, Any]],
    plugin_id: str = "",
    plugin_version: str = "",
) -> list[NormalizedFinding]:
    """Normalize a batch of findings from a plugin.

    Filters out invalid findings and logs warnings.

    Args:
        findings: List of raw finding dictionaries.
        plugin_id: ID of the plugin that produced these findings.
        plugin_version: Version of the plugin.

    Returns:
        List of valid NormalizedFinding instances.
    """
    normalized: list[NormalizedFinding] = []
    for raw in findings:
        try:
            finding = normalize_finding(raw)
            finding.plugin_id = plugin_id
            finding.plugin_version = plugin_version
            normalized.append(finding)
        except (ValueError, KeyError) as exc:
            logger.warning(
                "normalization.finding_rejected",
                plugin_id=plugin_id,
                title=raw.get("title", "<unknown>"),
                error=str(exc),
            )
    return normalized


def finding_to_dict(finding: NormalizedFinding) -> dict[str, Any]:
    """Serialize a NormalizedFinding to a JSON-compatible dictionary.

    Args:
        finding: The finding to serialize.

    Returns:
        Dictionary representation of the finding.
    }
    """
    return {
        "title": finding.title,
        "summary": finding.summary,
        "severity": finding.severity,
        "confidence": finding.confidence,
        "category": finding.category,
        "status": finding.status,
        "evidence_references": finding.evidence_references,
        "recommendation": finding.recommendation,
        "references": finding.references,
        "related_assets": finding.related_assets,
        "cvss_score": finding.cvss_score,
        "cwe_ids": finding.cwe_ids,
        "plugin_id": finding.plugin_id,
        "plugin_version": finding.plugin_version,
        "target_id": finding.target_id,
        "metadata": finding.metadata,
    }
