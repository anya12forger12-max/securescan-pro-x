"""Unit tests for the report pipeline.

Tests cover all report formats, report data building, and the
report service interface.
"""

from __future__ import annotations

import json

import pytest

from app.services.assessment.reports import (
    InMemoryReportService,
    build_report_data,
    generate_csv_report,
    generate_html_report,
    generate_json_report,
    generate_markdown_report,
)


@pytest.fixture
def sample_data() -> dict:
    """Create sample report data."""
    return {
        "assessment": {
            "id": "assess-1",
            "name": "Test Assessment",
            "status": "completed",
            "priority": "high",
            "target_count": 5,
        },
        "findings": [
            {
                "title": "Critical Finding",
                "severity": "critical",
                "category": "security",
                "summary": "A critical issue",
                "confidence": 0.95,
                "recommendation": "Fix immediately",
            },
            {
                "title": "Low Finding",
                "severity": "low",
                "category": "info",
                "summary": "A minor issue",
                "confidence": 0.6,
            },
        ],
        "evidence": [
            {
                "title": "Log Evidence",
                "evidence_type": "log",
                "source": "system",
                "classification": "internal",
            },
        ],
    }


class TestReportDataBuilder:
    """Tests for build_report_data."""

    def test_builds_executive_summary(self, sample_data: dict) -> None:
        """Report data includes an executive summary."""
        report = build_report_data(**sample_data)
        assert "executive_summary" in report
        assert "2 finding" in report["executive_summary"]

    def test_severity_summary(self, sample_data: dict) -> None:
        """Severity summary is computed correctly."""
        report = build_report_data(**sample_data)
        severity = report["severity_summary"]
        assert severity["critical"] == 1
        assert severity["low"] == 1
        assert severity["high"] == 0

    def test_report_metadata(self, sample_data: dict) -> None:
        """Report metadata is populated."""
        report = build_report_data(**sample_data)
        assert "report_metadata" in report
        assert "generated_at" in report["report_metadata"]
        assert "SecureScan" in report["report_metadata"]["generator"]


class TestReportGenerators:
    """Tests for individual report format generators."""

    def test_json_report(self, sample_data: dict) -> None:
        """JSON report is valid JSON."""
        data = build_report_data(**sample_data)
        output = generate_json_report(data)
        parsed = json.loads(output)
        assert parsed["assessment"]["name"] == "Test Assessment"

    def test_markdown_report(self, sample_data: dict) -> None:
        """Markdown report contains expected sections."""
        data = build_report_data(**sample_data)
        output = generate_markdown_report(data)
        assert "# Assessment Report" in output
        assert "## Findings" in output
        assert "## Evidence" in output
        assert "Critical Finding" in output

    def test_html_report(self, sample_data: dict) -> None:
        """HTML report is valid HTML."""
        data = build_report_data(**sample_data)
        output = generate_html_report(data)
        assert "<!DOCTYPE html>" in output
        assert "<table>" in output
        assert "Critical Finding" in output

    def test_csv_report(self, sample_data: dict) -> None:
        """CSV report contains expected columns."""
        data = build_report_data(**sample_data)
        output = generate_csv_report(data)
        assert "Title" in output
        assert "Severity" in output
        assert "Critical Finding" in output


class TestReportService:
    """Tests for InMemoryReportService."""

    @pytest.fixture
    def service(self) -> InMemoryReportService:
        """Create a fresh service."""
        return InMemoryReportService()

    @pytest.mark.asyncio
    async def test_generate_json(self, service: InMemoryReportService) -> None:
        """Generating a JSON report succeeds."""
        result = await service.generate(
            assessment_id="assess-1",
            format="json",
            assessment={"id": "assess-1", "name": "Test"},
            findings=[],
            evidence=[],
        )
        assert result["format"] == "json"
        assert result["content_length"] > 0
        assert result["integrity_hash"]

    @pytest.mark.asyncio
    async def test_generate_markdown(self, service: InMemoryReportService) -> None:
        """Generating a Markdown report succeeds."""
        result = await service.generate(
            assessment_id="assess-1",
            format="markdown",
        )
        assert result["format"] == "markdown"

    @pytest.mark.asyncio
    async def test_generate_html(self, service: InMemoryReportService) -> None:
        """Generating an HTML report succeeds."""
        result = await service.generate(
            assessment_id="assess-1",
            format="html",
        )
        assert result["format"] == "html"

    @pytest.mark.asyncio
    async def test_generate_csv(self, service: InMemoryReportService) -> None:
        """Generating a CSV report succeeds."""
        result = await service.generate(
            assessment_id="assess-1",
            format="csv",
        )
        assert result["format"] == "csv"

    @pytest.mark.asyncio
    async def test_generate_invalid_format(self, service: InMemoryReportService) -> None:
        """Generating with an invalid format raises error."""
        with pytest.raises(ValueError, match="Unsupported report format"):
            await service.generate(
                assessment_id="assess-1",
                format="xml",
            )

    @pytest.mark.asyncio
    async def test_list_reports(self, service: InMemoryReportService) -> None:
        """Listing reports returns generated reports."""
        await service.generate(assessment_id="a1", format="json")
        await service.generate(assessment_id="a1", format="markdown")
        await service.generate(assessment_id="a2", format="csv")

        reports = await service.list_reports("a1")
        assert len(reports) == 2
        assert all("content" not in r for r in reports)
