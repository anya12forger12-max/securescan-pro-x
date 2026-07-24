"""Assessment API routes — full lifecycle CRUD and operations.

Provides endpoints for:
- Assessment CRUD and lifecycle (create, queue, start, pause, resume, cancel, retry, archive)
- Evidence management
- Findings
- Profiles
- Policies
- Reports
- Timeline and history
- Statistics
- Search
- Dashboard
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.exceptions import (
    AssessmentInvalidTransitionError,
    AssessmentNotFoundError,
    ValidationError,
)
from app.schemas import (
    AssessmentCreate,
    AssessmentResponse,
    AssessmentUpdate,
    ErrorResponse,
)
from app.schemas.assessment import (
    AssessmentDashboardResponse,
    AssessmentNoteCreate,
    AssessmentNoteResponse,
    AssessmentSearchRequest,
    AssessmentSearchResponse,
    AssessmentSearchResult,
    AssessmentStatisticsResponse,
    AssessmentTagCreate,
    AssessmentTagResponse,
    AssessmentTargetCreate,
    AssessmentTargetResponse,
    EvidenceCreate,
    EvidenceIntegrityResponse,
    EvidenceResponse,
    HistoryEntryResponse,
    NormalizedFindingResponse,
    PolicyValidationResponse,
    ReportGenerateRequest,
    ReportResponse,
    TimelineEventResponse,
)
from app.services.assessment import (
    EventBus,
    InMemoryEvidenceService,
    InMemoryOrchestrator,
    InMemoryReportService,
    InMemoryKnowledgeService,
)

router = APIRouter()

# Shared service instances
_event_bus = EventBus()
_orchestrator = InMemoryOrchestrator(event_bus=_event_bus)
_evidence_service = InMemoryEvidenceService()
_report_service = InMemoryReportService()
_knowledge_service = InMemoryKnowledgeService()


# ── Assessment CRUD ────────────────────────────────────────────────


@router.post(
    "",
    response_model=AssessmentResponse,
    status_code=201,
    responses={422: {"model": ErrorResponse}},
    summary="Create an assessment",
    description="Create a new security assessment in draft state.",
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
    result = await _orchestrator.create_assessment(
        workspace_id=workspace_id,
        name=data.name,
        description=data.description,
        profile_id=data.profile_id,
        policy_id=data.policy_id,
        asset_ids=data.asset_ids,
        priority=data.priority,
        tags=data.tags,
    )
    return AssessmentResponse(**result)


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
    assessments = []
    for a in _orchestrator._assessments.values():
        if a["workspace_id"] == workspace_id and not a.get("is_deleted"):
            if status is None or a["status"] == status:
                assessments.append(AssessmentResponse(**a))
    return assessments[offset:offset + limit]


@router.get(
    "/dashboard",
    response_model=AssessmentDashboardResponse,
    summary="Get assessment dashboard",
    description="Get aggregated dashboard data for assessments.",
)
async def get_dashboard(
    workspace_id: str = Query(..., description="Workspace ID"),
) -> AssessmentDashboardResponse:
    """Get assessment dashboard data.

    Args:
        workspace_id: Workspace ID.

    Returns:
        Dashboard summary data.
    """
    all_items = [
        a for a in _orchestrator._assessments.values()
        if a["workspace_id"] == workspace_id and not a.get("is_deleted")
    ]

    status_counts: dict[str, int] = {}
    for a in all_items:
        s = a["status"]
        status_counts[s] = status_counts.get(s, 0) + 1

    total_findings = sum(a.get("finding_count", 0) for a in all_items)
    total_evidence = sum(a.get("evidence_count", 0) for a in all_items)

    recent = sorted(all_items, key=lambda x: x.get("updated_at", ""), reverse=True)[:10]
    upcoming = [
        a for a in all_items if a["status"] in ("queued", "draft")
    ][:5]

    return AssessmentDashboardResponse(
        total_assessments=len(all_items),
        draft_count=status_counts.get("draft", 0),
        queued_count=status_counts.get("queued", 0),
        running_count=status_counts.get("running", 0)
        + status_counts.get("preparing", 0)
        + status_counts.get("collecting_evidence", 0)
        + status_counts.get("normalizing_results", 0)
        + status_counts.get("correlating", 0)
        + status_counts.get("generating_report", 0),
        completed_count=status_counts.get("completed", 0),
        failed_count=status_counts.get("failed", 0),
        cancelled_count=status_counts.get("cancelled", 0),
        recent_assessments=[AssessmentResponse(**a) for a in recent],
        upcoming_scheduled=[AssessmentResponse(**a) for a in upcoming],
        severity_breakdown={"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0},
        evidence_count=total_evidence,
        report_count=0,
    )


@router.get(
    "/search",
    response_model=AssessmentSearchResponse,
    summary="Search assessments",
    description="Search across assessments, findings, and evidence.",
)
async def search_assessments(
    workspace_id: str = Query(..., description="Workspace ID"),
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> AssessmentSearchResponse:
    """Search assessments.

    Args:
        workspace_id: Workspace ID.
        q: Search query.
        limit: Max results.
        offset: Skip count.

    Returns:
        Search results.
    """
    results: list[AssessmentSearchResult] = []
    q_lower = q.lower()

    for a in _orchestrator._assessments.values():
        if a["workspace_id"] != workspace_id or a.get("is_deleted"):
            continue
        if q_lower in a["name"].lower() or q_lower in (a.get("description") or "").lower():
            results.append(AssessmentSearchResult(
                id=a["id"],
                type="assessment",
                title=a["name"],
                summary=a.get("description"),
                relevance_score=1.0,
                source="assessments",
            ))

    for aid, findings in _orchestrator._findings.items():
        assessment = _orchestrator._assessments.get(aid, {})
        if assessment.get("workspace_id") != workspace_id:
            continue
        for f in findings:
            if q_lower in f.get("title", "").lower():
                results.append(AssessmentSearchResult(
                    id=f["id"],
                    type="finding",
                    title=f["title"],
                    summary=f.get("summary"),
                    relevance_score=0.8,
                    source="findings",
                ))

    total = len(results)
    page = results[offset:offset + limit]

    return AssessmentSearchResponse(
        query=q,
        total_results=total,
        results=page,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/{assessment_id}",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}},
    summary="Get an assessment",
    description="Get an assessment by its ID.",
)
async def get_assessment(assessment_id: str) -> AssessmentResponse:
    """Get an assessment by ID.

    Args:
        assessment_id: Assessment ID.

    Returns:
        The assessment.

    Raises:
        404: If assessment does not exist.
    """
    try:
        result = await _orchestrator.get_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch(
    "/{assessment_id}",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}},
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
        Updated assessment.
    """
    try:
        assessment = await _orchestrator.get_assessment(assessment_id)
        update_data = data.model_dump(exclude_unset=True)
        assessment.update(update_data)
        return AssessmentResponse(**assessment)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/{assessment_id}",
    status_code=204,
    responses={404: {"model": ErrorResponse}},
    summary="Delete an assessment",
    description="Soft-delete an assessment.",
)
async def delete_assessment(assessment_id: str) -> None:
    """Delete an assessment.

    Args:
        assessment_id: Assessment to delete.

    Raises:
        404: If assessment does not exist.
    """
    try:
        assessment = await _orchestrator.get_assessment(assessment_id)
        assessment["is_deleted"] = True
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Lifecycle Transitions ──────────────────────────────────────────


@router.post(
    "/{assessment_id}/queue",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Queue an assessment",
    description="Move an assessment from draft to queued.",
)
async def queue_assessment(assessment_id: str) -> AssessmentResponse:
    """Queue an assessment for execution.

    Args:
        assessment_id: Assessment to queue.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.queue_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{assessment_id}/start",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Start an assessment",
    description="Start executing an assessment through its full lifecycle.",
)
async def start_assessment(assessment_id: str) -> AssessmentResponse:
    """Start an assessment.

    Args:
        assessment_id: Assessment to start.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.start_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{assessment_id}/pause",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Pause an assessment",
    description="Pause a running assessment.",
)
async def pause_assessment(assessment_id: str) -> AssessmentResponse:
    """Pause a running assessment.

    Args:
        assessment_id: Assessment to pause.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.pause_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{assessment_id}/resume",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Resume an assessment",
    description="Resume a paused assessment.",
)
async def resume_assessment(assessment_id: str) -> AssessmentResponse:
    """Resume a paused assessment.

    Args:
        assessment_id: Assessment to resume.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.resume_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{assessment_id}/cancel",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Cancel an assessment",
    description="Cancel an assessment.",
)
async def cancel_assessment(assessment_id: str) -> AssessmentResponse:
    """Cancel an assessment.

    Args:
        assessment_id: Assessment to cancel.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.cancel_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{assessment_id}/retry",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Retry an assessment",
    description="Retry a failed assessment.",
)
async def retry_assessment(assessment_id: str) -> AssessmentResponse:
    """Retry a failed assessment.

    Args:
        assessment_id: Assessment to retry.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.retry_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post(
    "/{assessment_id}/archive",
    response_model=AssessmentResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Archive an assessment",
    description="Archive a completed assessment.",
)
async def archive_assessment(assessment_id: str) -> AssessmentResponse:
    """Archive a completed assessment.

    Args:
        assessment_id: Assessment to archive.

    Returns:
        Updated assessment.
    """
    try:
        result = await _orchestrator.archive_assessment(assessment_id)
        return AssessmentResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AssessmentInvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))


# ── Timeline & History ─────────────────────────────────────────────


@router.get(
    "/{assessment_id}/timeline",
    response_model=list[TimelineEventResponse],
    responses={404: {"model": ErrorResponse}},
    summary="Get assessment timeline",
    description="Get the timeline of events for an assessment.",
)
async def get_timeline(assessment_id: str) -> list[TimelineEventResponse]:
    """Get assessment timeline.

    Args:
        assessment_id: Assessment ID.

    Returns:
        List of timeline events.
    """
    try:
        events = await _orchestrator.get_timeline(assessment_id)
        return [TimelineEventResponse(
            id=f"tl-{i}",
            assessment_id=assessment_id,
            event_type=e.get("event_type", ""),
            title=e.get("title", ""),
            description=e.get("description"),
            severity=e.get("severity"),
            created_at=e.get("timestamp", ""),
        ) for i, e in enumerate(events)]
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Statistics ─────────────────────────────────────────────────────


@router.get(
    "/{assessment_id}/statistics",
    response_model=AssessmentStatisticsResponse,
    responses={404: {"model": ErrorResponse}},
    summary="Get assessment statistics",
    description="Get computed statistics for an assessment.",
)
async def get_statistics(assessment_id: str) -> AssessmentStatisticsResponse:
    """Get assessment statistics.

    Args:
        assessment_id: Assessment ID.

    Returns:
        Assessment statistics.
    """
    try:
        stats = await _orchestrator.get_statistics(assessment_id)
        return AssessmentStatisticsResponse(**stats)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Findings ───────────────────────────────────────────────────────


@router.post(
    "/{assessment_id}/findings",
    response_model=NormalizedFindingResponse,
    status_code=201,
    responses={404: {"model": ErrorResponse}},
    summary="Add a finding",
    description="Add a normalized finding to an assessment.",
)
async def add_finding(
    assessment_id: str,
    data: dict,
) -> NormalizedFindingResponse:
    """Add a finding to an assessment.

    Args:
        assessment_id: Assessment ID.
        data: Finding data.

    Returns:
        Created finding.
    """
    try:
        result = await _orchestrator.add_finding(assessment_id, data)
        return NormalizedFindingResponse(**result)
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# ── Evidence ───────────────────────────────────────────────────────


@router.get(
    "/{assessment_id}/evidence",
    response_model=list[EvidenceResponse],
    responses={404: {"model": ErrorResponse}},
    summary="List evidence",
    description="List evidence items for an assessment.",
)
async def list_evidence(
    assessment_id: str,
    evidence_type: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
) -> list[EvidenceResponse]:
    """List evidence for an assessment.

    Args:
        assessment_id: Assessment ID.
        evidence_type: Filter by type.
        offset: Skip count.
        limit: Max results.

    Returns:
        List of evidence items.
    """
    items, _ = await _evidence_service.list_by_assessment(
        assessment_id=assessment_id,
        evidence_type=evidence_type,
        offset=offset,
        limit=limit,
    )
    return [EvidenceResponse(**item) for item in items]


@router.post(
    "/{assessment_id}/evidence",
    response_model=EvidenceResponse,
    status_code=201,
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    summary="Add evidence",
    description="Add an evidence item to an assessment.",
)
async def add_evidence(
    assessment_id: str,
    data: EvidenceCreate,
) -> EvidenceResponse:
    """Add evidence to an assessment.

    Args:
        assessment_id: Assessment ID.
        data: Evidence data.

    Returns:
        Created evidence.
    """
    try:
        result = await _evidence_service.add(
            assessment_id=assessment_id,
            evidence_type=data.evidence_type,
            title=data.title,
            content=data.content,
            source=data.source,
            collector=data.collector,
            classification=data.classification,
            finding_id=data.finding_id,
            tags=data.tags,
            retention_days=data.retention_days,
        )
        return EvidenceResponse(**result)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get(
    "/{assessment_id}/evidence/{evidence_id}/verify",
    response_model=EvidenceIntegrityResponse,
    responses={404: {"model": ErrorResponse}},
    summary="Verify evidence integrity",
    description="Verify the integrity hash of an evidence item.",
)
async def verify_evidence_integrity(
    assessment_id: str,
    evidence_id: str,
) -> EvidenceIntegrityResponse:
    """Verify evidence integrity.

    Args:
        assessment_id: Assessment ID.
        evidence_id: Evidence item ID.

    Returns:
        Integrity verification result.
    """
    try:
        is_valid = await _evidence_service.verify_integrity(evidence_id)
        return EvidenceIntegrityResponse(
            evidence_id=evidence_id,
            is_valid=is_valid,
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Reports ────────────────────────────────────────────────────────


@router.post(
    "/{assessment_id}/reports",
    response_model=ReportResponse,
    status_code=201,
    responses={404: {"model": ErrorResponse}},
    summary="Generate a report",
    description="Generate a report for an assessment.",
)
async def generate_report(
    assessment_id: str,
    data: ReportGenerateRequest = ReportGenerateRequest(),
) -> ReportResponse:
    """Generate a report.

    Args:
        assessment_id: Assessment ID.
        data: Report generation request.

    Returns:
        Report metadata.
    """
    try:
        assessment = await _orchestrator.get_assessment(assessment_id)
        findings = _orchestrator._findings.get(assessment_id, [])
        evidence_items = _orchestrator._evidence.get(assessment_id, [])

        report = await _report_service.generate(
            assessment_id=assessment_id,
            format=data.format,
            assessment=assessment,
            findings=findings,
            evidence=evidence_items,
        )
        return ReportResponse(**{k: v for k, v in report.items() if k != "content"})
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get(
    "/{assessment_id}/reports",
    response_model=list[ReportResponse],
    responses={404: {"model": ErrorResponse}},
    summary="List reports",
    description="List generated reports for an assessment.",
)
async def list_reports(assessment_id: str) -> list[ReportResponse]:
    """List reports for an assessment.

    Args:
        assessment_id: Assessment ID.

    Returns:
        List of report metadata.
    """
    reports = await _report_service.list_reports(assessment_id)
    return [ReportResponse(**r) for r in reports]


# ── Tags ──────────────────────────────────────────────────────────


@router.post(
    "/{assessment_id}/tags",
    response_model=AssessmentTagResponse,
    status_code=201,
    responses={404: {"model": ErrorResponse}},
    summary="Add a tag",
    description="Add a tag to an assessment.",
)
async def add_tag(
    assessment_id: str,
    data: AssessmentTagCreate,
) -> AssessmentTagResponse:
    """Add a tag to an assessment.

    Args:
        assessment_id: Assessment ID.
        data: Tag data.

    Returns:
        Created tag.
    """
    try:
        assessment = await _orchestrator.get_assessment(assessment_id)
        tags = assessment.get("tags", [])
        if data.tag not in tags:
            tags.append(data.tag)
            assessment["tags"] = tags
        return AssessmentTagResponse(
            id=f"tag-{assessment_id}-{data.tag}",
            assessment_id=assessment_id,
            tag=data.tag,
            created_at=assessment["updated_at"],
        )
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Notes ──────────────────────────────────────────────────────────


@router.post(
    "/{assessment_id}/notes",
    response_model=AssessmentNoteResponse,
    status_code=201,
    responses={404: {"model": ErrorResponse}},
    summary="Add a note",
    description="Add a note to an assessment.",
)
async def add_note(
    assessment_id: str,
    data: AssessmentNoteCreate,
) -> AssessmentNoteResponse:
    """Add a note to an assessment.

    Args:
        assessment_id: Assessment ID.
        data: Note data.

    Returns:
        Created note.
    """
    try:
        await _orchestrator.get_assessment(assessment_id)
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        return AssessmentNoteResponse(
            id=f"note-{assessment_id}-1",
            assessment_id=assessment_id,
            author=data.author,
            content=data.content,
            is_pinned=data.is_pinned,
            created_at=now,
            updated_at=now,
        )
    except AssessmentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
