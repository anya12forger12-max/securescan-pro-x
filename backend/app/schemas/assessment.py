"""Assessment-specific Pydantic schemas for API request/response validation.

Covers the full assessment lifecycle including jobs, targets, profiles,
policies, evidence, findings, recommendations, timeline, history,
metadata, tags, notes, attachments, logs, metrics, and reports.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Assessment Schemas ─────────────────────────────────────────────


class AssessmentCreate(BaseModel):
    """Schema for creating an assessment."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)
    priority: str = Field("normal", pattern="^(low|normal|high|critical)$")
    profile_id: Optional[str] = None
    policy_id: Optional[str] = None
    asset_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class AssessmentUpdate(BaseModel):
    """Schema for updating an assessment."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)
    priority: Optional[str] = Field(None, pattern="^(low|normal|high|critical)$")


class AssessmentResponse(BaseModel):
    """Schema for assessment responses."""

    model_config = {"from_attributes": True}

    id: str
    workspace_id: str
    name: str
    description: Optional[str] = None
    status: str
    priority: str
    version: int
    profile_id: Optional[str] = None
    policy_id: Optional[str] = None
    queued_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    target_count: int
    finding_count: int
    evidence_count: int
    progress_percent: int
    error_message: Optional[str] = None
    retry_count: int
    max_retries: int
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AssessmentTransitionResponse(BaseModel):
    """Schema for assessment transition responses."""

    assessment_id: str
    from_status: Optional[str]
    to_status: str
    progress_percent: int
    timestamp: datetime


# ── Assessment Job Schemas ─────────────────────────────────────────


class AssessmentJobCreate(BaseModel):
    """Schema for creating an assessment job."""

    plugin_id: str = Field(..., min_length=1, max_length=255)
    target_id: Optional[str] = None
    priority: int = Field(0, ge=0, le=100)
    timeout_seconds: int = Field(300, ge=1, le=86400)


class AssessmentJobResponse(BaseModel):
    """Schema for assessment job responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    plugin_id: str
    target_id: Optional[str] = None
    status: str
    priority: int
    timeout_seconds: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result_json: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int
    created_at: datetime
    updated_at: datetime


# ── Assessment Target Schemas ──────────────────────────────────────


class AssessmentTargetCreate(BaseModel):
    """Schema for creating an assessment target."""

    asset_id: str = Field(..., min_length=1)
    target_type: str = Field(..., min_length=1, max_length=100)
    config_json: Optional[str] = None


class AssessmentTargetResponse(BaseModel):
    """Schema for assessment target responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    asset_id: str
    target_type: str
    config_json: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime


# ── Assessment Profile Schemas ─────────────────────────────────────


class AssessmentProfileCreate(BaseModel):
    """Schema for creating an assessment profile."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)
    timeout_seconds: int = Field(3600, ge=0)
    concurrency_limit: int = Field(5, ge=1)
    evidence_collection: bool = True
    reporting_style: str = Field("standard", max_length=50)
    notification_rules: Optional[dict[str, Any]] = None
    plugin_ids: list[str] = Field(default_factory=list)
    policy_ids: list[str] = Field(default_factory=list)
    config: Optional[dict[str, Any]] = None


class AssessmentProfileResponse(BaseModel):
    """Schema for assessment profile responses."""

    model_config = {"from_attributes": True}

    id: str
    name: str
    description: Optional[str] = None
    is_builtin: bool
    timeout_seconds: int
    concurrency_limit: int
    evidence_collection: bool
    reporting_style: str
    created_at: datetime
    updated_at: datetime


# ── Assessment Policy Schemas ──────────────────────────────────────


class AssessmentPolicyCreate(BaseModel):
    """Schema for creating an assessment policy."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)
    max_runtime_seconds: int = Field(7200, ge=0)
    max_memory_mb: int = Field(1024, ge=0)
    max_cpu_percent: int = Field(80, ge=0, le=100)
    logging_level: str = Field("info", pattern="^(debug|info|warning|error|critical)$")
    retention_days: int = Field(90, ge=0)
    export_allowed: bool = True
    approval_required: bool = False
    evidence_storage: str = Field("local", max_length=50)
    allowed_plugin_ids: list[str] = Field(default_factory=list)
    config: Optional[dict[str, Any]] = None


class AssessmentPolicyResponse(BaseModel):
    """Schema for assessment policy responses."""

    model_config = {"from_attributes": True}

    id: str
    name: str
    description: Optional[str] = None
    is_builtin: bool
    max_runtime_seconds: int
    max_memory_mb: int
    max_cpu_percent: int
    logging_level: str
    retention_days: int
    export_allowed: bool
    approval_required: bool
    evidence_storage: str
    created_at: datetime
    updated_at: datetime


class PolicyValidationResponse(BaseModel):
    """Schema for policy validation responses."""

    is_valid: bool
    violations: list[str]


# ── Evidence Schemas ───────────────────────────────────────────────


class EvidenceCreate(BaseModel):
    """Schema for creating evidence."""

    evidence_type: str = Field(
        ...,
        pattern="^(structured_data|configuration_file|log|metadata|manual_note|screenshot|imported_report)$",
    )
    title: str = Field(..., min_length=1, max_length=512)
    content: Optional[str] = None
    source: str = Field("manual", max_length=255)
    collector: str = Field("system", max_length=255)
    classification: str = Field(
        "internal", pattern="^(public|internal|confidential|restricted)$"
    )
    finding_id: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    retention_days: int = Field(365, ge=1)


class EvidenceResponse(BaseModel):
    """Schema for evidence responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    finding_id: Optional[str] = None
    evidence_type: str
    title: str
    description: Optional[str] = None
    integrity_hash: str
    source: str
    collector: str
    classification: str
    tags: list[str] = Field(default_factory=list)
    retention_days: int
    created_at: datetime
    updated_at: datetime


class EvidenceIntegrityResponse(BaseModel):
    """Schema for evidence integrity verification responses."""

    evidence_id: str
    is_valid: bool


# ── Finding Schemas (Extended) ────────────────────────────────────


class NormalizedFindingResponse(BaseModel):
    """Schema for normalized finding responses."""

    id: str
    assessment_id: str
    title: str
    summary: Optional[str] = None
    severity: str
    confidence: float
    category: str
    status: str
    recommendation: Optional[str] = None
    references: list[str] = Field(default_factory=list)
    cvss_score: Optional[float] = None
    cwe_ids: list[str] = Field(default_factory=list)
    plugin_id: Optional[str] = None
    created_at: datetime


# ── Recommendation Schemas ────────────────────────────────────────


class RecommendationResponse(BaseModel):
    """Schema for recommendation responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    finding_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    priority: str
    effort: Optional[str] = None
    explanation: Optional[str] = None
    why_it_matters: Optional[str] = None
    suggested_actions: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)
    created_at: datetime


# ── Timeline Schemas ──────────────────────────────────────────────


class TimelineEventResponse(BaseModel):
    """Schema for timeline event responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    event_type: str
    title: str
    description: Optional[str] = None
    severity: Optional[str] = None
    actor: Optional[str] = None
    created_at: datetime


# ── History Schemas ───────────────────────────────────────────────


class HistoryEntryResponse(BaseModel):
    """Schema for history entry responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    from_status: Optional[str] = None
    to_status: str
    actor: Optional[str] = None
    reason: Optional[str] = None
    created_at: datetime


# ── Statistics Schemas ────────────────────────────────────────────


class AssessmentStatisticsResponse(BaseModel):
    """Schema for assessment statistics responses."""

    model_config = {"from_attributes": True}

    assessment_id: str
    total_findings: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    info_count: int
    total_evidence: int
    duration_seconds: Optional[float] = None
    target_count: int
    plugin_count: int
    risk_score: Optional[float] = None


# ── Report Schemas ────────────────────────────────────────────────


class ReportGenerateRequest(BaseModel):
    """Schema for report generation requests."""

    format: str = Field("json", pattern="^(json|markdown|html|csv)$")


class ReportResponse(BaseModel):
    """Schema for report responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    format: str
    title: str
    content_length: int
    integrity_hash: str
    generated_at: datetime
    generated_by: str


# ── Note Schemas ──────────────────────────────────────────────────


class AssessmentNoteCreate(BaseModel):
    """Schema for creating a note."""

    content: str = Field(..., min_length=1, max_length=8192)
    author: str = Field("Anonymous", max_length=255)
    is_pinned: bool = False


class AssessmentNoteResponse(BaseModel):
    """Schema for note responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    author: str
    content: str
    is_pinned: bool
    created_at: datetime
    updated_at: datetime


# ── Tag Schemas ──────────────────────────────────────────────────


class AssessmentTagCreate(BaseModel):
    """Schema for creating a tag."""

    tag: str = Field(..., min_length=1, max_length=100)


class AssessmentTagResponse(BaseModel):
    """Schema for tag responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    tag: str
    created_at: datetime


# ── Metadata Schemas ──────────────────────────────────────────────


class AssessmentMetadataCreate(BaseModel):
    """Schema for creating metadata."""

    key: str = Field(..., min_length=1, max_length=255)
    value: Optional[str] = None
    namespace: str = Field("default", max_length=100)


class AssessmentMetadataResponse(BaseModel):
    """Schema for metadata responses."""

    model_config = {"from_attributes": True}

    id: str
    assessment_id: str
    key: str
    value: Optional[str] = None
    namespace: str
    created_at: datetime


# ── Dashboard Schemas ─────────────────────────────────────────────


class AssessmentDashboardResponse(BaseModel):
    """Schema for assessment dashboard data."""

    total_assessments: int
    draft_count: int
    queued_count: int
    running_count: int
    completed_count: int
    failed_count: int
    cancelled_count: int
    recent_assessments: list[AssessmentResponse]
    upcoming_scheduled: list[AssessmentResponse]
    severity_breakdown: dict[str, int]
    evidence_count: int
    report_count: int


# ── Search Schemas ────────────────────────────────────────────────


class AssessmentSearchRequest(BaseModel):
    """Schema for assessment search requests."""

    query: str = Field(..., min_length=1, max_length=500)
    status: Optional[str] = None
    severity: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    limit: int = Field(50, ge=1, le=200)
    offset: int = Field(0, ge=0)


class AssessmentSearchResult(BaseModel):
    """Schema for a single search result."""

    id: str
    type: str  # assessment, finding, evidence, report
    title: str
    summary: Optional[str] = None
    relevance_score: float
    source: str


class AssessmentSearchResponse(BaseModel):
    """Schema for search responses."""

    query: str
    total_results: int
    results: list[AssessmentSearchResult]
    offset: int
    limit: int
