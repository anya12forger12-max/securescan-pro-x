"""Unit tests for AssessmentService."""

from __future__ import annotations

import pytest

from app.core.exceptions import AssessmentNotFoundError
from app.schemas import AssessmentCreate, AssessmentUpdate
from app.services.assessment import InMemoryAssessmentService


class TestAssessmentService:
    """Tests for AssessmentService implementation."""

    @pytest.fixture
    def service(self) -> InMemoryAssessmentService:
        """Create a fresh service for each test."""
        return InMemoryAssessmentService()

    @pytest.mark.asyncio
    async def test_create_assessment_success(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Creating an assessment with valid data succeeds."""
        data = AssessmentCreate(
            name="Quarterly Assessment",
            description="Security assessment for Q1",
            asset_ids=["asset-1", "asset-2"],
        )
        result = await service.create("ws-1", data)

        assert result.name == "Quarterly Assessment"
        assert result.status == "pending"
        assert result.target_count == 2
        assert result.workspace_id == "ws-1"

    @pytest.mark.asyncio
    async def test_get_assessment_success(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Getting an existing assessment returns it."""
        data = AssessmentCreate(name="Test Assessment")
        created = await service.create("ws-1", data)

        result = await service.get(created.id)
        assert result.name == "Test Assessment"

    @pytest.mark.asyncio
    async def test_get_assessment_not_found(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Getting a nonexistent assessment raises error."""
        with pytest.raises(AssessmentNotFoundError):
            await service.get("nonexistent-id")

    @pytest.mark.asyncio
    async def test_start_assessment(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Starting an assessment transitions to completed (Phase 1A stub)."""
        data = AssessmentCreate(name="To Start")
        created = await service.create("ws-1", data)

        result = await service.start(created.id)
        assert result.status == "completed"
        assert result.started_at is not None
        assert result.completed_at is not None

    @pytest.mark.asyncio
    async def test_cancel_assessment(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Cancelling an assessment transitions to cancelled."""
        data = AssessmentCreate(name="To Cancel")
        created = await service.create("ws-1", data)

        result = await service.cancel(created.id)
        assert result.status == "cancelled"

    @pytest.mark.asyncio
    async def test_list_by_workspace(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Listing assessments by workspace returns correct results."""
        await service.create("ws-1", AssessmentCreate(name="A1"))
        await service.create("ws-1", AssessmentCreate(name="A2"))
        await service.create("ws-2", AssessmentCreate(name="A3"))

        assessments, total = await service.list_by_workspace("ws-1")
        assert total == 2

    @pytest.mark.asyncio
    async def test_update_assessment(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Updating an assessment succeeds."""
        created = await service.create(
            "ws-1",
            AssessmentCreate(name="Original"),
        )
        updated = await service.update(
            created.id,
            AssessmentUpdate(name="Updated"),
        )
        assert updated.name == "Updated"

    @pytest.mark.asyncio
    async def test_delete_assessment(
        self, service: InMemoryAssessmentService
    ) -> None:
        """Deleting an assessment succeeds."""
        created = await service.create(
            "ws-1",
            AssessmentCreate(name="To Delete"),
        )
        await service.delete(created.id)

        with pytest.raises(AssessmentNotFoundError):
            await service.get(created.id)
