"""Workspace API routes — CRUD operations for workspaces."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.exceptions import WorkspaceExistsError, WorkspaceNotFoundError
from app.schemas import (
    ErrorResponse,
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.services.workspace import InMemoryWorkspaceService

router = APIRouter()

# Service instance (will be replaced with DI in production)
_service = InMemoryWorkspaceService()


@router.post(
    "",
    response_model=WorkspaceResponse,
    status_code=201,
    responses={
        409: {"model": ErrorResponse, "description": "Workspace already exists"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    summary="Create a workspace",
    description="Create a new assessment workspace.",
)
async def create_workspace(data: WorkspaceCreate) -> WorkspaceResponse:
    """Create a new workspace.

    Args:
        data: Workspace creation data.

    Returns:
        The created workspace.

    Raises:
        409: If workspace name already exists.
        422: If input validation fails.
    """
    try:
        return await _service.create(data)
    except WorkspaceExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get(
    "",
    response_model=list[WorkspaceResponse],
    summary="List workspaces",
    description="List all workspaces with optional filtering.",
)
async def list_workspaces(
    active_only: bool = Query(True, description="Only return active workspaces"),
    offset: int = Query(0, ge=0, description="Number to skip"),
    limit: int = Query(50, ge=1, le=100, description="Maximum to return"),
) -> list[WorkspaceResponse]:
    """List workspaces.

    Args:
        active_only: Only return active workspaces.
        offset: Number of workspaces to skip.
        limit: Maximum number to return.

    Returns:
        List of workspaces.
    """
    workspaces, _ = await _service.list(
        active_only=active_only, offset=offset, limit=limit
    )
    return workspaces


@router.get(
    "/{workspace_id}",
    response_model=WorkspaceResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Workspace not found"},
    },
    summary="Get a workspace",
    description="Get a workspace by its ID.",
)
async def get_workspace(workspace_id: str) -> WorkspaceResponse:
    """Get a workspace by ID.

    Args:
        workspace_id: Workspace unique identifier.

    Returns:
        The workspace.

    Raises:
        404: If workspace does not exist.
    """
    try:
        return await _service.get(workspace_id)
    except WorkspaceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch(
    "/{workspace_id}",
    response_model=WorkspaceResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Workspace not found"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    summary="Update a workspace",
    description="Update an existing workspace.",
)
async def update_workspace(
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
        404: If workspace does not exist.
    """
    try:
        return await _service.update(workspace_id, data)
    except WorkspaceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/{workspace_id}",
    status_code=204,
    responses={
        404: {"model": ErrorResponse, "description": "Workspace not found"},
    },
    summary="Delete a workspace",
    description="Delete a workspace and all its contents.",
)
async def delete_workspace(workspace_id: str) -> None:
    """Delete a workspace.

    Args:
        workspace_id: Workspace to delete.

    Raises:
        404: If workspace does not exist.
    """
    try:
        await _service.delete(workspace_id)
    except WorkspaceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
