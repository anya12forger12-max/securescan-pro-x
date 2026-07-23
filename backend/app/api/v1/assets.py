"""Asset API routes — CRUD operations for assets within workspaces."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.exceptions import AssetExistsError, AssetNotFoundError
from app.schemas import (
    AssetCreate,
    AssetResponse,
    AssetUpdate,
    ErrorResponse,
)
from app.services.asset import InMemoryAssetService

router = APIRouter()

_service = InMemoryAssetService()


@router.post(
    "",
    response_model=AssetResponse,
    status_code=201,
    responses={
        409: {"model": ErrorResponse, "description": "Asset already exists"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    summary="Create an asset",
    description="Create a new assessable asset.",
)
async def create_asset(
    workspace_id: str = Query(..., description="Parent workspace ID"),
    data: AssetCreate = ...,
) -> AssetResponse:
    """Create a new asset.

    Args:
        workspace_id: Parent workspace ID.
        data: Asset creation data.

    Returns:
        The created asset.
    """
    try:
        return await _service.create(workspace_id, data)
    except AssetExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get(
    "",
    response_model=list[AssetResponse],
    summary="List assets",
    description="List assets in a workspace.",
)
async def list_assets(
    workspace_id: str = Query(..., description="Parent workspace ID"),
    asset_type: str | None = Query(None, description="Filter by type"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[AssetResponse]:
    """List assets in a workspace.

    Args:
        workspace_id: Parent workspace ID.
        asset_type: Filter by asset type.
        offset: Number to skip.
        limit: Maximum to return.

    Returns:
        List of assets.
    """
    assets, _ = await _service.list_by_workspace(
        workspace_id=workspace_id,
        asset_type=asset_type,
        offset=offset,
        limit=limit,
    )
    return assets


@router.get(
    "/{asset_id}",
    response_model=AssetResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Asset not found"},
    },
    summary="Get an asset",
    description="Get an asset by its ID.",
)
async def get_asset(asset_id: str) -> AssetResponse:
    """Get an asset by ID.

    Args:
        asset_id: Asset unique identifier.

    Returns:
        The asset.

    Raises:
        404: If asset does not exist.
    """
    try:
        return await _service.get(asset_id)
    except AssetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch(
    "/{asset_id}",
    response_model=AssetResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Asset not found"},
    },
    summary="Update an asset",
    description="Update an existing asset.",
)
async def update_asset(
    asset_id: str,
    data: AssetUpdate,
) -> AssetResponse:
    """Update an asset.

    Args:
        asset_id: Asset to update.
        data: Update data.

    Returns:
        The updated asset.
    """
    try:
        return await _service.update(asset_id, data)
    except AssetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/{asset_id}",
    status_code=204,
    responses={
        404: {"model": ErrorResponse, "description": "Asset not found"},
    },
    summary="Delete an asset",
    description="Delete an asset and its findings.",
)
async def delete_asset(asset_id: str) -> None:
    """Delete an asset.

    Args:
        asset_id: Asset to delete.

    Raises:
        404: If asset does not exist.
    """
    try:
        await _service.delete(asset_id)
    except AssetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
