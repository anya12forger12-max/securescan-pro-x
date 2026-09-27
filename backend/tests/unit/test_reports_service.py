"""Unit tests for ReportGenerationService.

Locks the four-format generation contract, integrity verification
(including the HTML embedded-hash regression), and store lookups.
"""

from __future__ import annotations

import pytest

from app.services.reports import ReportGenerationService


@pytest.fixture
def service() -> ReportGenerationService:
    return ReportGenerationService()


def _sample() -> tuple[dict, list[dict], list[dict]]:
    assessment = {
        "id": "asm-test-1",
        "name": "Quarterly review",
        "status": "completed",
        "risk_score": 7.5,
        "risk_level": "high",
        "asset_count": 1,
        "finding_count": 1,
        "created_at": "2026-01-01T00:00:00Z",
        "completed_at": "2026-01-02T00:00:00Z",
    }
    findings = [
        {
            "id": "fnd-1",
            "title": "Outdated TLS",
            "severity": "high",
            "status": "open",
            "description": "TLS 1.0 is enabled.",
            "asset_id": "ast-1",
            "cwe_id": "CWE-326",
            "cvss_score": 7.5,
        }
    ]
    evidence = [
        {
            "id": "ev-1",
            "title": "nmap output",
            "evidence_type": "scan_result",
            "source": "nmap",
            "classification": "internal",
        }
    ]
    return assessment, findings, evidence


class TestGeneration:
    """Format generation contract."""

    @pytest.mark.parametrize("fmt", ["html", "json", "markdown", "csv"])
    def test_supported_format_generates(
        self,
        service: ReportGenerationService,
        fmt: str,
    ) -> None:
        assessment, findings, evidence = _sample()
        meta = service.generate(
            assessment_id=assessment["id"],
            format=fmt,
            assessment=assessment,
            findings=findings,
            evidence=evidence,
        )
        assert meta.report_id.startswith("rpt-")
        assert meta.format == fmt
        assert meta.assessment_id == assessment["id"]
        assert meta.content
        assert len(meta.integrity_hash) == 64
        assert service.verify_integrity(meta.report_id) is True

    def test_get_supported_formats(self, service: ReportGenerationService) -> None:
        assert set(service.get_supported_formats()) == {"html", "json", "markdown", "csv"}

    def test_unsupported_format_raises(self, service: ReportGenerationService) -> None:
        with pytest.raises(ValueError, match="Unsupported report format"):
            service.generate(assessment_id="asm-x", format="pdf")

    def test_report_ids_increment(self, service: ReportGenerationService) -> None:
        first = service.generate(assessment_id="asm-a", format="json")
        second = service.generate(assessment_id="asm-b", format="json")
        assert first.report_id != second.report_id


class TestIntegrity:
    """Integrity hashing, including the HTML embedded-hash regression."""

    def test_html_embedded_hash_matches_stored(self, service: ReportGenerationService) -> None:
        """The hash embedded in the HTML span equals the stored hash and verifies.

        Regression: the generator used to hash the content and then mutate
        it (embedding the hash), so verify_integrity() always returned False.
        """
        meta = service.generate(assessment_id="asm-html", format="html")
        assert f'id="integrity-hash-placeholder">{meta.integrity_hash}<' in meta.content
        assert service.verify_integrity(meta.report_id) is True

    @pytest.mark.parametrize("fmt", ["html", "json", "markdown", "csv"])
    def test_tampering_detected(
        self,
        service: ReportGenerationService,
        fmt: str,
    ) -> None:
        meta = service.generate(assessment_id="asm-t", format=fmt)
        meta.content += "\nTAMPERED"
        assert service.verify_integrity(meta.report_id) is False

    def test_unknown_report_returns_none(self, service: ReportGenerationService) -> None:
        assert service.verify_integrity("rpt-00000000") is None


class TestStore:
    """Report store lookups."""

    def test_get_report_and_content(self, service: ReportGenerationService) -> None:
        meta = service.generate(assessment_id="asm-get", format="json")
        fetched = service.get_report(meta.report_id)
        assert fetched is not None
        assert fetched.integrity_hash == meta.integrity_hash
        assert service.get_report_content(meta.report_id) == meta.content
        assert service.get_report("rpt-00000000") is None
        assert service.get_report_content("rpt-00000000") is None

    def test_list_reports_filters_by_assessment(
        self,
        service: ReportGenerationService,
    ) -> None:
        service.generate(assessment_id="asm-one", format="json")
        service.generate(assessment_id="asm-one", format="markdown")
        service.generate(assessment_id="asm-two", format="csv")

        assert len(service.list_reports("asm-one")) == 2
        assert len(service.list_reports("asm-two")) == 1
        assert service.list_reports("asm-none") == []
        assert len(service.list_reports()) == 3
        assert len(service.list_all_reports()) == 3
        # Serialized form carries id + integrity_hash but never full content.
        entry = service.list_reports("asm-one")[0]
        assert entry["id"].startswith("rpt-")
        assert entry["integrity_hash"]
        assert "content" not in entry
