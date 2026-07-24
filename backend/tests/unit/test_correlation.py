"""Unit tests for the correlation engine (no-op implementation).

Tests verify that the no-op engine returns expected empty results
and stores rules correctly.
"""

from __future__ import annotations

import pytest

from app.services.assessment.correlation import (
    CorrelationRule,
    NoOpCorrelationEngine,
)


class TestNoOpCorrelationEngine:
    """Tests for NoOpCorrelationEngine."""

    @pytest.fixture
    def engine(self) -> NoOpCorrelationEngine:
        """Create a fresh engine."""
        return NoOpCorrelationEngine()

    @pytest.mark.asyncio
    async def test_correlate_findings_returns_empty(
        self, engine: NoOpCorrelationEngine
    ) -> None:
        """Correlation returns empty list."""
        result = await engine.correlate_findings([
            {"title": "Finding 1", "severity": "high"},
            {"title": "Finding 2", "severity": "high"},
        ])
        assert result == []

    @pytest.mark.asyncio
    async def test_deduplicate_returns_same(
        self, engine: NoOpCorrelationEngine
    ) -> None:
        """Deduplication returns all findings unchanged."""
        findings = [
            {"title": "Finding 1"},
            {"title": "Finding 2"},
        ]
        result = await engine.deduplicate(findings)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_find_recurring_returns_empty(
        self, engine: NoOpCorrelationEngine
    ) -> None:
        """Recurring check returns empty list."""
        result = await engine.find_recurring([{"title": "Test"}])
        assert result == []

    @pytest.mark.asyncio
    async def test_associate_evidence_returns_empty(
        self, engine: NoOpCorrelationEngine
    ) -> None:
        """Evidence association returns empty mapping."""
        result = await engine.associate_evidence(
            [{"id": "f1"}], [{"id": "e1"}]
        )
        assert result == {}

    @pytest.mark.asyncio
    async def test_add_and_list_rules(
        self, engine: NoOpCorrelationEngine
    ) -> None:
        """Rules can be added and listed."""
        rule = CorrelationRule(
            id="r1",
            name="Duplicate Detection",
            match_fields=["title", "category"],
        )
        await engine.add_rule(rule)
        rules = await engine.list_rules()
        assert len(rules) == 1
        assert rules[0].name == "Duplicate Detection"
