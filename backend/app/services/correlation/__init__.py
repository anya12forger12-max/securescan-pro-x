"""Risk scoring and correlation engine for SecureScan Pro X."""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

SEVERITY_SCORES = {
    "critical": 9.5,
    "high": 7.5,
    "medium": 5.0,
    "low": 2.5,
    "info": 0.0,
}

SEVERITY_WEIGHTS = {
    "critical": 10,
    "high": 5,
    "medium": 3,
    "low": 1,
    "info": 0,
}


class RiskLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


@dataclass
class RiskScore:
    overall_score: float  # 0-10
    risk_level: RiskLevel
    factor_scores: dict[str, float] = field(default_factory=dict)
    confidence: float = 1.0
    reasoning: list[str] = field(default_factory=list)


@dataclass
class CorrelationRule:
    id: str
    name: str
    description: str
    conditions: list[str]
    risk_multiplier: float = 1.5
    severity_boost: str = ""


@dataclass
class CorrelatedFinding:
    primary_finding_id: str
    related_finding_ids: list[str]
    correlation_type: str
    combined_severity: str
    risk_score: RiskScore
    description: str


class RiskEngine(ABC):
    @abstractmethod
    def calculate_risk(self, findings: list[dict[str, Any]]) -> RiskScore: ...

    @abstractmethod
    def prioritize(self, findings: list[dict[str, Any]]) -> list[dict[str, Any]]: ...


class CorrelationEngine(ABC):
    @abstractmethod
    def correlate(self, findings: list[dict[str, Any]]) -> list[CorrelatedFinding]: ...

    @abstractmethod
    def add_rule(self, rule: CorrelationRule) -> bool: ...


class DefaultRiskEngine(RiskEngine):
    def __init__(self) -> None:
        self._rules: list[CorrelationRule] = []

    def calculate_risk(self, findings: list[dict[str, Any]]) -> RiskScore:
        if not findings:
            return RiskScore(overall_score=0.0, risk_level=RiskLevel.INFO)

        severity_counts: dict[str, int] = {}
        for f in findings:
            sev = f.get("severity", "info").lower()
            severity_counts[sev] = severity_counts.get(sev, 0) + 1

        weighted_sum = sum(
            SEVERITY_WEIGHTS.get(sev, 0) * count
            for sev, count in severity_counts.items()
        )
        max_possible = len(findings) * 10
        base_score = (weighted_sum / max(max_possible, 1)) * 10

        critical_count = severity_counts.get("critical", 0)
        high_count = severity_counts.get("high", 0)

        diversity_bonus = len(severity_counts) * 0.3
        concentration_penalty = 0.0
        if critical_count > 3:
            concentration_penalty = (critical_count - 3) * 0.5
        if high_count > 5:
            concentration_penalty += (high_count - 5) * 0.3

        overall = min(10.0, max(0.0, base_score + diversity_bonus - concentration_penalty))

        factor_scores = {
            "severity_distribution": base_score,
            "diversity_factor": diversity_bonus,
            "concentration_penalty": concentration_penalty,
            "critical_impact": min(10.0, critical_count * 2.5),
            "high_impact": min(10.0, high_count * 1.5),
        }

        reasoning = []
        if critical_count > 0:
            reasoning.append(f"{critical_count} critical findings detected")
        if high_count > 0:
            reasoning.append(f"{high_count} high-severity findings detected")
        total = sum(severity_counts.values())
        reasoning.append(f"Total findings: {total} across {len(severity_counts)} severity levels")

        risk_level = self._score_to_level(overall)
        confidence = min(1.0, 0.5 + (len(findings) * 0.05))

        return RiskScore(
            overall_score=round(overall, 2),
            risk_level=risk_level,
            factor_scores=factor_scores,
            confidence=confidence,
            reasoning=reasoning,
        )

    def prioritize(self, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def sort_key(f: dict[str, Any]) -> tuple[int, float]:
            severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
            sev = f.get("severity", "info").lower()
            cvss = f.get("cvss_score", 0.0) or 0.0
            return (severity_order.get(sev, 4), -cvss)

        return sorted(findings, key=sort_key)

    def _score_to_level(self, score: float) -> RiskLevel:
        if score >= 8.0:
            return RiskLevel.CRITICAL
        if score >= 6.0:
            return RiskLevel.HIGH
        if score >= 4.0:
            return RiskLevel.MEDIUM
        if score >= 2.0:
            return RiskLevel.LOW
        return RiskLevel.INFO


class DefaultCorrelationEngine(CorrelationEngine):
    def __init__(self) -> None:
        self._rules: list[CorrelationRule] = [
            CorrelationRule(
                id="open-port-header",
                name="Open Port + Missing Headers",
                description="Open non-standard ports combined with missing security headers",
                conditions=["port_scan:open", "header_check:missing"],
                risk_multiplier=1.3,
            ),
            CorrelationRule(
                id="ssl-weak-header",
                name="Weak SSL + Missing Headers",
                description="Weak SSL/TLS configuration with missing security headers",
                conditions=["ssl_check:weak", "header_check:missing"],
                risk_multiplier=1.5,
            ),
            CorrelationRule(
                id="multi-high",
                name="Multiple High Findings",
                description="Multiple high-severity findings on same target",
                conditions=["severity:high:count>3"],
                risk_multiplier=1.4,
                severity_boost="critical",
            ),
            CorrelationRule(
                id="crypto-misc",
                name="Cryptographic Issues Cluster",
                description="Multiple cryptographic-related findings",
                conditions=["category:ssl", "category:crypto"],
                risk_multiplier=1.6,
            ),
        ]

    def correlate(self, findings: list[dict[str, Any]]) -> list[CorrelatedFinding]:
        correlated: list[CorrelatedFinding] = []

        findings_by_category: dict[str, list[dict[str, Any]]] = {}
        for f in findings:
            cat = f.get("category", "unknown")
            findings_by_category.setdefault(cat, []).append(f)

        for cat, cat_findings in findings_by_category.items():
            if len(cat_findings) >= 2:
                primary = cat_findings[0]
                related_ids = [f.get("id", "") for f in cat_findings[1:]]
                combined_sev = self._highest_severity(cat_findings)

                score = RiskScore(
                    overall_score=SEVERITY_SCORES.get(combined_sev, 0) * 1.2,
                    risk_level=DefaultRiskEngine()._score_to_level(
                        SEVERITY_SCORES.get(combined_sev, 0) * 1.2
                    ),
                    reasoning=[f"Correlated {len(cat_findings)} findings in category '{cat}'"],
                )

                correlated.append(CorrelatedFinding(
                    primary_finding_id=primary.get("id", ""),
                    related_finding_ids=related_ids,
                    correlation_type="category_cluster",
                    combined_severity=combined_sev,
                    risk_score=score,
                    description=f"Multiple findings in category '{cat}' suggest a systemic issue.",
                ))

        high_findings = [f for f in findings if f.get("severity", "").lower() in ("critical", "high")]
        if len(high_findings) >= 3:
            ids = [f.get("id", "") for f in high_findings]
            combined_sev = "critical" if any(f.get("severity") == "critical" for f in high_findings) else "high"
            correlated.append(CorrelatedFinding(
                primary_finding_id=ids[0],
                related_finding_ids=ids[1:],
                correlation_type="severity_cluster",
                combined_severity=combined_sev,
                risk_score=RiskScore(
                    overall_score=8.5,
                    risk_level=RiskLevel.CRITICAL,
                    reasoning=[f"{len(high_findings)} high/critical findings cluster"],
                ),
                description=f"Cluster of {len(high_findings)} high/critical severity findings.",
            ))

        return correlated

    def add_rule(self, rule: CorrelationRule) -> bool:
        if any(r.id == rule.id for r in self._rules):
            return False
        self._rules.append(rule)
        return True

    def _highest_severity(self, findings: list[dict[str, Any]]) -> str:
        order = ["critical", "high", "medium", "low", "info"]
        for sev in order:
            if any(f.get("severity", "").lower() == sev for f in findings):
                return sev
        return "info"
