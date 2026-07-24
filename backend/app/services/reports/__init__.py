"""Report generation service — multi-format report output with integrity verification.

Provides abstract and concrete implementations for generating security
assessment reports in HTML, JSON, Markdown, and CSV formats. Each report
includes a SHA-256 integrity hash for tamper detection.

The HTMLReportGenerator produces professional dark-themed reports using
Jinja2 templates with executive summaries, severity breakdowns, findings
tables, and actionable recommendations.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.logging import get_logger
from app.services.assessment.reports import build_report_data

logger = get_logger(__name__)


# ── Report Data Structures ────────────────────────────────────────


class ReportMetadata:
    """Metadata for a generated report."""

    def __init__(
        self,
        report_id: str,
        assessment_id: str,
        format: str,
        title: str,
        content: str,
        integrity_hash: str,
        generated_at: str,
        generated_by: str,
    ) -> None:
        self.report_id = report_id
        self.assessment_id = assessment_id
        self.format = format
        self.title = title
        self.content = content
        self.integrity_hash = integrity_hash
        self.generated_at = generated_at
        self.generated_by = generated_by

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "id": self.report_id,
            "assessment_id": self.assessment_id,
            "format": self.format,
            "title": self.title,
            "content_length": len(self.content),
            "integrity_hash": self.integrity_hash,
            "generated_at": self.generated_at,
            "generated_by": self.generated_by,
        }


# ── Abstract Report Generator ────────────────────────────────────


class ReportGenerator(ABC):
    """Abstract base class for report generators.

    Subclasses implement format-specific generation logic. All generators
    produce a ReportMetadata with a SHA-256 integrity hash of the content.
    """

    @property
    @abstractmethod
    def format_name(self) -> str:
        """Return the format identifier (e.g., 'html', 'json')."""
        ...

    @abstractmethod
    def generate(
        self,
        report_id: str,
        assessment_id: str,
        report_data: dict[str, Any],
    ) -> ReportMetadata:
        """Generate a report from canonical report data.

        Args:
            report_id: Unique report identifier.
            assessment_id: Assessment this report belongs to.
            report_data: Canonical report data from build_report_data().

        Returns:
            ReportMetadata with generated content and integrity hash.
        """
        ...


# ── HTML Report Generator ────────────────────────────────────────


class HTMLReportGenerator(ReportGenerator):
    """Generates professional dark-themed HTML reports using Jinja2.

    Produces responsive, print-ready reports with SVG severity charts,
    color-coded findings, and full executive summaries.
    """

    def __init__(self, template_dir: str | None = None) -> None:
        """Initialize the HTML report generator.

        Args:
            template_dir: Path to Jinja2 template directory.
                Defaults to backend/templates/.
        """
        if template_dir is None:
            import os
            template_dir = os.path.join(
                os.path.dirname(__file__), "..", "..", "..", "templates"
            )
        self._env = Environment(
            loader=FileSystemLoader(template_dir),
            autoescape=select_autoescape(["html"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )

    @property
    def format_name(self) -> str:
        return "html"

    def generate(
        self,
        report_id: str,
        assessment_id: str,
        report_data: dict[str, Any],
    ) -> ReportMetadata:
        """Generate an HTML report from report data.

        Args:
            report_id: Unique report identifier.
            assessment_id: Assessment this report belongs to.
            report_data: Canonical report data.

        Returns:
            ReportMetadata with HTML content.
        """
        meta = report_data.get("report_metadata", {})
        assessment = report_data.get("assessment", {})
        severity = report_data.get("severity_summary", {})
        findings = report_data.get("findings", [])
        evidence = report_data.get("evidence", [])
        recommendations = report_data.get("recommendations", [])

        total_findings = sum(severity.values())
        severity_pcts = {}
        for sev, count in severity.items():
            severity_pcts[sev] = (
                round(count / total_findings * 100, 1) if total_findings > 0 else 0
            )

        template = self._env.get_template("report.html")
        content = template.render(
            report_id=report_id,
            metadata=meta,
            assessment=assessment,
            severity=severity,
            severity_pcts=severity_pcts,
            total_findings=total_findings,
            findings=findings,
            evidence=evidence,
            recommendations=recommendations,
            generated_at=datetime.now(timezone.utc).isoformat(),
            integrity_hash="",
            executive_summary=report_data.get("executive_summary", ""),
            statistics=report_data.get("statistics", {}),
            appendix=report_data.get("appendix", {}),
        )

        integrity_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        content = content.replace('id="integrity-hash-placeholder"', "")
        content = content.replace(
            "{{ integrity_hash }}", integrity_hash
        )

        logger.info(
            "html_report.generated",
            report_id=report_id,
            assessment_id=assessment_id,
            content_length=len(content),
        )

        return ReportMetadata(
            report_id=report_id,
            assessment_id=assessment_id,
            format="html",
            title=meta.get("title", "Assessment Report"),
            content=content,
            integrity_hash=integrity_hash,
            generated_at=datetime.now(timezone.utc).isoformat(),
            generated_by="HTMLReportGenerator",
        )


# ── JSON Report Generator ────────────────────────────────────────


class JSONReportGenerator(ReportGenerator):
    """Generates structured JSON reports."""

    @property
    def format_name(self) -> str:
        return "json"

    def generate(
        self,
        report_id: str,
        assessment_id: str,
        report_data: dict[str, Any],
    ) -> ReportMetadata:
        """Generate a JSON report.

        Args:
            report_id: Unique report identifier.
            assessment_id: Assessment this report belongs to.
            report_data: Canonical report data.

        Returns:
            ReportMetadata with JSON content.
        """
        report_data["report_metadata"]["report_id"] = report_id
        content = json.dumps(report_data, indent=2, default=str)
        integrity_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        logger.info(
            "json_report.generated",
            report_id=report_id,
            assessment_id=assessment_id,
        )

        return ReportMetadata(
            report_id=report_id,
            assessment_id=assessment_id,
            format="json",
            title=report_data.get("report_metadata", {}).get("title", "Report"),
            content=content,
            integrity_hash=integrity_hash,
            generated_at=datetime.now(timezone.utc).isoformat(),
            generated_by="JSONReportGenerator",
        )


# ── Markdown Report Generator ────────────────────────────────────


class MarkdownReportGenerator(ReportGenerator):
    """Generates Markdown-formatted reports."""

    @property
    def format_name(self) -> str:
        return "markdown"

    def generate(
        self,
        report_id: str,
        assessment_id: str,
        report_data: dict[str, Any],
    ) -> ReportMetadata:
        """Generate a Markdown report.

        Args:
            report_id: Unique report identifier.
            assessment_id: Assessment this report belongs to.
            report_data: Canonical report data.

        Returns:
            ReportMetadata with Markdown content.
        """
        lines: list[str] = []
        meta = report_data.get("report_metadata", {})
        assessment = report_data.get("assessment", {})
        severity = report_data.get("severity_summary", {})
        findings = report_data.get("findings", [])
        evidence = report_data.get("evidence", [])
        recommendations = report_data.get("recommendations", [])

        lines.append(f"# {meta.get('title', 'Assessment Report')}")
        lines.append("")
        lines.append(f"**Report ID:** `{report_id}`")
        lines.append(f"**Generated:** {meta.get('generated_at', 'N/A')}")
        lines.append(f"**Generator:** {meta.get('generator', 'N/A')}")
        lines.append("")

        lines.append("---")
        lines.append("")
        lines.append("## Executive Summary")
        lines.append("")
        lines.append(report_data.get("executive_summary", ""))
        lines.append("")

        lines.append("## Assessment Details")
        lines.append("")
        lines.append(f"| Field | Value |")
        lines.append(f"|-------|-------|")
        lines.append(f"| ID | `{assessment.get('id', 'N/A')}` |")
        lines.append(f"| Status | {assessment.get('status', 'N/A')} |")
        lines.append(f"| Priority | {assessment.get('priority', 'N/A')} |")
        lines.append(f"| Targets | {assessment.get('target_count', 0)} |")
        lines.append(f"| Started | {assessment.get('started_at', 'N/A')} |")
        lines.append(f"| Completed | {assessment.get('completed_at', 'N/A')} |")
        lines.append("")

        lines.append("## Severity Distribution")
        lines.append("")
        for sev, count in severity.items():
            indicator = "🔴" if sev == "critical" else "🟠" if sev == "high" else "🟡" if sev == "medium" else "🟢" if sev == "low" else "🔵"
            lines.append(f"- {indicator} **{sev.upper()}:** {count}")
        lines.append("")

        lines.append("## Findings")
        lines.append("")
        if findings:
            lines.append("| # | Title | Severity | Category | Status |")
            lines.append("|---|-------|----------|----------|--------|")
            for i, f in enumerate(findings, 1):
                lines.append(
                    f"| {i} | {f.get('title', 'Untitled')} | "
                    f"{f.get('severity', 'N/A')} | "
                    f"{f.get('category', 'N/A')} | "
                    f"{f.get('status', 'N/A')} |"
                )
            lines.append("")

            for i, f in enumerate(findings, 1):
                lines.append(f"### {i}. {f.get('title', 'Untitled')}")
                lines.append("")
                lines.append(f"- **Severity:** {f.get('severity', 'N/A')}")
                lines.append(f"- **Category:** {f.get('category', 'N/A')}")
                if f.get("summary"):
                    lines.append(f"- **Summary:** {f['summary']}")
                if f.get("recommendation"):
                    lines.append(f"- **Recommendation:** {f['recommendation']}")
                if f.get("cwe_ids"):
                    lines.append(f"- **CWE:** {', '.join(f['cwe_ids'])}")
                if f.get("cvss_score") is not None:
                    lines.append(f"- **CVSS:** {f['cvss_score']}")
                lines.append("")
        else:
            lines.append("No findings recorded.")
            lines.append("")

        lines.append("## Recommendations")
        lines.append("")
        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                lines.append(f"### {i}. {rec.get('title', 'Recommendation')}")
                lines.append("")
                if rec.get("description"):
                    lines.append(rec["description"])
                if rec.get("priority"):
                    lines.append(f"**Priority:** {rec['priority']}")
                if rec.get("suggested_actions"):
                    lines.append("**Actions:**")
                    for action in rec["suggested_actions"]:
                        lines.append(f"1. {action}")
                lines.append("")
        else:
            lines.append("No specific recommendations generated.")
            lines.append("")

        lines.append("## Evidence")
        lines.append("")
        if evidence:
            for i, ev in enumerate(evidence, 1):
                lines.append(f"### {i}. {ev.get('title', 'Untitled')}")
                lines.append(f"- **Type:** {ev.get('evidence_type', 'N/A')}")
                lines.append(f"- **Source:** {ev.get('source', 'N/A')}")
                lines.append(f"- **Classification:** {ev.get('classification', 'N/A')}")
                lines.append("")
        else:
            lines.append("No evidence collected.")
            lines.append("")

        lines.append("---")
        lines.append("")
        lines.append("## Methodology")
        lines.append("")
        lines.append(
            "This report was generated using SecureScan Pro X, an automated "
            "security assessment platform. Findings are classified using the "
            "Common Vulnerability Scoring System (CVSS) v3.1 and mapped to "
            "CWE identifiers where applicable."
        )
        lines.append("")

        lines.append("## Appendix")
        lines.append("")
        appendix = report_data.get("appendix", {})
        lines.append(f"- **Tool Version:** {appendix.get('tool_version', 'N/A')}")
        lines.append(f"- **Report ID:** `{report_id}`")
        lines.append(f"- **Note:** {appendix.get('report_format_note', '')}")

        content = "\n".join(lines)
        integrity_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        logger.info(
            "markdown_report.generated",
            report_id=report_id,
            assessment_id=assessment_id,
        )

        return ReportMetadata(
            report_id=report_id,
            assessment_id=assessment_id,
            format="markdown",
            title=meta.get("title", "Assessment Report"),
            content=content,
            integrity_hash=integrity_hash,
            generated_at=datetime.now(timezone.utc).isoformat(),
            generated_by="MarkdownReportGenerator",
        )


# ── CSV Report Generator ─────────────────────────────────────────


class CSVReportGenerator(ReportGenerator):
    """Generates CSV reports of findings for spreadsheet import."""

    @property
    def format_name(self) -> str:
        return "csv"

    def generate(
        self,
        report_id: str,
        assessment_id: str,
        report_data: dict[str, Any],
    ) -> ReportMetadata:
        """Generate a CSV report of findings.

        Args:
            report_id: Unique report identifier.
            assessment_id: Assessment this report belongs to.
            report_data: Canonical report data.

        Returns:
            ReportMetadata with CSV content.
        """
        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow([
            "Report ID",
            "Assessment ID",
            "Title",
            "Severity",
            "Category",
            "Status",
            "Confidence",
            "CVSS Score",
            "CWE IDs",
            "Recommendation",
            "Summary",
        ])

        for f in report_data.get("findings", []):
            cwe_ids = f.get("cwe_ids", [])
            if isinstance(cwe_ids, list):
                cwe_str = ", ".join(cwe_ids)
            else:
                cwe_str = str(cwe_ids)

            writer.writerow([
                report_id,
                assessment_id,
                f.get("title", ""),
                f.get("severity", ""),
                f.get("category", ""),
                f.get("status", ""),
                f.get("confidence", ""),
                f.get("cvss_score", ""),
                cwe_str,
                f.get("recommendation", ""),
                f.get("summary", ""),
            ])

        content = output.getvalue()
        integrity_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        logger.info(
            "csv_report.generated",
            report_id=report_id,
            assessment_id=assessment_id,
            findings_count=len(report_data.get("findings", [])),
        )

        return ReportMetadata(
            report_id=report_id,
            assessment_id=assessment_id,
            format="csv",
            title=f"Findings Export - {assessment_id}",
            content=content,
            integrity_hash=integrity_hash,
            generated_at=datetime.now(timezone.utc).isoformat(),
            generated_by="CSVReportGenerator",
        )


# ── Report Generation Service ────────────────────────────────────


class ReportGenerationService:
    """Orchestrates report generation across formats.

    Manages a registry of report generators and provides a unified
    interface for generating, listing, and verifying reports.
    """

    def __init__(self) -> None:
        """Initialize with default generators."""
        self._generators: dict[str, ReportGenerator] = {}
        self._reports: dict[str, ReportMetadata] = {}
        self._reports_by_assessment: dict[str, list[str]] = {}
        self._counter: int = 0

        self.register_generator(HTMLReportGenerator())
        self.register_generator(JSONReportGenerator())
        self.register_generator(MarkdownReportGenerator())
        self.register_generator(CSVReportGenerator())

    def register_generator(self, generator: ReportGenerator) -> None:
        """Register a report generator.

        Args:
            generator: The generator to register.
        """
        self._generators[generator.format_name] = generator
        logger.info(
            "report_generator.registered",
            format=generator.format_name,
        )

    def get_supported_formats(self) -> list[str]:
        """Get list of supported report formats.

        Returns:
            List of format identifiers.
        """
        return list(self._generators.keys())

    def generate(
        self,
        assessment_id: str,
        format: str,
        assessment: dict[str, Any] | None = None,
        findings: list[dict[str, Any]] | None = None,
        evidence: list[dict[str, Any]] | None = None,
        recommendations: list[dict[str, Any]] | None = None,
    ) -> ReportMetadata:
        """Generate a report in the specified format.

        Args:
            assessment_id: Assessment ID.
            format: Output format (html, json, markdown, csv).
            assessment: Assessment data dict.
            findings: List of finding dicts.
            evidence: List of evidence dicts.
            recommendations: Optional list of recommendation dicts.

        Returns:
            ReportMetadata with content and integrity hash.

        Raises:
            ValueError: If format is not supported.
        """
        generator = self._generators.get(format)
        if generator is None:
            raise ValueError(
                f"Unsupported report format: '{format}'. "
                f"Supported: {', '.join(self._generators.keys())}"
            )

        report_data = build_report_data(
            assessment=assessment or {},
            findings=findings or [],
            evidence=evidence or [],
            recommendations=recommendations,
        )

        self._counter += 1
        report_id = f"rpt-{self._counter:08d}"

        metadata = generator.generate(
            report_id=report_id,
            assessment_id=assessment_id,
            report_data=report_data,
        )

        self._reports[report_id] = metadata
        self._reports_by_assessment.setdefault(assessment_id, []).append(report_id)

        logger.info(
            "report.generated",
            report_id=report_id,
            assessment_id=assessment_id,
            format=format,
            integrity_hash=metadata.integrity_hash,
        )

        return metadata

    def get_report(self, report_id: str) -> ReportMetadata | None:
        """Get a report by ID.

        Args:
            report_id: Report unique identifier.

        Returns:
            ReportMetadata or None if not found.
        """
        return self._reports.get(report_id)

    def get_report_content(self, report_id: str) -> str | None:
        """Get report content by ID.

        Args:
            report_id: Report unique identifier.

        Returns:
            Report content string or None if not found.
        """
        metadata = self._reports.get(report_id)
        if metadata is None:
            return None
        return metadata.content

    def list_reports(
        self,
        assessment_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List reports, optionally filtered by assessment.

        Args:
            assessment_id: Optional assessment ID filter.

        Returns:
            List of report metadata dicts (without content).
        """
        if assessment_id is not None:
            report_ids = self._reports_by_assessment.get(assessment_id, [])
            return [
                self._reports[rid].to_dict()
                for rid in report_ids
                if rid in self._reports
            ]

        return [m.to_dict() for m in self._reports.values()]

    def verify_integrity(self, report_id: str) -> bool | None:
        """Verify report content integrity via SHA-256 hash.

        Args:
            report_id: Report unique identifier.

        Returns:
            True if integrity is valid, False if tampered, None if not found.
        """
        metadata = self._reports.get(report_id)
        if metadata is None:
            return None

        computed_hash = hashlib.sha256(
            metadata.content.encode("utf-8")
        ).hexdigest()
        is_valid = computed_hash == metadata.integrity_hash

        if not is_valid:
            logger.warning(
                "report.integrity_failed",
                report_id=report_id,
                expected=metadata.integrity_hash,
                computed=computed_hash,
            )

        return is_valid

    def list_all_reports(self) -> list[dict[str, Any]]:
        """List all reports across all assessments.

        Returns:
            List of report metadata dicts (without content).
        """
        return [m.to_dict() for m in self._reports.values()]
