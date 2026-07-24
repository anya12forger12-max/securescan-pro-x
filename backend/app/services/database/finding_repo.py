"""Finding repository — database-backed finding operations.

Provides CRUD, full-text search, severity filtering, and aggregate statistics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DatabaseError
from app.core.logging import get_logger
from app.models import Finding
from app.services.database.base import (
    BaseRepository,
    FilterSpec,
    PaginatedResult,
    PaginationParams,
    QueryFilters,
)

logger = get_logger(__name__)


@dataclass
class FindingStatistics:
    """Aggregated finding statistics."""

    total: int = 0
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    info: int = 0
    open_count: int = 0
    confirmed: int = 0
    fixed: int = 0
    false_positive: int = 0
    avg_cvss: float | None = None


class FindingRepository(BaseRepository[Finding]):
    """Repository for finding persistence, search, and statistics."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Finding, session)

    # ── Create ──────────────────────────────────────────────────────

    async def create_finding(
        self,
        assessment_id: str,
        title: str,
        severity: str,
        asset_id: str | None = None,
        description: str | None = None,
        category: str | None = None,
        recommendation: str | None = None,
        evidence: str | None = None,
        cvss_score: float | None = None,
        cwe_ids: str | None = None,
    ) -> Finding:
        """Create a new finding.

        Args:
            assessment_id: Parent assessment.
            title: Finding title.
            severity: One of critical, high, medium, low, info.
            asset_id: Optional related asset.
            description: Detailed description.
            category: Finding category.
            recommendation: Remediation guidance.
            evidence: Evidence text.
            cvss_score: CVSS v3 score (0.0 – 10.0).
            cwe_ids: Comma-separated CWE identifiers.

        Returns:
            The created Finding.
        """
        return await self.create(
            assessment_id=assessment_id,
            title=title,
            severity=severity,
            asset_id=asset_id,
            description=description,
            category=category,
            recommendation=recommendation,
            evidence=evidence,
            cvss_score=cvss_score,
            cwe_ids=cwe_ids,
            status="open",
        )

    # ── Read ────────────────────────────────────────────────────────

    async def get_finding(self, finding_id: str) -> Finding:
        """Get a finding by ID.

        Raises:
            FindingNotFoundError: If not found.
        """
        finding = await self.get(finding_id)
        if finding is None:
            raise DatabaseError(f"Finding '{finding_id}' not found")
        return finding

    async def list_by_assessment(
        self,
        assessment_id: str,
        severity: str | None = None,
        status: str | None = None,
        category: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Finding]:
        """List findings within an assessment.

        Args:
            assessment_id: Parent assessment ID.
            severity: Optional severity filter.
            status: Optional status filter.
            category: Optional category filter.
            pagination: Page parameters.

        Returns:
            PaginatedResult of Findings.
        """
        filters = QueryFilters(
            filters=[
                FilterSpec(column="assessment_id", op="eq", value=assessment_id),
            ],
            order_by="severity",
            order_desc=False,
        )
        if severity:
            filters.filters.append(
                FilterSpec(column="severity", op="eq", value=severity)
            )
        if status:
            filters.filters.append(
                FilterSpec(column="status", op="eq", value=status)
            )
        if category:
            filters.filters.append(
                FilterSpec(column="category", op="eq", value=category)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def list_by_asset(
        self,
        asset_id: str,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Finding]:
        """List findings for a specific asset."""
        filters = QueryFilters(
            filters=[
                FilterSpec(column="asset_id", op="eq", value=asset_id),
            ],
            order_by="created_at",
            order_desc=True,
        )
        return await self.list(filters=filters, pagination=pagination)

    # ── Update ──────────────────────────────────────────────────────

    async def update_finding(
        self,
        finding_id: str,
        **kwargs: Any,
    ) -> Finding:
        """Update finding fields.

        Raises:
            FindingNotFoundError: If not found.
        """
        await self.get_finding(finding_id)
        return await self.update(finding_id, **kwargs)

    async def update_status(
        self,
        finding_id: str,
        new_status: str,
    ) -> Finding:
        """Transition finding status (open → confirmed → fixed, etc.)."""
        await self.get_finding(finding_id)
        return await self.update(finding_id, status=new_status)

    async def delete_finding(self, finding_id: str) -> None:
        """Delete a finding.

        Raises:
            FindingNotFoundError: If not found.
        """
        await self.get_finding(finding_id)
        await self.delete(finding_id)

    # ── Full-text search ────────────────────────────────────────────

    async def search(
        self,
        query: str,
        assessment_id: str | None = None,
        severity: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Finding]:
        """Full-text search across title, description, category, recommendation.

        Performs case-insensitive LIKE matching against multiple text columns.

        Args:
            query: Search term.
            assessment_id: Optional scope to a single assessment.
            severity: Optional severity filter.
            pagination: Page parameters.

        Returns:
            PaginatedResult of matching Findings.
        """
        filters = QueryFilters(
            order_by="created_at",
            order_desc=True,
        )

        # We use LIKE on multiple columns via OR — build a custom query
        # rather than the base filter machinery for the text search part.
        like_pattern = f"%{query}%"
        text_conditions = [
            self.model.title.ilike(like_pattern),
            self.model.description.ilike(like_pattern),
            self.model.category.ilike(like_pattern),
            self.model.recommendation.ilike(like_pattern),
            self.model.evidence.ilike(like_pattern),
        ]

        pagination = pagination or PaginationParams()

        base = select(self.model)
        from sqlalchemy import or_

        base = base.where(or_(*text_conditions))

        if assessment_id:
            base = base.where(self.model.assessment_id == assessment_id)
        if severity:
            base = base.where(self.model.severity == severity)

        # Count
        count_stmt = select(func.count()).select_from(base.subquery())
        total: int = (await self.session.execute(count_stmt)).scalar_one() or 0

        # Order + paginate
        base = base.order_by(self.model.created_at.desc())
        base = base.offset(pagination.offset).limit(pagination.limit)

        result = await self.session.execute(base)
        items = list(result.scalars().all())

        import math

        pages = math.ceil(total / pagination.page_size) if pagination.page_size else 0

        logger.info(
            "finding.search",
            query=query,
            total=total,
            assessment_id=assessment_id,
        )

        return PaginatedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
            pages=pages,
        )

    # ── Severity filtering ──────────────────────────────────────────

    async def list_by_severity(
        self,
        severity: str,
        assessment_id: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Finding]:
        """List findings filtered by severity.

        Args:
            severity: Severity level.
            assessment_id: Optional assessment scope.
            pagination: Page parameters.

        Returns:
            PaginatedResult of Findings.
        """
        filters = QueryFilters(
            filters=[
                FilterSpec(column="severity", op="eq", value=severity),
            ],
            order_by="created_at",
            order_desc=True,
        )
        if assessment_id:
            filters.filters.append(
                FilterSpec(column="assessment_id", op="eq", value=assessment_id)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def list_high_and_critical(
        self,
        assessment_id: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Finding]:
        """Convenience: return only critical and high severity findings."""
        filters = QueryFilters(
            filters=[
                FilterSpec(
                    column="severity",
                    op="in",
                    value=["critical", "high"],
                ),
            ],
            order_by="created_at",
            order_desc=True,
        )
        if assessment_id:
            filters.filters.append(
                FilterSpec(column="assessment_id", op="eq", value=assessment_id)
            )
        return await self.list(filters=filters, pagination=pagination)

    # ── Statistics / aggregation ────────────────────────────────────

    async def get_statistics(
        self,
        assessment_id: str,
    ) -> FindingStatistics:
        """Aggregate finding statistics for an assessment.

        Returns counts by severity and status, plus average CVSS.

        Args:
            assessment_id: Assessment to aggregate over.

        Returns:
            FindingStatistics dataclass.
        """
        base = select(self.model).where(
            self.model.assessment_id == assessment_id
        )
        result = await self.session.execute(base)
        findings = list(result.scalars().all())

        if not findings:
            return FindingStatistics()

        severity_counts: dict[str, int] = {
            "critical": 0,
            "high": 0,
            "medium": 0,
            "low": 0,
            "info": 0,
        }
        status_counts: dict[str, int] = {
            "open": 0,
            "confirmed": 0,
            "fixed": 0,
            "false_positive": 0,
        }
        cvss_scores: list[float] = []

        for f in findings:
            if f.severity in severity_counts:
                severity_counts[f.severity] += 1
            if f.status in status_counts:
                status_counts[f.status] += 1
            if f.cvss_score is not None:
                cvss_scores.append(f.cvss_score)

        avg_cvss = sum(cvss_scores) / len(cvss_scores) if cvss_scores else None

        return FindingStatistics(
            total=len(findings),
            critical=severity_counts["critical"],
            high=severity_counts["high"],
            medium=severity_counts["medium"],
            low=severity_counts["low"],
            info=severity_counts["info"],
            open_count=status_counts["open"],
            confirmed=status_counts["confirmed"],
            fixed=status_counts["fixed"],
            false_positive=status_counts["false_positive"],
            avg_cvss=round(avg_cvss, 2) if avg_cvss is not None else None,
        )

    async def get_severity_distribution(
        self,
        assessment_id: str | None = None,
    ) -> dict[str, int]:
        """Return severity counts using a single aggregation query.

        Args:
            assessment_id: Optional assessment scope.

        Returns:
            Dict mapping severity name to count.
        """
        stmt = (
            select(self.model.severity, func.count())
            .group_by(self.model.severity)
        )
        if assessment_id:
            stmt = stmt.where(self.model.assessment_id == assessment_id)
        result = await self.session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}

    async def get_status_distribution(
        self,
        assessment_id: str | None = None,
    ) -> dict[str, int]:
        """Return status counts using a single aggregation query."""
        stmt = (
            select(self.model.status, func.count())
            .group_by(self.model.status)
        )
        if assessment_id:
            stmt = stmt.where(self.model.assessment_id == assessment_id)
        result = await self.session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}

    async def get_avg_cvss_by_severity(
        self,
        assessment_id: str | None = None,
    ) -> dict[str, float | None]:
        """Return average CVSS score per severity level."""
        stmt = (
            select(
                self.model.severity,
                func.avg(self.model.cvss_score),
            )
            .where(self.model.cvss_score.isnot(None))
            .group_by(self.model.severity)
        )
        if assessment_id:
            stmt = stmt.where(self.model.assessment_id == assessment_id)
        result = await self.session.execute(stmt)
        return {row[0]: round(row[1], 2) if row[1] is not None else None for row in result.all()}

    async def count_by_assessment(self, assessment_id: str) -> int:
        """Count findings in an assessment."""
        return await self.count(
            QueryFilters(
                filters=[
                    FilterSpec(
                        column="assessment_id", op="eq", value=assessment_id
                    ),
                ]
            )
        )
