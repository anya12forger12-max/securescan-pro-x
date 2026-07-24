"""Unit tests for evidence pipeline and result normalization.

Tests cover evidence CRUD, integrity verification, validation,
and finding normalization.
"""

from __future__ import annotations

import pytest

from app.core.exceptions import EvidenceNotFoundError, ValidationError
from app.services.assessment.evidence import (
    InMemoryEvidenceService,
    compute_evidence_hash,
)
from app.services.assessment.normalization import (
    NormalizedFinding,
    finding_to_dict,
    normalize_finding,
    normalize_findings_batch,
)


class TestEvidenceHash:
    """Tests for evidence integrity hashing."""

    def test_hash_deterministic(self) -> None:
        """Same input produces same hash."""
        h1 = compute_evidence_hash("content", "source")
        h2 = compute_evidence_hash("content", "source")
        assert h1 == h2

    def test_hash_differs_with_different_content(self) -> None:
        """Different content produces different hash."""
        h1 = compute_evidence_hash("content1", "source")
        h2 = compute_evidence_hash("content2", "source")
        assert h1 != h2

    def test_hash_differs_with_different_source(self) -> None:
        """Different source produces different hash."""
        h1 = compute_evidence_hash("content", "source1")
        h2 = compute_evidence_hash("content", "source2")
        assert h1 != h2

    def test_hash_empty_content(self) -> None:
        """None content is handled gracefully."""
        h = compute_evidence_hash(None, "source")
        assert isinstance(h, str)
        assert len(h) == 64  # SHA-256 hex length


class TestEvidenceService:
    """Tests for InMemoryEvidenceService."""

    @pytest.fixture
    def service(self) -> InMemoryEvidenceService:
        """Create a fresh service."""
        return InMemoryEvidenceService()

    @pytest.mark.asyncio
    async def test_add_evidence(self, service: InMemoryEvidenceService) -> None:
        """Adding evidence succeeds."""
        result = await service.add(
            assessment_id="assess-1",
            evidence_type="structured_data",
            title="Test Evidence",
            content='{"key": "value"}',
        )
        assert result["title"] == "Test Evidence"
        assert result["evidence_type"] == "structured_data"
        assert result["integrity_hash"]

    @pytest.mark.asyncio
    async def test_add_invalid_type(self, service: InMemoryEvidenceService) -> None:
        """Adding evidence with invalid type raises error."""
        with pytest.raises(ValidationError):
            await service.add(
                assessment_id="assess-1",
                evidence_type="invalid_type",
                title="Test",
            )

    @pytest.mark.asyncio
    async def test_add_invalid_classification(self, service: InMemoryEvidenceService) -> None:
        """Adding evidence with invalid classification raises error."""
        with pytest.raises(ValidationError):
            await service.add(
                assessment_id="assess-1",
                evidence_type="log",
                title="Test",
                classification="invalid",
            )

    @pytest.mark.asyncio
    async def test_get_evidence(self, service: InMemoryEvidenceService) -> None:
        """Getting existing evidence returns it."""
        created = await service.add(
            assessment_id="assess-1",
            evidence_type="metadata",
            title="Get Me",
        )
        result = await service.get(created["id"])
        assert result["title"] == "Get Me"

    @pytest.mark.asyncio
    async def test_get_evidence_not_found(self, service: InMemoryEvidenceService) -> None:
        """Getting nonexistent evidence raises error."""
        with pytest.raises(EvidenceNotFoundError):
            await service.get("nonexistent")

    @pytest.mark.asyncio
    async def test_list_by_assessment(self, service: InMemoryEvidenceService) -> None:
        """Listing evidence by assessment returns correct items."""
        await service.add("a1", "log", "Log 1")
        await service.add("a1", "metadata", "Meta 1")
        await service.add("a2", "log", "Log 2")

        items, total = await service.list_by_assessment("a1")
        assert total == 2

    @pytest.mark.asyncio
    async def test_list_filter_by_type(self, service: InMemoryEvidenceService) -> None:
        """Filtering by evidence type works."""
        await service.add("a1", "log", "Log 1")
        await service.add("a1", "metadata", "Meta 1")

        items, total = await service.list_by_assessment("a1", evidence_type="log")
        assert total == 1
        assert items[0]["title"] == "Log 1"

    @pytest.mark.asyncio
    async def test_verify_integrity_valid(self, service: InMemoryEvidenceService) -> None:
        """Integrity verification passes for unmodified evidence."""
        created = await service.add(
            assessment_id="a1",
            evidence_type="structured_data",
            title="Verify Me",
            content="original content",
            source="test-source",
        )
        assert await service.verify_integrity(created["id"])

    @pytest.mark.asyncio
    async def test_verify_integrity_tampered(self, service: InMemoryEvidenceService) -> None:
        """Integrity verification fails for tampered evidence."""
        created = await service.add(
            assessment_id="a1",
            evidence_type="structured_data",
            title="Tamper Me",
            content="original",
            source="test",
        )
        # Tamper with content
        service._evidence[created["id"]]["content"] = "tampered"
        assert not await service.verify_integrity(created["id"])

    @pytest.mark.asyncio
    async def test_delete_evidence(self, service: InMemoryEvidenceService) -> None:
        """Soft-deleting evidence works."""
        created = await service.add("a1", "log", "Delete Me")
        await service.delete(created["id"])

        with pytest.raises(EvidenceNotFoundError):
            await service.get(created["id"])

    @pytest.mark.asyncio
    async def test_count_by_assessment(self, service: InMemoryEvidenceService) -> None:
        """Counting evidence works."""
        await service.add("a1", "log", "L1")
        await service.add("a1", "log", "L2")
        await service.add("a2", "log", "L3")

        count = await service.count_by_assessment("a1")
        assert count == 2


class TestFindingNormalization:
    """Tests for finding normalization."""

    def test_normalize_basic_finding(self) -> None:
        """Normalizing a basic finding succeeds."""
        result = normalize_finding({
            "title": "Test Finding",
            "severity": "high",
            "category": "test",
        })
        assert result.title == "Test Finding"
        assert result.severity == "high"
        assert result.confidence == 0.5  # default

    def test_normalize_with_all_fields(self) -> None:
        """Normalizing a finding with all fields works."""
        result = normalize_finding({
            "title": "Full Finding",
            "summary": "Detailed summary",
            "severity": "critical",
            "confidence": 0.95,
            "category": "security",
            "status": "confirmed",
            "recommendation": "Fix this",
            "references": ["https://example.com"],
            "cvss_score": 9.8,
            "cwe_ids": ["CWE-79"],
        })
        assert result.title == "Full Finding"
        assert result.summary == "Detailed summary"
        assert result.severity == "critical"
        assert result.confidence == 0.95
        assert result.cvss_score == 9.8
        assert result.cwe_ids == ["CWE-79"]

    def test_normalize_invalid_severity(self) -> None:
        """Normalizing with invalid severity raises error."""
        with pytest.raises(ValueError):
            normalize_finding({
                "title": "Bad",
                "severity": "invalid",
                "category": "test",
            })

    def test_normalize_out_of_range_confidence(self) -> None:
        """Normalizing with out-of-range confidence raises error."""
        with pytest.raises(ValueError):
            normalize_finding({
                "title": "Bad",
                "severity": "info",
                "confidence": 1.5,
                "category": "test",
            })

    def test_normalize_empty_title(self) -> None:
        """Normalizing with empty title raises error."""
        with pytest.raises(ValueError):
            normalize_finding({
                "title": "  ",
                "severity": "info",
                "category": "test",
            })

    def test_normalize_batch(self) -> None:
        """Batch normalization filters invalid findings."""
        results = normalize_findings_batch([
            {"title": "Good", "severity": "high", "category": "test"},
            {"title": "Bad", "severity": "invalid", "category": "test"},
            {"title": "Also Good", "severity": "low", "category": "test"},
        ])
        assert len(results) == 2

    def test_finding_to_dict(self) -> None:
        """Serializing a finding to dict works."""
        finding = NormalizedFinding(
            title="Test",
            summary="Summary",
            severity="info",
            confidence=0.5,
            category="test",
        )
        d = finding_to_dict(finding)
        assert d["title"] == "Test"
        assert d["severity"] == "info"
        assert isinstance(d, dict)
