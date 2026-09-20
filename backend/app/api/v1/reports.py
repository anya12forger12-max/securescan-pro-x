"""Reports API routes — standalone report generation, listing, and download.

Provides endpoints for:
- Generating reports for assessments in multiple formats
- Listing all reports across assessments
- Retrieving individual reports with metadata
- Downloading report content with integrity verification
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.core.exceptions import AssessmentNotFoundError
from app.schemas import ErrorResponse
from app.services.assessment import InMemoryOrchestrator, EventBus
from app.services.assessment.reports import build_report_data
from app.services.reports import (
    ReportGenerationService,
    ReportMetadata,
)

router = APIRouter()

# Shared service instances
_event_bus = EventBus()
_orchestrator = InMemoryOrchestrator(event_bus=_event_bus)
_report_service = ReportGenerationService()


# ── Request Schemas ───────────────────────────────────────────────

from pydantic import BaseModel, Field


class GenerateReportRequest(BaseModel):
    """Schema for report generation requests."""

    assessment_id: str = Field(..., description="Assessment ID to generate report for")
    format: str = Field(
        "html",
        pattern="^(html|json|markdown|csv)$",
        description="Output format",
    )


class ReportDetailResponse(BaseModel):
    """Schema for report detail responses."""

    id: str
    assessment_id: str
    format: str
    title: str
    content_length: int
    integrity_hash: str
    generated_at: str
    generated_by: str


# ── Endpoints ─────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[ReportDetailResponse],
    summary="List all reports",
    description="List all generated reports across all assessments.",
)
async def list_reports(
    assessment_id: str | None = Query(None, description="Filter by assessment ID"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[ReportDetailResponse]:
    """List all reports.

    Args:
        assessment_id: Optional assessment ID to filter by.
        offset: Number to skip.
        limit: Maximum number to return.

    Returns:
        List of report metadata.
    """
    reports = _report_service.list_reports(assessment_id=assessment_id)
    page = reports[offset : offset + limit]
    return [ReportDetailResponse(**r) for r in page]


@router.post(
    "/generate",
    response_model=ReportDetailResponse,
    status_code=201,
    responses={
        404: {"model": ErrorResponse, "description": "Assessment not found"},
        422: {"model": ErrorResponse, "description": "Invalid format or data"},
    },
    summary="Generate a report",
    description="Generate a new report for an assessment in the specified format.",
)
async def generate_report(
    data: GenerateReportRequest,
) -> ReportDetailResponse:
    """Generate a report for an assessment.

    Creates a new report in the requested format with SHA-256 integrity hash.
    Supported formats: html, json, markdown, csv.

    Args:
        data: Report generation request with assessment ID and format.

    Returns:
        Report metadata (without content).

    Raises:
        404: If the assessment does not exist.
        422: If the format is invalid.
    """
    try:
        assessment = await _orchestrator.get_assessment(data.assessment_id)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    findings = _orchestrator._findings.get(data.assessment_id, [])
    evidence_items = _orchestrator._evidence.get(data.assessment_id, [])

    try:
        metadata = _report_service.generate(
            assessment_id=data.assessment_id,
            format=data.format,
            assessment=assessment,
            findings=findings,
            evidence=evidence_items,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return ReportDetailResponse(**metadata.to_dict())


@router.get(
    "/{report_id}",
    response_model=ReportDetailResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Report not found"},
    },
    summary="Get a report",
    description="Get report metadata by report ID.",
)
async def get_report(report_id: str) -> ReportDetailResponse:
    """Get report metadata by ID.

    Args:
        report_id: Report unique identifier.

    Returns:
        Report metadata.

    Raises:
        404: If the report does not exist.
    """
    metadata = _report_service.get_report(report_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found")

    return ReportDetailResponse(**metadata.to_dict())


@router.get(
    "/{report_id}/download",
    summary="Download report content",
    description="Download the full report content with appropriate content type.",
    responses={
        200: {"description": "Report content"},
        404: {"model": ErrorResponse, "description": "Report not found"},
    },
)
async def download_report(report_id: str):
    """Download report content.

    Returns the report content with the appropriate content type:
    - HTML: text/html
    - JSON: application/json
    - Markdown: text/markdown
    - CSV: text/csv

    Also includes integrity hash verification in response headers.

    Args:
        report_id: Report unique identifier.

    Returns:
        Report content with appropriate MIME type.

    Raises:
        404: If the report does not exist.
    """
    metadata = _report_service.get_report(report_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found")

    content = _report_service.get_report_content(report_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Report content not found")

    is_valid = _report_service.verify_integrity(report_id)

    headers = {
        "X-Report-ID": report_id,
        "X-Integrity-Hash": metadata.integrity_hash,
        "X-Integrity-Valid": str(is_valid).lower(),
        "Content-Disposition": f'attachment; filename="{report_id}.{metadata.format}"',
    }

    content_types = {
        "html": HTMLResponse,
        "json": PlainTextResponse,
        "markdown": PlainTextResponse,
        "csv": PlainTextResponse,
    }

    media_types = {
        "html": "text/html",
        "json": "application/json",
        "markdown": "text/markdown",
        "csv": "text/csv",
    }

    response_class = content_types.get(metadata.format, PlainTextResponse)
    media_type = media_types.get(metadata.format, "text/plain")

    return response_class(
        content=content,
        headers=headers,
        media_type=media_type,
    )


@router.get(
    "/{report_id}/verify",
    summary="Verify report integrity",
    description="Verify the SHA-256 integrity hash of a report.",
    responses={
        404: {"model": ErrorResponse, "description": "Report not found"},
    },
)
async def verify_report_integrity(report_id: str) -> dict:
    """Verify report content integrity.

    Computes SHA-256 hash of the stored content and compares it with
    the hash recorded at generation time.

    Args:
        report_id: Report unique identifier.

    Returns:
        Dictionary with verification result.

    Raises:
        404: If the report does not exist.
    """
    is_valid = _report_service.verify_integrity(report_id)
    if is_valid is None:
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found")

    metadata = _report_service.get_report(report_id)

    return {
        "report_id": report_id,
        "integrity_valid": is_valid,
        "stored_hash": metadata.integrity_hash if metadata else None,
    }
