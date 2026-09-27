"""Unit tests for the risk and correlation engines."""

from __future__ import annotations

from app.services.correlation import (
    CorrelationRule,
    DefaultCorrelationEngine,
    DefaultRiskEngine,
    RiskLevel,
)


class TestRiskEngine:
    def test_empty_findings_is_info(self) -> None:
        score = DefaultRiskEngine().calculate_risk([])
        assert score.overall_score == 0.0
        assert score.risk_level == RiskLevel.INFO
        assert score.reasoning == []

    def test_critical_mix_scores_high(self) -> None:
        findings = (
            [{"severity": "critical", "id": "c1"}] * 2
            + [{"severity": "high", "id": "h1"}] * 2
            + [{"severity": "low", "id": "l1"}]
        )
        score = DefaultRiskEngine().calculate_risk(findings)
        assert score.overall_score > 2.0
        assert 0.0 < score.confidence <= 1.0
        assert any("critical" in r for r in score.reasoning)
        assert any("high-severity" in r for r in score.reasoning)
        assert "severity_distribution" in score.factor_scores
        assert "diversity_factor" in score.factor_scores

    def test_concentration_penalty_applied(self) -> None:
        findings = [{"severity": "critical", "id": f"c{i}"} for i in range(6)]
        score = DefaultRiskEngine().calculate_risk(findings)
        assert score.factor_scores["concentration_penalty"] > 0.0
        assert score.overall_score <= 10.0

    def test_high_only_reasoning(self) -> None:
        score = DefaultRiskEngine().calculate_risk([{"severity": "high"}] * 4)
        assert any("high-severity" in r for r in score.reasoning)
        assert not any("critical" in r for r in score.reasoning)
        assert any("Total findings" in r for r in score.reasoning)

    def test_score_to_level_thresholds(self) -> None:
        engine = DefaultRiskEngine()
        assert engine._score_to_level(9.5) == RiskLevel.CRITICAL
        assert engine._score_to_level(6.0) == RiskLevel.HIGH
        assert engine._score_to_level(4.0) == RiskLevel.MEDIUM
        assert engine._score_to_level(2.0) == RiskLevel.LOW
        assert engine._score_to_level(0.0) == RiskLevel.INFO

    def test_prioritize_orders_by_severity_then_cvss(self) -> None:
        findings = [
            {"id": "low", "severity": "low"},
            {"id": "crit", "severity": "critical"},
            {"id": "high-weak", "severity": "high", "cvss_score": 5.0},
            {"id": "high-strong", "severity": "high", "cvss_score": 9.0},
            {"id": "unknown", "severity": "something-new"},
        ]
        ordered = DefaultRiskEngine().prioritize(findings)
        assert [f["id"] for f in ordered] == [
            "crit",
            "high-strong",
            "high-weak",
            "low",
            "unknown",
        ]


class TestCorrelationEngine:
    def test_no_findings_no_correlations(self) -> None:
        assert DefaultCorrelationEngine().correlate([]) == []

    def test_single_finding_no_correlations(self) -> None:
        fs = [{"id": "a", "severity": "low", "category": "ssl"}]
        assert DefaultCorrelationEngine().correlate(fs) == []

    def test_category_cluster(self) -> None:
        fs = [
            {"id": "a", "severity": "medium", "category": "ssl"},
            {"id": "b", "severity": "low", "category": "ssl"},
        ]
        out = DefaultCorrelationEngine().correlate(fs)
        assert len(out) == 1
        c = out[0]
        assert c.correlation_type == "category_cluster"
        assert c.primary_finding_id == "a"
        assert c.related_finding_ids == ["b"]
        assert c.combined_severity == "medium"
        # Cluster score = SEVERITY_SCORES[medium] * 1.2 = 6.0 → HIGH tier.
        assert c.risk_score.overall_score == 6.0
        assert c.risk_score.risk_level == RiskLevel.HIGH
        assert "ssl" in c.description

    def test_high_severity_cluster(self) -> None:
        fs = [
            {"id": "h1", "severity": "high", "category": "network"},
            {"id": "h2", "severity": "high", "category": "config"},
            {"id": "h3", "severity": "high", "category": "crypto"},
        ]
        out = DefaultCorrelationEngine().correlate(fs)
        cluster = next(c for c in out if c.correlation_type == "severity_cluster")
        assert cluster.combined_severity == "high"
        assert cluster.primary_finding_id == "h1"
        assert cluster.related_finding_ids == ["h2", "h3"]
        assert cluster.risk_score.risk_level == RiskLevel.CRITICAL

    def test_severity_cluster_boosts_to_critical(self) -> None:
        fs = [
            {"id": "c1", "severity": "critical", "category": "a"},
            {"id": "h1", "severity": "high", "category": "b"},
            {"id": "h2", "severity": "high", "category": "c"},
        ]
        out = DefaultCorrelationEngine().correlate(fs)
        cluster = next(c for c in out if c.correlation_type == "severity_cluster")
        assert cluster.combined_severity == "critical"

    def test_add_rule(self) -> None:
        engine = DefaultCorrelationEngine()
        dup = CorrelationRule(
            id="open-port-header",
            name="dup",
            description="duplicate id",
            conditions=["port_scan:open"],
        )
        assert engine.add_rule(dup) is False
        fresh = CorrelationRule(
            id="custom-rule",
            name="custom",
            description="a custom rule",
            conditions=["category:web"],
            risk_multiplier=2.0,
        )
        assert engine.add_rule(fresh) is True
        assert engine.add_rule(fresh) is False

    def test_highest_severity(self) -> None:
        engine = DefaultCorrelationEngine()
        assert (
            engine._highest_severity(
                [{"severity": "low"}, {"severity": "critical"}, {"severity": "medium"}]
            )
            == "critical"
        )
        assert engine._highest_severity([{"severity": "medium"}]) == "medium"
        assert engine._highest_severity([{"severity": "unknown"}]) == "info"
