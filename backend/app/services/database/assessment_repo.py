"""Assessment repository — database-backed assessment operations.

Provides CRUD, workspace-scoped listing, status updates, and lifecycle queries.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    AssessmentNotFoundError,
    DatabaseError,
)
from app.core.logging import get_logger
from app.models import Assessment
from app.services.database.base import (
    BaseRepository,
    FilterSpec,
    PaginatedResult,
    PaginationParams,
    QueryFilters,
)

logger = get_logger(__name__)

_STATUS_PENDING = "pending"
_STATUS_RUNNING = "running"
_STATUS_COMPLETED = "completed"
_STATUS_FAILED = "failed"
_STATUS_CANCELLED = "cancelled"


class AssessmentRepository(BaseRepository[Assessment]):
    """Repository for assessment persistence and queries."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Assessment, session)

    async def create_assessment(
        self,
        workspace_id: str,
        name: str,
        description: str | None = None,
    ) -> Assessment:
        """Create a new assessment.

        Args:
            workspace_id: Parent workspace.
            name: Assessment name.
            description: Optional description.

        Returns:
            The created Assessment.
        """
        return await self.create(
            workspace_id=workspace_id,
            name=name,
            description=description,
            status=_STATUS_PENDING,
            target_count=0,
            finding_count=0,
        )

    async def get_assessment(
        self,
        assessment_id: str,
        *,
        load_relationships: bool = False,
    ) -> Assessment:
        """Get an assessment by ID.

        Args:
            assessment_id: Assessment PK.
            load_relationships: Eagerly load related entities.

        Raises:
            AssessmentNotFoundError: If not found.
        """
        if load_relationships:
            stmt = (
                select(self.model)
                .options(
                    selectinload(self.model.findings),
                )
                .where(self.model.id == assessment_id)
            )
            result = await self.session.execute(stmt)
            assessment = result.scalar_one_or_none()
        else:
            assessment = await self.get(assessment_id)

        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )
        return assessment

    async def list_assessments(
        self,
        workspace_id: str,
        status: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Assessment]:
        """List assessments within a workspace.

        Args:
            workspace_id: Workspace scope.
            status: Optional status filter.
            pagination: Page parameters.

        Returns:
            PaginatedResult of Assessments.
        """
        filters = QueryFilters(
            filters=[
                FilterSpec(column="workspace_id", op="eq", value=workspace_id),
            ],
            order_by="created_at",
            order_desc=True,
        )
        if status:
            filters.filters.append(
                FilterSpec(column="status", op="eq", value=status)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def update_assessment(
        self,
        assessment_id: str,
        **kwargs: Any,
    ) -> Assessment:
        """Update assessment fields.

        Raises:
            AssessmentNotFoundError: If not found.
        """
        await self.get_assessment(assessment_id)
        return await self.update(assessment_id, **kwargs)

    async def delete_assessment(self, assessment_id: str) -> None:
        """Hard-delete an assessment.

        Raises:
            AssessmentNotFoundError: If not found.
        """
        await self.get_assessment(assessment_id)
        await self.delete(assessment_id)

    # ── Status / lifecycle ──────────────────────────────────────────

    async def update_status(
        self,
        assessment_id: str,
        new_status: str,
        actor: str | None = None,
    ) -> Assessment:
        """Transition assessment status with timestamp bookkeeping.

        Automatically sets started_at / completed_at based on the new status.

        Args:
            assessment_id: Assessment to update.
            new_status: Target status value.
            actor: Optional user / system identifier.

        Returns:
            Updated assessment.
        """
        await self.get_assessment(assessment_id)

        update_fields: dict[str, Any] = {"status": new_status}
        now = datetime.now(timezone.utc)

        if new_status == _STATUS_RUNNING:
            update_fields["started_at"] = now
        elif new_status in (_STATUS_COMPLETED, _STATUS_FAILED, _STATUS_CANCELLED):
            update_fields["completed_at"] = now

        await self.session.execute(
            update(self.model)
            .where(self.model.id == assessment_id)
            .values(**update_fields)
        )
        await self.session.flush()

        logger.info(
            "assessment.status_updated",
            assessment_id=assessment_id,
            new_status=new_status,
            actor=actor,
        )

        return await self.get_assessment(assessment_id)

    async def set_target_count(
        self,
        assessment_id: str,
        count: int,
    ) -> None:
        """Set the target count for an assessment."""
        await self.session.execute(
            update(self.model)
            .where(self.model.id == assessment_id)
            .values(target_count=count)
        )
        await self.session.flush()

    async def set_finding_count(
        self,
        assessment_id: str,
        count: int,
    ) -> None:
        """Set the finding count for an assessment."""
        await self.session.execute(
            update(self.model)
            .where(self.model.id == assessment_id)
            .values(finding_count=count)
        )
        await self.session.flush()

    async def increment_finding_count(
        self,
        assessment_id: str,
        amount: int = 1,
    ) -> None:
        """Atomically increment the finding count."""
        await self.session.execute(
            update(self.model)
            .where(self.model.id == assessment_id)
            .values(finding_count=self.model.finding_count + amount)
        )
        await self.session.flush()

    # ── Queries ─────────────────────────────────────────────────────

    async def list_by_status(
        self,
        status: str,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Assessment]:
        """List all assessments with a given status across all workspaces."""
        filters = QueryFilters(
            filters=[
                FilterSpec(column="status", op="eq", value=status),
            ],
            order_by="created_at",
            order_desc=True,
        )
        return await self.list(filters=filters, pagination=pagination)

    async def count_by_workspace(self, workspace_id: str) -> int:
        """Count assessments in a workspace."""
        return await self.count(
            QueryFilters(
                filters=[
                    FilterSpec(column="workspace_id", op="eq", value=workspace_id),
                ]
            )
        )

    async def count_by_status(self) -> dict[str, int]:
        """Return a count of assessments grouped by status."""
        from sqlalchemy import func

        stmt = (
            select(self.model.status, func.count())
            .group_by(self.model.status)
        )
        result = await self.session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}
