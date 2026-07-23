"""Assessment API routes — CRUD and lifecycle operations for assessments."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.exceptions import AssessmentNotFoundError
from app.schemas import (
    AssessmentCreate,
    AssessmentResponse,
    AssessmentUpdate,
    ErrorResponse,
)
from app.services.assessment import InMemoryAssessmentService

router = APIRouter()

_service = InMemoryAssessmentService()


@router.post(
    "",
    response_model=AssessmentResponse,
    status_code=201,
    responses={
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    summary="Create an assessment",
    description="Create a new security assessment.",
)
async def create_assessment(
    workspace_id: str = Query(..., description="Parent workspace ID"),
    data: AssessmentCreate = ...,
) -> AssessmentResponse:
    """Create a new assessment.

    Args:
        workspace_id: Parent workspace ID.
        data: Assessment creation data.

    Returns:
        The created assessment.
    """
    return await _service.create(workspace_id, data)


@router.get(
    "",
    response_model=list[AssessmentResponse],
    summary="List assessments",
    description="List assessments in a workspace.",
)
async def list_assessments(
    workspace_id: str = Query(..., description="Parent workspace ID"),
    status: str | None = Query(None, description="Filter by status"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[AssessmentResponse]:
    """List assessments in a workspace.

    Args:
        workspace_id: Parent workspace ID.
        status: Filter by status.
        offset: Number to skip.
        limit: Maximum to return.

    Returns:
        List of assessments.
    """
    assessments, _ = await _service.list_by_workspace(
        workspace_id=workspace_id,
        status=status,
        offset=offset,
        limit=limit,
    )
    return assessments


@router.get(
    "/{assessment_id}",
    response_model=AssessmentResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Assessment not found"},
    },
    summary="Get an assessment",
    description="Get an assessment by its ID.",
)
async def get_assessment(assessment_id: str) -> AssessmentResponse:
    """Get an assessment by ID.

    Args:
        assessment_id: Assessment unique identifier.

    Returns:
        The assessment.

    Raises:
        404: If assessment does not exist.
    """
    try:
        return await _service.get(assessment_id)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/{assessment_id}/start",
    response_model=AssessmentResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Assessment not found"},
    },
    summary="Start an assessment",
    description="Start executing an assessment. (Phase 1A: stub implementation)",
)
async def start_assessment(assessment_id: str) -> AssessmentResponse:
    """Start an assessment.

    TODO (Phase 2): Implement actual check execution.

    Args:
        assessment_id: Assessment to start.

    Returns:
        Updated assessment.

    Raises:
        404: If assessment does not exist.
    """
    try:
        return await _service.start(assessment_id)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/{assessment_id}/cancel",
    response_model=AssessmentResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Assessment not found"},
    },
    summary="Cancel an assessment",
    description="Cancel a running assessment.",
)
async def cancel_assessment(assessment_id: str) -> AssessmentResponse:
    """Cancel a running assessment.

    Args:
        assessment_id: Assessment to cancel.

    Returns:
        Updated assessment.

    Raises:
        404: If assessment does not exist.
    """
    try:
        return await _service.cancel(assessment_id)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch(
    "/{assessment_id}",
    response_model=AssessmentResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Assessment not found"},
    },
    summary="Update an assessment",
    description="Update an existing assessment.",
)
async def update_assessment(
    assessment_id: str,
    data: AssessmentUpdate,
) -> AssessmentResponse:
    """Update an assessment.

    Args:
        assessment_id: Assessment to update.
        data: Update data.

    Returns:
        The updated assessment.
    """
    try:
        return await _service.update(assessment_id, data)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/{assessment_id}",
    status_code=204,
    responses={
        404: {"model": ErrorResponse, "description": "Assessment not found"},
    },
    summary="Delete an assessment",
    description="Delete an assessment and its findings.",
)
async def delete_assessment(assessment_id: str) -> None:
    """Delete an assessment.

    Args:
        assessment_id: Assessment to delete.

    Raises:
        404: If assessment does not exist.
    """
    try:
        await _service.delete(assessment_id)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
