"""Asset repository — database-backed asset operations.

Provides CRUD, workspace-scoped listing, and identifier uniqueness checks.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AssetExistsError, AssetNotFoundError, DatabaseError
from app.core.logging import get_logger
from app.models import Asset
from app.services.database.base import (
    BaseRepository,
    FilterSpec,
    PaginatedResult,
    PaginationParams,
    QueryFilters,
)

logger = get_logger(__name__)


class AssetRepository(BaseRepository[Asset]):
    """Repository for asset persistence and queries."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Asset, session)

    async def create_asset(
        self,
        workspace_id: str,
        name: str,
        asset_type: str,
        identifier: str,
        metadata_json: str | None = None,
    ) -> Asset:
        """Create an asset, enforcing identifier uniqueness within a workspace.

        Args:
            workspace_id: Parent workspace.
            name: Human-friendly asset name.
            asset_type: One of host, network, web, cloud, container.
            identifier: Unique identifier (IP, domain, etc.).
            metadata_json: Optional JSON metadata string.

        Returns:
            The created Asset.

        Raises:
            AssetExistsError: If identifier already exists in workspace.
        """
        if await self.identifier_exists_in_workspace(workspace_id, identifier):
            raise AssetExistsError(
                f"Asset with identifier '{identifier}' "
                f"already exists in workspace '{workspace_id}'"
            )

        return await self.create(
            workspace_id=workspace_id,
            name=name,
            asset_type=asset_type,
            identifier=identifier,
            metadata_json=metadata_json,
        )

    async def get_asset(self, asset_id: str) -> Asset:
        """Get an asset by ID.

        Raises:
            AssetNotFoundError: If not found.
        """
        asset = await self.get(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"Asset '{asset_id}' not found")
        return asset

    async def list_assets(
        self,
        workspace_id: str,
        asset_type: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[Asset]:
        """List assets within a workspace.

        Args:
            workspace_id: Parent workspace ID.
            asset_type: Optional type filter.
            pagination: Page parameters.

        Returns:
            PaginatedResult of Assets.
        """
        filters = QueryFilters(
            filters=[
                FilterSpec(column="workspace_id", op="eq", value=workspace_id),
            ],
            order_by="created_at",
            order_desc=True,
        )
        if asset_type:
            filters.filters.append(
                FilterSpec(column="asset_type", op="eq", value=asset_type)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def list_assets_by_workspace(
        self,
        workspace_id: str,
        asset_type: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[Asset], int]:
        """List assets with offset/limit style (legacy compatibility).

        Returns:
            Tuple of (list of assets, total count).
        """
        page = (offset // limit) + 1 if limit else 1
        result = await self.list_assets(
            workspace_id=workspace_id,
            asset_type=asset_type,
            pagination=PaginationParams(page=page, page_size=limit),
        )
        return result.items, result.total

    async def update_asset(
        self,
        asset_id: str,
        **kwargs: str | None,
    ) -> Asset:
        """Update asset fields.

        Raises:
            AssetNotFoundError: If not found.
            AssetExistsError: If new identifier conflicts within workspace.
        """
        asset = await self.get_asset(asset_id)

        if "identifier" in kwargs and kwargs["identifier"] != asset.identifier:
            new_id = kwargs["identifier"]
            if await self.identifier_exists_in_workspace(
                asset.workspace_id, new_id, exclude_id=asset_id
            ):
                raise AssetExistsError(
                    f"Asset with identifier '{new_id}' "
                    f"already exists in workspace '{asset.workspace_id}'"
                )

        return await self.update(asset_id, **kwargs)

    async def delete_asset(self, asset_id: str) -> None:
        """Delete an asset by ID.

        Raises:
            AssetNotFoundError: If not found.
        """
        await self.get_asset(asset_id)
        await self.delete(asset_id)

    async def count_by_workspace(self, workspace_id: str) -> int:
        """Count assets in a workspace."""
        return await self.count(
            QueryFilters(
                filters=[
                    FilterSpec(column="workspace_id", op="eq", value=workspace_id),
                ]
            )
        )

    async def identifier_exists_in_workspace(
        self,
        workspace_id: str,
        identifier: str,
        exclude_id: str | None = None,
    ) -> bool:
        """Check if an identifier is already used in a workspace.

        Args:
            workspace_id: Workspace scope.
            identifier: Identifier to check.
            exclude_id: Optional asset ID to exclude (for updates).

        Returns:
            True if identifier exists.
        """
        stmt = (
            select(self.model.id)
            .where(self.model.workspace_id == workspace_id)
            .where(self.model.identifier == identifier)
        )
        if exclude_id:
            stmt = stmt.where(self.model.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
