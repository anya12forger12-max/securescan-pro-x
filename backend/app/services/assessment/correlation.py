"""Correlation interfaces — framework for finding deduplication and analysis.

This module defines the interfaces for future correlation engines that will:
- Merge duplicate findings from different plugins
- Detect related issues across targets
- Track recurring findings across assessments
- Associate evidence with multiple findings
- Generate unified records

NO IMPLEMENTATION is provided in this phase. Only interfaces are defined.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


# ── Correlation Rule ───────────────────────────────────────────────


class CorrelationRule:
    """A rule defining how findings can be correlated.

    Rules encode patterns that identify when two or more findings
    represent the same issue or are related.
    """

    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        match_fields: list[str] | None = None,
        match_strategy: str = "exact",
        confidence_threshold: float = 0.8,
        enabled: bool = True,
    ) -> None:
        """Initialize a correlation rule.

        Args:
            id: Rule identifier.
            name: Human-readable name.
            description: What this rule does.
            match_fields: Fields to compare for matching.
            match_strategy: Matching strategy (exact, fuzzy, semantic).
            confidence_threshold: Minimum confidence for a match.
            enabled: Whether the rule is active.
        """
        self.id = id
        self.name = name
        self.description = description
        self.match_fields = match_fields or ["title", "category"]
        self.match_strategy = match_strategy
        self.confidence_threshold = confidence_threshold
        self.enabled = enabled


# ── Correlation Result ─────────────────────────────────────────────


class CorrelationResult:
    """Result of a correlation operation.

    Groups findings that have been identified as related or duplicate.
    """

    def __init__(
        self,
        finding_ids: list[str],
        correlation_type: str,
        confidence: float,
        rule_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Initialize a correlation result.

        Args:
            finding_ids: IDs of correlated findings.
            correlation_type: Type of correlation (duplicate, related, recurring).
            confidence: Confidence score (0.0 to 1.0).
            rule_id: Rule that produced this correlation.
            metadata: Additional correlation metadata.
        """
        self.finding_ids = finding_ids
        self.correlation_type = correlation_type
        self.confidence = confidence
        self.rule_id = rule_id
        self.metadata = metadata or {}


# ── Correlation Engine Interface ──────────────────────────────────


class CorrelationEngine(ABC):
    """Interface for correlation engine operations.

    Implementations will analyze findings and produce correlation results
    that group related or duplicate findings together.
    """

    @abstractmethod
    async def correlate_findings(
        self,
        findings: list[dict[str, Any]],
        rules: list[CorrelationRule] | None = None,
    ) -> list[CorrelationResult]:
        """Analyze findings and produce correlations.

        Args:
            findings: List of findings to analyze.
            rules: Optional correlation rules to apply.

        Returns:
            List of correlation results.
        """
        ...

    @abstractmethod
    async def deduplicate(
        self,
        findings: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Remove duplicate findings, keeping the most detailed version.

        Args:
            findings: List of findings to deduplicate.

        Returns:
            Deduplicated list of findings.
        """
        ...

    @abstractmethod
    async def find_recurring(
        self,
        current_findings: list[dict[str, Any]],
        historical_assessment_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Identify findings that recur across assessments.

        Args:
            current_findings: Current assessment findings.
            historical_assessment_ids: IDs of historical assessments to compare.

        Returns:
            List of recurring findings with history metadata.
        """
        ...

    @abstractmethod
    async def associate_evidence(
        self,
        findings: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        """Associate evidence items with findings based on relevance.

        Args:
            findings: List of findings.
            evidence: List of evidence items.

        Returns:
            Mapping of finding_id → list of evidence_ids.
        """
        ...

    @abstractmethod
    async def add_rule(self, rule: CorrelationRule) -> None:
        """Add a correlation rule.

        Args:
            rule: Rule to add.
        """
        ...

    @abstractmethod
    async def list_rules(self) -> list[CorrelationRule]:
        """List all correlation rules.

        Returns:
            List of active rules.
        """
        ...


# ── No-Op Implementation ──────────────────────────────────────────


class NoOpCorrelationEngine(CorrelationEngine):
    """Placeholder correlation engine that performs no correlation.

    Used during Phase 2A when correlation is not yet implemented.
    Returns empty results without modifying any data.
    """

    def __init__(self) -> None:
        """Initialize with empty rules."""
        self._rules: list[CorrelationRule] = []

    async def correlate_findings(
        self,
        findings: list[dict[str, Any]],
        rules: list[CorrelationRule] | None = None,
    ) -> list[CorrelationResult]:
        """No-op: returns empty correlations.

        Args:
            findings: Findings to analyze.
            rules: Rules to apply.

        Returns:
            Empty list.
        """
        return []

    async def deduplicate(
        self,
        findings: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """No-op: returns findings unchanged.

        Args:
            findings: Findings to deduplicate.

        Returns:
            Unmodified findings.
        """
        return list(findings)

    async def find_recurring(
        self,
        current_findings: list[dict[str, Any]],
        historical_assessment_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """No-op: returns empty recurring findings.

        Args:
            current_findings: Current findings.
            historical_assessment_ids: Historical assessment IDs.

        Returns:
            Empty list.
        """
        return []

    async def associate_evidence(
        self,
        findings: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        """No-op: returns empty associations.

        Args:
            findings: Findings.
            evidence: Evidence items.

        Returns:
            Empty mapping.
        """
        return {}

    async def add_rule(self, rule: CorrelationRule) -> None:
        """Store a rule without applying it.

        Args:
            rule: Rule to store.
        """
        self._rules.append(rule)

    async def list_rules(self) -> list[CorrelationRule]:
        """List stored rules.

        Returns:
            List of rules.
        """
        return list(self._rules)
