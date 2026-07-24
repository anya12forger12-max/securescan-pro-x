"""Workspace repository — database-backed workspace operations.

Provides CRUD, listing, and name-uniqueness checks for Workspace entities.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DatabaseError, WorkspaceExistsError, WorkspaceNotFoundError
from app.core.logging import get_logger
from app.models import Workspace
from app.services.database.base import (
    BaseRepository,
    FilterSpec,
    PaginatedResult,
    PaginationParams,
    QueryFilters,
)

logger = get_logger(__name__)


class WorkspaceRepository(BaseRepository[Workspace]):
    """Repository for workspace persistence and queries."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Workspace, session)

    async def create_workspace(
        self,
        name: str,
        description: str | None = None,
    ) -> Workspace:
        """Create a workspace, enforcing unique name.

        Args:
            name: Unique workspace name.
            description: Optional description.

        Returns:
            The created Workspace.

        Raises:
            WorkspaceExistsError: If name is already taken.
        """
        if await self.name_exists(name):
            raise WorkspaceExistsError(
                f"Workspace with name '{name}' already exists"
            )

        return await self.create(name=name, description=description, is_active=True)

    async def get_workspace(self, workspace_id: str) -> Workspace:
        """Get a workspace by ID.

        Raises:
            WorkspaceNotFoundError: If not found.
        """
        ws = await self.get(workspace_id)
        if ws is None:
            raise WorkspaceNotFoundError(
                f"Workspace '{workspace_id}' not found"
            )
        return ws

    async def list_workspaces(
        self,
        active_only: bool = True,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Workspace]:
        """List workspaces with optional active-only filter.

        Args:
            active_only: Only include active workspaces.
            pagination: Page parameters.

        Returns:
            PaginatedResult of Workspaces.
        """
        filters = QueryFilters(
            order_by="created_at",
            order_desc=True,
        )
        if active_only:
            filters.filters.append(
                FilterSpec(column="is_active", op="eq", value=True)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def update_workspace(
        self,
        workspace_id: str,
        **kwargs: str | bool | None,
    ) -> Workspace:
        """Update workspace fields.

        If updating the name, checks uniqueness first.

        Raises:
            WorkspaceNotFoundError: If not found.
            WorkspaceExistsError: If new name conflicts.
        """
        ws = await self.get_workspace(workspace_id)

        if "name" in kwargs and kwargs["name"] != ws.name:
            new_name = kwargs["name"]
            if await self.name_exists(new_name, exclude_id=workspace_id):
                raise WorkspaceExistsError(
                    f"Workspace with name '{new_name}' already exists"
                )

        return await self.update(workspace_id, **kwargs)

    async def delete_workspace(self, workspace_id: str) -> None:
        """Delete a workspace by ID.

        Raises:
            WorkspaceNotFoundError: If not found.
        """
        await self.get_workspace(workspace_id)  # validates existence
        await self.delete(workspace_id)

    async def name_exists(
        self,
        name: str,
        exclude_id: str | None = None,
    ) -> bool:
        """Check whether a workspace name is already taken.

        Args:
            name: Name to check.
            exclude_id: Optional workspace ID to exclude from check (for updates).

        Returns:
            True if name exists.
        """
        stmt = select(self.model.id).where(self.model.name == name)
        if exclude_id:
            stmt = stmt.where(self.model.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
