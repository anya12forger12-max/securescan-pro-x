"""Workspace service — manages assessment workspaces.

Workspaces are the primary organizational unit in SecureScan Pro X.
They group related assets and assessments together.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from app.core.exceptions import (
    WorkspaceExistsError,
    WorkspaceNotFoundError,
)
from app.core.logging import get_logger
from app.schemas import WorkspaceCreate, WorkspaceUpdate, WorkspaceResponse

logger = get_logger(__name__)


class WorkspaceService(ABC):
    """Interface for workspace management operations."""

    @abstractmethod
    async def create(self, data: WorkspaceCreate) -> WorkspaceResponse:
        """Create a new workspace.

        Args:
            data: Workspace creation data.

        Returns:
            The created workspace.

        Raises:
            WorkspaceExistsError: If name is already taken.
        """
        ...

    @abstractmethod
    async def get(self, workspace_id: str) -> WorkspaceResponse:
        """Get a workspace by ID.

        Args:
            workspace_id: Unique workspace identifier.

        Returns:
            The workspace.

        Raises:
            WorkspaceNotFoundError: If workspace does not exist.
        """
        ...

    @abstractmethod
    async def list(
        self,
        active_only: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[WorkspaceResponse], int]:
        """List all workspaces.

        Args:
            active_only: If True, only return active workspaces.
            offset: Number of workspaces to skip.
            limit: Maximum number to return.

        Returns:
            Tuple of (list of workspaces, total count).
        """
        ...

    @abstractmethod
    async def update(
        self,
        workspace_id: str,
        data: WorkspaceUpdate,
    ) -> WorkspaceResponse:
        """Update a workspace.

        Args:
            workspace_id: Workspace to update.
            data: Update data.

        Returns:
            The updated workspace.

        Raises:
            WorkspaceNotFoundError: If workspace does not exist.
        """
        ...

    @abstractmethod
    async def delete(self, workspace_id: str) -> None:
        """Delete a workspace.

        Args:
            workspace_id: Workspace to delete.

        Raises:
            WorkspaceNotFoundError: If workspace does not exist.
        """
        ...


class InMemoryWorkspaceService(WorkspaceService):
    """In-memory workspace service for development and testing.

    Data is stored in a dictionary and lost on restart.
    """

    def __init__(self) -> None:
        """Initialize the in-memory store."""
        self._workspaces: dict[str, dict] = {}
        self._counter: int = 0

    async def create(self, data: WorkspaceCreate) -> WorkspaceResponse:
        """Create a new workspace in memory.

        Args:
            data: Workspace creation data.

        Returns:
            The created workspace.

        Raises:
            WorkspaceExistsError: If name is already taken.
        """
        # Check for duplicate name
        for ws in self._workspaces.values():
            if ws["name"] == data.name:
                raise WorkspaceExistsError(
                    f"Workspace with name '{data.name}' already exists"
                )

        self._counter += 1
        now = datetime.now(timezone.utc)
        workspace_id = f"ws-{self._counter:08d}"

        workspace = {
            "id": workspace_id,
            "name": data.name,
            "description": data.description,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        self._workspaces[workspace_id] = workspace

        logger.info(
            "workspace.created",
            workspace_id=workspace_id,
            name=data.name,
        )

        return WorkspaceResponse(**workspace)

    async def get(self, workspace_id: str) -> WorkspaceResponse:
        """Get a workspace by ID.

        Args:
            workspace_id: Unique workspace identifier.

        Returns:
            The workspace.

        Raises:
            WorkspaceNotFoundError: If workspace does not exist.
        """
        ws = self._workspaces.get(workspace_id)
        if ws is None:
            raise WorkspaceNotFoundError(
                f"Workspace '{workspace_id}' not found"
            )
        return WorkspaceResponse(**ws)

    async def list(
        self,
        active_only: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[WorkspaceResponse], int]:
        """List workspaces from memory.

        Args:
            active_only: If True, only return active workspaces.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of workspaces, total count).
        """
        all_workspaces = list(self._workspaces.values())

        if active_only:
            all_workspaces = [ws for ws in all_workspaces if ws["is_active"]]

        total = len(all_workspaces)
        page = all_workspaces[offset: offset + limit]

        return (
            [WorkspaceResponse(**ws) for ws in page],
            total,
        )

    async def update(
        self,
        workspace_id: str,
        data: WorkspaceUpdate,
    ) -> WorkspaceResponse:
        """Update a workspace in memory.

        Args:
            workspace_id: Workspace to update.
            data: Update data.

        Returns:
            The updated workspace.

        Raises:
            WorkspaceNotFoundError: If workspace does not exist.
        """
        ws = self._workspaces.get(workspace_id)
        if ws is None:
            raise WorkspaceNotFoundError(
                f"Workspace '{workspace_id}' not found"
            )

        update_data = data.model_dump(exclude_unset=True)
        ws.update(update_data)
        ws["updated_at"] = datetime.now(timezone.utc)

        logger.info(
            "workspace.updated",
            workspace_id=workspace_id,
            fields=list(update_data.keys()),
        )

        return WorkspaceResponse(**ws)

    async def delete(self, workspace_id: str) -> None:
        """Delete a workspace from memory.

        Args:
            workspace_id: Workspace to delete.

        Raises:
            WorkspaceNotFoundError: If workspace does not exist.
        """
        if workspace_id not in self._workspaces:
            raise WorkspaceNotFoundError(
                f"Workspace '{workspace_id}' not found"
            )

        del self._workspaces[workspace_id]
        logger.info("workspace.deleted", workspace_id=workspace_id)
