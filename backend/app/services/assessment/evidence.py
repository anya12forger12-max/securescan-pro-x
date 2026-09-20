"""Evidence pipeline — evidence collection, integrity verification, and management.

Manages the lifecycle of evidence items: collection → storage → verification →
retention. Each evidence item carries an integrity hash for tamper detection.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.exceptions import EvidenceNotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.assessment import EvidenceClassification, EvidenceType

logger = get_logger(__name__)


# ── Evidence Service Interface ─────────────────────────────────────


class EvidenceService(ABC):
    """Interface for evidence management operations."""

    @abstractmethod
    async def add(
        self,
        assessment_id: str,
        evidence_type: str,
        title: str,
        content: str | None = None,
        source: str = "manual",
        collector: str = "system",
        classification: str = "internal",
        finding_id: str | None = None,
        tags: list[str] | None = None,
        retention_days: int = 365,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Add a new evidence item to an assessment.

        Args:
            assessment_id: Parent assessment ID.
            evidence_type: Type of evidence.
            title: Human-readable title.
            content: Evidence content (text, JSON, etc.).
            source: Origin of the evidence.
            collector: Who or what collected it.
            classification: Sensitivity classification.
            finding_id: Optional linked finding ID.
            tags: Optional tags for categorization.
            retention_days: How long to retain in days.
            metadata: Additional key-value metadata.

        Returns:
            The created evidence item as a dict.
        """
        ...

    @abstractmethod
    async def get(self, evidence_id: str) -> dict[str, Any]:
        """Get an evidence item by ID.

        Args:
            evidence_id: Evidence item ID.

        Returns:
            The evidence item.

        Raises:
            EvidenceNotFoundError: If evidence does not exist.
        """
        ...

    @abstractmethod
    async def list_by_assessment(
        self,
        assessment_id: str,
        evidence_type: str | None = None,
        classification: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict[str, Any]], int]:
        """List evidence items for an assessment.

        Args:
            assessment_id: Parent assessment ID.
            evidence_type: Filter by evidence type.
            classification: Filter by classification.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of evidence items, total count).
        """
        ...

    @abstractmethod
    async def verify_integrity(self, evidence_id: str) -> bool:
        """Verify the integrity hash of an evidence item.

        Args:
            evidence_id: Evidence item ID.

        Returns:
            True if integrity is verified.

        Raises:
            EvidenceNotFoundError: If evidence does not exist.
        """
        ...

    @abstractmethod
    async def delete(self, evidence_id: str) -> None:
        """Soft-delete an evidence item.

        Args:
            evidence_id: Evidence item to delete.

        Raises:
            EvidenceNotFoundError: If evidence does not exist.
        """
        ...

    @abstractmethod
    async def count_by_assessment(self, assessment_id: str) -> int:
        """Count evidence items for an assessment.

        Args:
            assessment_id: Parent assessment ID.

        Returns:
            Count of evidence items.
        """
        ...


# ── Integrity Helpers ──────────────────────────────────────────────


def compute_evidence_hash(content: str | None, source: str) -> str:
    """Compute an integrity hash for evidence content.

    Uses SHA-256 over the concatenation of source and content.

    Args:
        content: The evidence content.
        source: The evidence source.

    Returns:
        Hex-encoded SHA-256 hash string.
    """
    payload = f"{source}:{content or ''}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# ── In-Memory Implementation ──────────────────────────────────────


class InMemoryEvidenceService(EvidenceService):
    """In-memory evidence service for development and testing."""

    def __init__(self) -> None:
        """Initialize the in-memory evidence store."""
        self._evidence: dict[str, dict[str, Any]] = {}
        self._counter: int = 0

    async def add(
        self,
        assessment_id: str,
        evidence_type: str,
        title: str,
        content: str | None = None,
        source: str = "manual",
        collector: str = "system",
        classification: str = "internal",
        finding_id: str | None = None,
        tags: list[str] | None = None,
        retention_days: int = 365,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Add a new evidence item to memory.

        Args:
            assessment_id: Parent assessment ID.
            evidence_type: Type of evidence.
            title: Human-readable title.
            content: Evidence content.
            source: Origin of the evidence.
            collector: Who collected it.
            classification: Sensitivity classification.
            finding_id: Optional linked finding ID.
            tags: Optional tags.
            retention_days: Retention period in days.
            metadata: Additional metadata.

        Returns:
            The created evidence item.

        Raises:
            ValidationError: If evidence_type or classification is invalid.
        """
        valid_types = {t.value for t in EvidenceType}
        if evidence_type not in valid_types:
            raise ValidationError(
                f"Invalid evidence type '{evidence_type}'. "
                f"Must be one of: {sorted(valid_types)}"
            )

        valid_classifications = {c.value for c in EvidenceClassification}
        if classification not in valid_classifications:
            raise ValidationError(
                f"Invalid classification '{classification}'. "
                f"Must be one of: {sorted(valid_classifications)}"
            )

        self._counter += 1
        now = datetime.now(timezone.utc)
        evidence_id = f"ev-{self._counter:08d}"
        integrity_hash = compute_evidence_hash(content, source)

        item = {
            "id": evidence_id,
            "assessment_id": assessment_id,
            "finding_id": finding_id,
            "evidence_type": evidence_type,
            "title": title,
            "description": None,
            "content": content,
            "integrity_hash": integrity_hash,
            "source": source,
            "collector": collector,
            "classification": classification,
            "tags": tags or [],
            "retention_days": retention_days,
            "is_deleted": False,
            "created_at": now,
            "updated_at": now,
        }
        self._evidence[evidence_id] = item

        logger.info(
            "evidence.added",
            evidence_id=evidence_id,
            assessment_id=assessment_id,
            evidence_type=evidence_type,
            classification=classification,
        )
        return dict(item)

    async def get(self, evidence_id: str) -> dict[str, Any]:
        """Get an evidence item by ID.

        Args:
            evidence_id: Evidence item ID.

        Returns:
            The evidence item.

        Raises:
            EvidenceNotFoundError: If evidence does not exist.
        """
        item = self._evidence.get(evidence_id)
        if item is None or item["is_deleted"]:
            raise EvidenceNotFoundError(f"Evidence '{evidence_id}' not found")
        return dict(item)

    async def list_by_assessment(
        self,
        assessment_id: str,
        evidence_type: str | None = None,
        classification: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict[str, Any]], int]:
        """List evidence items for an assessment.

        Args:
            assessment_id: Parent assessment ID.
            evidence_type: Filter by evidence type.
            classification: Filter by classification.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of evidence items, total count).
        """
        items = [
            e for e in self._evidence.values()
            if e["assessment_id"] == assessment_id and not e["is_deleted"]
        ]
        if evidence_type is not None:
            items = [e for e in items if e["evidence_type"] == evidence_type]
        if classification is not None:
            items = [e for e in items if e["classification"] == classification]

        total = len(items)
        page = items[offset:offset + limit]
        return ([dict(e) for e in page], total)

    async def verify_integrity(self, evidence_id: str) -> bool:
        """Verify the integrity hash of an evidence item.

        Args:
            evidence_id: Evidence item ID.

        Returns:
            True if integrity is verified.

        Raises:
            EvidenceNotFoundError: If evidence does not exist.
        """
        item = await self.get(evidence_id)
        expected_hash = compute_evidence_hash(item["content"], item["source"])
        verified = item["integrity_hash"] == expected_hash

        if not verified:
            logger.warning(
                "evidence.integrity_failed",
                evidence_id=evidence_id,
                expected=expected_hash,
                actual=item["integrity_hash"],
            )
        return verified

    async def delete(self, evidence_id: str) -> None:
        """Soft-delete an evidence item.

        Args:
            evidence_id: Evidence item to delete.

        Raises:
            EvidenceNotFoundError: If evidence does not exist.
        """
        item = self._evidence.get(evidence_id)
        if item is None or item["is_deleted"]:
            raise EvidenceNotFoundError(f"Evidence '{evidence_id}' not found")

        item["is_deleted"] = True
        item["updated_at"] = datetime.now(timezone.utc)
        logger.info("evidence.deleted", evidence_id=evidence_id)

    async def count_by_assessment(self, assessment_id: str) -> int:
        """Count non-deleted evidence items for an assessment.

        Args:
            assessment_id: Parent assessment ID.

        Returns:
            Count of evidence items.
        """
        return sum(
            1 for e in self._evidence.values()
            if e["assessment_id"] == assessment_id and not e["is_deleted"]
        )
