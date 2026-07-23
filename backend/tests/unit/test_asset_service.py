"""Unit tests for AssetService."""

from __future__ import annotations

import pytest

from app.core.exceptions import AssetExistsError, AssetNotFoundError
from app.schemas import AssetCreate, AssetUpdate
from app.services.asset import InMemoryAssetService


class TestAssetService:
    """Tests for AssetService implementation."""

    @pytest.fixture
    def service(self) -> InMemoryAssetService:
        """Create a fresh service for each test."""
        return InMemoryAssetService()

    @pytest.mark.asyncio
    async def test_create_asset_success(
        self, service: InMemoryAssetService
    ) -> None:
        """Creating an asset with valid data succeeds."""
        data = AssetCreate(
            name="Web Server",
            asset_type="host",
            identifier="192.168.1.1",
        )
        result = await service.create("ws-1", data)

        assert result.name == "Web Server"
        assert result.asset_type == "host"
        assert result.identifier == "192.168.1.1"
        assert result.workspace_id == "ws-1"

    @pytest.mark.asyncio
    async def test_create_asset_duplicate_identifier(
        self, service: InMemoryAssetService
    ) -> None:
        """Creating an asset with duplicate identifier in same workspace raises error."""
        data = AssetCreate(
            name="Server 1",
            asset_type="host",
            identifier="192.168.1.1",
        )
        await service.create("ws-1", data)

        with pytest.raises(AssetExistsError):
            await service.create("ws-1", data)

    @pytest.mark.asyncio
    async def test_create_asset_same_identifier_different_workspace(
        self, service: InMemoryAssetService
    ) -> None:
        """Same identifier in different workspaces is allowed."""
        data = AssetCreate(
            name="Server",
            asset_type="host",
            identifier="192.168.1.1",
        )
        await service.create("ws-1", data)
        result = await service.create("ws-2", data)

        assert result.workspace_id == "ws-2"

    @pytest.mark.asyncio
    async def test_get_asset_success(
        self, service: InMemoryAssetService
    ) -> None:
        """Getting an existing asset returns it."""
        data = AssetCreate(
            name="Test Asset",
            asset_type="host",
            identifier="10.0.0.1",
        )
        created = await service.create("ws-1", data)

        result = await service.get(created.id)
        assert result.name == "Test Asset"

    @pytest.mark.asyncio
    async def test_get_asset_not_found(
        self, service: InMemoryAssetService
    ) -> None:
        """Getting a nonexistent asset raises error."""
        with pytest.raises(AssetNotFoundError):
            await service.get("nonexistent-id")

    @pytest.mark.asyncio
    async def test_list_by_workspace(
        self, service: InMemoryAssetService
    ) -> None:
        """Listing assets by workspace returns correct results."""
        await service.create(
            "ws-1",
            AssetCreate(name="A1", asset_type="host", identifier="1.1.1.1"),
        )
        await service.create(
            "ws-1",
            AssetCreate(name="A2", asset_type="network", identifier="10.0.0.0/8"),
        )
        await service.create(
            "ws-2",
            AssetCreate(name="A3", asset_type="host", identifier="2.2.2.2"),
        )

        assets, total = await service.list_by_workspace("ws-1")
        assert total == 2

        assets, total = await service.list_by_workspace("ws-2")
        assert total == 1

    @pytest.mark.asyncio
    async def test_list_by_workspace_with_type_filter(
        self, service: InMemoryAssetService
    ) -> None:
        """Filtering by asset type returns correct results."""
        await service.create(
            "ws-1",
            AssetCreate(name="H1", asset_type="host", identifier="1.1.1.1"),
        )
        await service.create(
            "ws-1",
            AssetCreate(name="N1", asset_type="network", identifier="10.0.0.0/8"),
        )

        assets, total = await service.list_by_workspace(
            "ws-1", asset_type="host"
        )
        assert total == 1
        assert assets[0].name == "H1"

    @pytest.mark.asyncio
    async def test_update_asset_success(
        self, service: InMemoryAssetService
    ) -> None:
        """Updating an existing asset succeeds."""
        created = await service.create(
            "ws-1",
            AssetCreate(name="Original", asset_type="host", identifier="1.1.1.1"),
        )
        updated = await service.update(
            created.id,
            AssetUpdate(name="Updated"),
        )

        assert updated.name == "Updated"

    @pytest.mark.asyncio
    async def test_delete_asset_success(
        self, service: InMemoryAssetService
    ) -> None:
        """Deleting an existing asset succeeds."""
        created = await service.create(
            "ws-1",
            AssetCreate(name="To Delete", asset_type="host", identifier="1.1.1.1"),
        )
        await service.delete(created.id)

        with pytest.raises(AssetNotFoundError):
            await service.get(created.id)
