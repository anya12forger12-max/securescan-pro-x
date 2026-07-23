"""Asset service — manages assessable targets within workspaces.

Assets represent targets that can be assessed (hosts, networks, etc.).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.exceptions import AssetExistsError, AssetNotFoundError
from app.core.logging import get_logger
from app.schemas import AssetCreate, AssetUpdate, AssetResponse

logger = get_logger(__name__)


class AssetService(ABC):
    """Interface for asset management operations."""

    @abstractmethod
    async def create(
        self,
        workspace_id: str,
        data: AssetCreate,
    ) -> AssetResponse:
        """Create a new asset in a workspace.

        Args:
            workspace_id: Parent workspace ID.
            data: Asset creation data.

        Returns:
            The created asset.

        Raises:
            AssetExistsError: If identifier already exists in workspace.
        """
        ...

    @abstractmethod
    async def get(self, asset_id: str) -> AssetResponse:
        """Get an asset by ID.

        Args:
            asset_id: Unique asset identifier.

        Returns:
            The asset.

        Raises:
            AssetNotFoundError: If asset does not exist.
        """
        ...

    @abstractmethod
    async def list_by_workspace(
        self,
        workspace_id: str,
        asset_type: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[AssetResponse], int]:
        """List assets in a workspace.

        Args:
            workspace_id: Parent workspace ID.
            asset_type: Filter by asset type.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of assets, total count).
        """
        ...

    @abstractmethod
    async def update(
        self,
        asset_id: str,
        data: AssetUpdate,
    ) -> AssetResponse:
        """Update an asset.

        Args:
            asset_id: Asset to update.
            data: Update data.

        Returns:
            The updated asset.

        Raises:
            AssetNotFoundError: If asset does not exist.
        """
        ...

    @abstractmethod
    async def delete(self, asset_id: str) -> None:
        """Delete an asset.

        Args:
            asset_id: Asset to delete.

        Raises:
            AssetNotFoundError: If asset does not exist.
        """
        ...


class InMemoryAssetService(AssetService):
    """In-memory asset service for development and testing."""

    def __init__(self) -> None:
        """Initialize the in-memory store."""
        self._assets: dict[str, dict] = {}
        self._counter: int = 0

    async def create(
        self,
        workspace_id: str,
        data: AssetCreate,
    ) -> AssetResponse:
        """Create a new asset in memory.

        Args:
            workspace_id: Parent workspace ID.
            data: Asset creation data.

        Returns:
            The created asset.

        Raises:
            AssetExistsError: If identifier already exists in workspace.
        """
        # Check for duplicate identifier in same workspace
        for asset in self._assets.values():
            if (
                asset["workspace_id"] == workspace_id
                and asset["identifier"] == data.identifier
            ):
                raise AssetExistsError(
                    f"Asset with identifier '{data.identifier}' "
                    f"already exists in workspace"
                )

        self._counter += 1
        now = datetime.now(timezone.utc)
        asset_id = f"asset-{self._counter:08d}"

        asset = {
            "id": asset_id,
            "workspace_id": workspace_id,
            "name": data.name,
            "asset_type": data.asset_type,
            "identifier": data.identifier,
            "metadata": data.metadata,
            "created_at": now,
            "updated_at": now,
        }
        self._assets[asset_id] = asset

        logger.info(
            "asset.created",
            asset_id=asset_id,
            workspace_id=workspace_id,
            name=data.name,
        )

        return AssetResponse(**asset)

    async def get(self, asset_id: str) -> AssetResponse:
        """Get an asset by ID.

        Args:
            asset_id: Unique asset identifier.

        Returns:
            The asset.

        Raises:
            AssetNotFoundError: If asset does not exist.
        """
        asset = self._assets.get(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"Asset '{asset_id}' not found")
        return AssetResponse(**asset)

    async def list_by_workspace(
        self,
        workspace_id: str,
        asset_type: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[AssetResponse], int]:
        """List assets in a workspace from memory.

        Args:
            workspace_id: Parent workspace ID.
            asset_type: Filter by asset type.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of assets, total count).
        """
        all_assets = [
            a for a in self._assets.values()
            if a["workspace_id"] == workspace_id
        ]

        if asset_type is not None:
            all_assets = [a for a in all_assets if a["asset_type"] == asset_type]

        total = len(all_assets)
        page = all_assets[offset: offset + limit]

        return (
            [AssetResponse(**a) for a in page],
            total,
        )

    async def update(
        self,
        asset_id: str,
        data: AssetUpdate,
    ) -> AssetResponse:
        """Update an asset in memory.

        Args:
            asset_id: Asset to update.
            data: Update data.

        Returns:
            The updated asset.

        Raises:
            AssetNotFoundError: If asset does not exist.
        """
        asset = self._assets.get(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"Asset '{asset_id}' not found")

        update_data = data.model_dump(exclude_unset=True)
        asset.update(update_data)
        asset["updated_at"] = datetime.now(timezone.utc)

        logger.info(
            "asset.updated",
            asset_id=asset_id,
            fields=list(update_data.keys()),
        )

        return AssetResponse(**asset)

    async def delete(self, asset_id: str) -> None:
        """Delete an asset from memory.

        Args:
            asset_id: Asset to delete.

        Raises:
            AssetNotFoundError: If asset does not exist.
        """
        if asset_id not in self._assets:
            raise AssetNotFoundError(f"Asset '{asset_id}' not found")

        del self._assets[asset_id]
        logger.info("asset.deleted", asset_id=asset_id)
