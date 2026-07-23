"""Assessment service — orchestrates security assessments.

Manages the lifecycle of assessments: plan → execute → collect → analyze.

NOTE: Phase 1A scaffolds this service only. No scanning capability is implemented.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.exceptions import AssessmentNotFoundError
from app.core.logging import get_logger
from app.schemas import AssessmentCreate, AssessmentUpdate, AssessmentResponse

logger = get_logger(__name__)


class AssessmentService(ABC):
    """Interface for assessment management operations."""

    @abstractmethod
    async def create(
        self,
        workspace_id: str,
        data: AssessmentCreate,
    ) -> AssessmentResponse:
        """Create a new assessment.

        Args:
            workspace_id: Parent workspace ID.
            data: Assessment creation data.

        Returns:
            The created assessment.
        """
        ...

    @abstractmethod
    async def get(self, assessment_id: str) -> AssessmentResponse:
        """Get an assessment by ID.

        Args:
            assessment_id: Unique assessment identifier.

        Returns:
            The assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        ...

    @abstractmethod
    async def list_by_workspace(
        self,
        workspace_id: str,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[AssessmentResponse], int]:
        """List assessments in a workspace.

        Args:
            workspace_id: Parent workspace ID.
            status: Filter by status.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of assessments, total count).
        """
        ...

    @abstractmethod
    async def start(self, assessment_id: str) -> AssessmentResponse:
        """Start an assessment.

        TODO (Phase 2): Implement actual check execution.

        Args:
            assessment_id: Assessment to start.

        Returns:
            Updated assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        ...

    @abstractmethod
    async def cancel(self, assessment_id: str) -> AssessmentResponse:
        """Cancel a running assessment.

        TODO (Phase 2): Implement check cancellation.

        Args:
            assessment_id: Assessment to cancel.

        Returns:
            Updated assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        ...

    @abstractmethod
    async def update(
        self,
        assessment_id: str,
        data: AssessmentUpdate,
    ) -> AssessmentResponse:
        """Update an assessment.

        Args:
            assessment_id: Assessment to update.
            data: Update data.

        Returns:
            The updated assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        ...

    @abstractmethod
    async def delete(self, assessment_id: str) -> None:
        """Delete an assessment.

        Args:
            assessment_id: Assessment to delete.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        ...


class InMemoryAssessmentService(AssessmentService):
    """In-memory assessment service for development and testing."""

    def __init__(self) -> None:
        """Initialize the in-memory store."""
        self._assessments: dict[str, dict] = {}
        self._counter: int = 0

    async def create(
        self,
        workspace_id: str,
        data: AssessmentCreate,
    ) -> AssessmentResponse:
        """Create a new assessment in memory.

        Args:
            workspace_id: Parent workspace ID.
            data: Assessment creation data.

        Returns:
            The created assessment.
        """
        self._counter += 1
        now = datetime.now(timezone.utc)
        assessment_id = f"assess-{self._counter:08d}"

        assessment = {
            "id": assessment_id,
            "workspace_id": workspace_id,
            "name": data.name,
            "description": data.description,
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "target_count": len(data.asset_ids),
            "finding_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        self._assessments[assessment_id] = assessment

        logger.info(
            "assessment.created",
            assessment_id=assessment_id,
            workspace_id=workspace_id,
            name=data.name,
            target_count=len(data.asset_ids),
        )

        return AssessmentResponse(**assessment)

    async def get(self, assessment_id: str) -> AssessmentResponse:
        """Get an assessment by ID.

        Args:
            assessment_id: Unique assessment identifier.

        Returns:
            The assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )
        return AssessmentResponse(**assessment)

    async def list_by_workspace(
        self,
        workspace_id: str,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[AssessmentResponse], int]:
        """List assessments in a workspace from memory.

        Args:
            workspace_id: Parent workspace ID.
            status: Filter by status.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of assessments, total count).
        """
        all_assessments = [
            a for a in self._assessments.values()
            if a["workspace_id"] == workspace_id
        ]

        if status is not None:
            all_assessments = [
                a for a in all_assessments if a["status"] == status
            ]

        total = len(all_assessments)
        page = all_assessments[offset: offset + limit]

        return (
            [AssessmentResponse(**a) for a in page],
            total,
        )

    async def start(self, assessment_id: str) -> AssessmentResponse:
        """Start an assessment (stub — no actual scanning in Phase 1A).

        Args:
            assessment_id: Assessment to start.

        Returns:
            Updated assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        now = datetime.now(timezone.utc)
        assessment["status"] = "running"
        assessment["started_at"] = now
        assessment["updated_at"] = now

        logger.info(
            "assessment.started",
            assessment_id=assessment_id,
        )

        # TODO (Phase 2): Actually execute checks
        # For now, immediately mark as completed
        assessment["status"] = "completed"
        assessment["completed_at"] = now

        return AssessmentResponse(**assessment)

    async def cancel(self, assessment_id: str) -> AssessmentResponse:
        """Cancel a running assessment.

        Args:
            assessment_id: Assessment to cancel.

        Returns:
            Updated assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        now = datetime.now(timezone.utc)
        assessment["status"] = "cancelled"
        assessment["completed_at"] = now
        assessment["updated_at"] = now

        logger.info("assessment.cancelled", assessment_id=assessment_id)

        return AssessmentResponse(**assessment)

    async def update(
        self,
        assessment_id: str,
        data: AssessmentUpdate,
    ) -> AssessmentResponse:
        """Update an assessment in memory.

        Args:
            assessment_id: Assessment to update.
            data: Update data.

        Returns:
            The updated assessment.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        update_data = data.model_dump(exclude_unset=True)
        assessment.update(update_data)
        assessment["updated_at"] = datetime.now(timezone.utc)

        return AssessmentResponse(**assessment)

    async def delete(self, assessment_id: str) -> None:
        """Delete an assessment from memory.

        Args:
            assessment_id: Assessment to delete.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        if assessment_id not in self._assessments:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        del self._assessments[assessment_id]
        logger.info("assessment.deleted", assessment_id=assessment_id)
