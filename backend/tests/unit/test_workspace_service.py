"""Unit tests for WorkspaceService."""

from __future__ import annotations

import pytest

from app.core.exceptions import WorkspaceExistsError, WorkspaceNotFoundError
from app.schemas import WorkspaceCreate, WorkspaceUpdate
from app.services.workspace import InMemoryWorkspaceService


class TestWorkspaceService:
    """Tests for WorkspaceService implementation."""

    @pytest.fixture
    def service(self) -> InMemoryWorkspaceService:
        """Create a fresh service for each test."""
        return InMemoryWorkspaceService()

    @pytest.mark.asyncio
    async def test_create_workspace_success(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Creating a workspace with valid data succeeds."""
        data = WorkspaceCreate(
            name="Test Workspace",
            description="A test workspace",
        )
        result = await service.create(data)

        assert result.name == "Test Workspace"
        assert result.description == "A test workspace"
        assert result.is_active is True
        assert result.id is not None

    @pytest.mark.asyncio
    async def test_create_workspace_minimal(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Creating a workspace with only a name succeeds."""
        data = WorkspaceCreate(name="Minimal Workspace")
        result = await service.create(data)

        assert result.name == "Minimal Workspace"
        assert result.description is None

    @pytest.mark.asyncio
    async def test_create_workspace_duplicate_name(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Creating a workspace with duplicate name raises error."""
        data = WorkspaceCreate(name="Existing")
        await service.create(data)

        with pytest.raises(WorkspaceExistsError):
            await service.create(data)

    @pytest.mark.asyncio
    async def test_get_workspace_success(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Getting an existing workspace returns it."""
        data = WorkspaceCreate(name="Get Test")
        created = await service.create(data)

        result = await service.get(created.id)
        assert result.id == created.id
        assert result.name == "Get Test"

    @pytest.mark.asyncio
    async def test_get_workspace_not_found(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Getting a nonexistent workspace raises error."""
        with pytest.raises(WorkspaceNotFoundError):
            await service.get("nonexistent-id")

    @pytest.mark.asyncio
    async def test_list_workspaces_empty(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Listing workspaces when none exist returns empty list."""
        workspaces, total = await service.list()
        assert workspaces == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_list_workspaces_with_data(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Listing workspaces returns created workspaces."""
        await service.create(WorkspaceCreate(name="WS 1"))
        await service.create(WorkspaceCreate(name="WS 2"))

        workspaces, total = await service.list()
        assert total == 2
        assert len(workspaces) == 2

    @pytest.mark.asyncio
    async def test_update_workspace_success(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Updating an existing workspace succeeds."""
        created = await service.create(WorkspaceCreate(name="Original"))
        updated = await service.update(
            created.id,
            WorkspaceUpdate(name="Updated"),
        )

        assert updated.name == "Updated"
        assert updated.id == created.id

    @pytest.mark.asyncio
    async def test_update_workspace_not_found(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Updating a nonexistent workspace raises error."""
        with pytest.raises(WorkspaceNotFoundError):
            await service.update(
                "nonexistent-id",
                WorkspaceUpdate(name="Updated"),
            )

    @pytest.mark.asyncio
    async def test_delete_workspace_success(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Deleting an existing workspace succeeds."""
        created = await service.create(WorkspaceCreate(name="To Delete"))
        await service.delete(created.id)

        with pytest.raises(WorkspaceNotFoundError):
            await service.get(created.id)

    @pytest.mark.asyncio
    async def test_delete_workspace_not_found(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Deleting a nonexistent workspace raises error."""
        with pytest.raises(WorkspaceNotFoundError):
            await service.delete("nonexistent-id")

    @pytest.mark.asyncio
    async def test_create_multiple_workspaces(
        self, service: InMemoryWorkspaceService
    ) -> None:
        """Creating multiple workspaces with different names succeeds."""
        ws1 = await service.create(WorkspaceCreate(name="First"))
        ws2 = await service.create(WorkspaceCreate(name="Second"))
        ws3 = await service.create(WorkspaceCreate(name="Third"))

        assert ws1.id != ws2.id != ws3.id

        workspaces, total = await service.list()
        assert total == 3
