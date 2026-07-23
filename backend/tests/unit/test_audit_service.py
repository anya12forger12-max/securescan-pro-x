"""Unit tests for AuditService."""

from __future__ import annotations

import pytest

from app.services.audit import InMemoryAuditService


class TestAuditService:
    """Tests for AuditService implementation."""

    @pytest.fixture
    def service(self) -> InMemoryAuditService:
        """Create a fresh service for each test."""
        return InMemoryAuditService()

    @pytest.mark.asyncio
    async def test_log_event_success(
        self, service: InMemoryAuditService
    ) -> None:
        """Logging an audit event succeeds."""
        event = await service.log_event(
            action="workspace.create",
            user_id="user-1",
            resource_type="workspace",
            resource_id="ws-1",
            details={"name": "Test Workspace"},
        )

        assert event.id is not None
        assert event.action == "workspace.create"
        assert event.user_id == "user-1"
        assert event.success is True

    @pytest.mark.asyncio
    async def test_log_event_failure(
        self, service: InMemoryAuditService
    ) -> None:
        """Logging a failed audit event succeeds."""
        event = await service.log_event(
            action="workspace.create",
            success=False,
            error_message="Permission denied",
        )

        assert event.success is False
        assert event.error_message == "Permission denied"

    @pytest.mark.asyncio
    async def test_get_events(
        self, service: InMemoryAuditService
    ) -> None:
        """Getting audit events returns logged events."""
        await service.log_event(action="action.1", user_id="user-1")
        await service.log_event(action="action.2", user_id="user-2")
        await service.log_event(action="action.1", user_id="user-1")

        events = await service.get_events(action="action.1")
        assert len(events) == 2

    @pytest.mark.asyncio
    async def test_get_events_filter_by_user(
        self, service: InMemoryAuditService
    ) -> None:
        """Filtering events by user returns correct results."""
        await service.log_event(action="a", user_id="user-1")
        await service.log_event(action="a", user_id="user-2")

        events = await service.get_events(user_id="user-1")
        assert len(events) == 1

    @pytest.mark.asyncio
    async def test_get_event_count(
        self, service: InMemoryAuditService
    ) -> None:
        """Getting event count returns correct count."""
        assert await service.get_event_count() == 0

        await service.log_event(action="a")
        await service.log_event(action="b")

        assert await service.get_event_count() == 2

    @pytest.mark.asyncio
    async def test_get_events_pagination(
        self, service: InMemoryAuditService
    ) -> None:
        """Pagination works correctly."""
        for i in range(10):
            await service.log_event(action=f"action.{i}")

        events = await service.get_events(limit=3, offset=0)
        assert len(events) == 3

        events = await service.get_events(limit=3, offset=7)
        assert len(events) == 3
