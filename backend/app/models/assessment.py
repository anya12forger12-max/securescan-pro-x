"""Assessment domain models — comprehensive assessment data structures.

Provides SQLAlchemy models for the full assessment lifecycle including jobs,
targets, profiles, policies, results, timeline, history, metadata, statistics,
tags, notes, attachments, logs, and metrics.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models import TimestampMixin, UUIDMixin


# ── Enums ──────────────────────────────────────────────────────────


class AssessmentStatus(str, PyEnum):
    """Full assessment lifecycle states."""

    DRAFT = "draft"
    QUEUED = "queued"
    PREPARING = "preparing"
    RUNNING = "running"
    COLLECTING_EVIDENCE = "collecting_evidence"
    NORMALIZING_RESULTS = "normalizing_results"
    CORRELATING = "correlating"
    GENERATING_REPORT = "generating_report"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    FAILED = "failed"


class EvidenceType(str, PyEnum):
    """Types of evidence that can be collected."""

    STRUCTURED_DATA = "structured_data"
    CONFIGURATION_FILE = "configuration_file"
    LOG = "log"
    METADATA = "metadata"
    MANUAL_NOTE = "manual_note"
    SCREENSHOT = "screenshot"
    IMPORTED_REPORT = "imported_report"


class EvidenceClassification(str, PyEnum):
    """Evidence sensitivity classification."""

    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


class AssessmentPriority(str, PyEnum):
    """Assessment priority levels."""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class ReportFormat(str, PyEnum):
    """Supported report output formats."""

    HTML = "html"
    PDF = "pdf"
    MARKDOWN = "markdown"
    JSON = "json"
    CSV = "csv"


# ── Assessment ─────────────────────────────────────────────────────


class Assessment(Base, UUIDMixin, TimestampMixin):
    """Assessment — the core entity representing a security evaluation session.

    Tracks the complete lifecycle from draft through completion with full
    audit trail, evidence references, and result summaries.
    """

    __tablename__ = "assessments_v2"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Enum(AssessmentStatus, native_enum=False),
        default=AssessmentStatus.DRAFT.value,
        nullable=False,
    )
    priority: Mapped[str] = mapped_column(
        Enum(AssessmentPriority, native_enum=False),
        default=AssessmentPriority.NORMAL.value,
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Profile and policy references
    profile_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("assessment_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    policy_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("assessment_policies.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Lifecycle timestamps
    queued_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paused_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Counters
    target_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    finding_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Error tracking
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    # Configuration snapshot
    config_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    workspace: Mapped["Workspace"] = relationship(
        "Workspace", back_populates="assessments"
    )
    profile: Mapped[Optional["AssessmentProfile"]] = relationship(
        "AssessmentProfile", back_populates="assessments"
    )
    policy: Mapped[Optional["AssessmentPolicy"]] = relationship(
        "AssessmentPolicy", back_populates="assessments"
    )
    jobs: Mapped[list["AssessmentJob"]] = relationship(
        "AssessmentJob", back_populates="assessment", cascade="all, delete-orphan"
    )
    targets: Mapped[list["AssessmentTarget"]] = relationship(
        "AssessmentTarget", back_populates="assessment", cascade="all, delete-orphan"
    )
    evidence_items: Mapped[list["Evidence"]] = relationship(
        "Evidence", back_populates="assessment", cascade="all, delete-orphan"
    )
    findings: Mapped[list["Finding"]] = relationship(
        "Finding", back_populates="assessment", cascade="all, delete-orphan"
    )
    recommendations: Mapped[list["Recommendation"]] = relationship(
        "Recommendation", back_populates="assessment", cascade="all, delete-orphan"
    )
    timeline_events: Mapped[list["AssessmentTimelineEvent"]] = relationship(
        "AssessmentTimelineEvent",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )
    history_entries: Mapped[list["AssessmentHistory"]] = relationship(
        "AssessmentHistory",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )
    metadata_entries: Mapped[list["AssessmentMetadata"]] = relationship(
        "AssessmentMetadata",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )
    tags: Mapped[list["AssessmentTag"]] = relationship(
        "AssessmentTag", back_populates="assessment", cascade="all, delete-orphan"
    )
    notes: Mapped[list["AssessmentNote"]] = relationship(
        "AssessmentNote", back_populates="assessment", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["AssessmentAttachment"]] = relationship(
        "AssessmentAttachment",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )
    log_entries: Mapped[list["AssessmentLog"]] = relationship(
        "AssessmentLog", back_populates="assessment", cascade="all, delete-orphan"
    )
    metrics: Mapped[list["AssessmentMetric"]] = relationship(
        "AssessmentMetric", back_populates="assessment", cascade="all, delete-orphan"
    )
    reports: Mapped[list["AssessmentReport"]] = relationship(
        "AssessmentReport", back_populates="assessment", cascade="all, delete-orphan"
    )


# ── Assessment Job ─────────────────────────────────────────────────


class AssessmentJob(Base, UUIDMixin, TimestampMixin):
    """A discrete unit of work within an assessment.

    Jobs are created by the orchestrator and executed by the scheduler.
    Each job represents a single check or evidence collection task.
    """

    __tablename__ = "assessment_jobs"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    plugin_id: Mapped[str] = mapped_column(String(255), nullable=False)
    target_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("assessment_targets.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        Enum(AssessmentStatus, native_enum=False),
        default=AssessmentStatus.DRAFT.value,
        nullable=False,
    )
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    result_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="jobs"
    )
    target: Mapped[Optional["AssessmentTarget"]] = relationship(
        "AssessmentTarget", back_populates="jobs"
    )


# ── Assessment Target ──────────────────────────────────────────────


class AssessmentTarget(Base, UUIDMixin, TimestampMixin):
    """A specific target being assessed within an assessment.

    Links an assessment to one or more assets with additional context
    about how the target should be evaluated.
    """

    __tablename__ = "assessment_targets"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(100), nullable=False)
    config_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Enum(AssessmentStatus, native_enum=False),
        default=AssessmentStatus.DRAFT.value,
        nullable=False,
    )

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="targets"
    )
    jobs: Mapped[list["AssessmentJob"]] = relationship(
        "AssessmentJob", back_populates="target"
    )


# ── Assessment Profile ─────────────────────────────────────────────


class AssessmentProfile(Base, UUIDMixin, TimestampMixin):
    """Reusable assessment profile defining execution parameters.

    Profiles encode common assessment patterns such as quick reviews,
    baseline audits, and compliance checks.
    """

    __tablename__ = "assessment_profiles"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=3600, nullable=False)
    concurrency_limit: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    evidence_collection: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    reporting_style: Mapped[str] = mapped_column(
        String(50), default="standard", nullable=False
    )
    notification_rules_json: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    plugin_ids_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    policy_ids_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessments: Mapped[list["Assessment"]] = relationship(
        "Assessment", back_populates="profile"
    )


# ── Assessment Policy ──────────────────────────────────────────────


class AssessmentPolicy(Base, UUIDMixin, TimestampMixin):
    """Policy controlling assessment governance.

    Policies enforce rules around runtime limits, resource usage,
    retention, export controls, and approval workflows.
    """

    __tablename__ = "assessment_policies"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    max_runtime_seconds: Mapped[int] = mapped_column(
        Integer, default=7200, nullable=False
    )
    max_memory_mb: Mapped[int] = mapped_column(Integer, default=1024, nullable=False)
    max_cpu_percent: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    logging_level: Mapped[str] = mapped_column(
        String(20), default="info", nullable=False
    )
    retention_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    export_allowed: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    approval_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    evidence_storage: Mapped[str] = mapped_column(
        String(50), default="local", nullable=False
    )
    allowed_plugin_ids_json: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    config_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessments: Mapped[list["Assessment"]] = relationship(
        "Assessment", back_populates="policy"
    )


# ── Evidence ───────────────────────────────────────────────────────


class Evidence(Base, UUIDMixin, TimestampMixin):
    """Evidence collected during an assessment.

    Each evidence item carries an integrity hash, classification,
    source metadata, and retention policy.
    """

    __tablename__ = "evidence"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    finding_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("findings.id", ondelete="SET NULL"), nullable=True
    )
    evidence_type: Mapped[str] = mapped_column(
        Enum(EvidenceType, native_enum=False), nullable=False
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    integrity_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    collector: Mapped[str] = mapped_column(String(255), nullable=False)
    classification: Mapped[str] = mapped_column(
        Enum(EvidenceClassification, native_enum=False),
        default=EvidenceClassification.INTERNAL.value,
        nullable=False,
    )
    tags_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retention_days: Mapped[int] = mapped_column(Integer, default=365, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="evidence_items"
    )
    finding: Mapped[Optional["Finding"]] = relationship("Finding")


# ── Recommendation ────────────────────────────────────────────────


class Recommendation(Base, UUIDMixin, TimestampMixin):
    """A remediation recommendation linked to an assessment.

    Recommendations provide actionable guidance derived from findings.
    """

    __tablename__ = "recommendations"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    finding_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("findings.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(
        Enum(AssessmentPriority, native_enum=False),
        default=AssessmentPriority.NORMAL.value,
        nullable=False,
    )
    effort: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    why_it_matters: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    suggested_actions_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    references_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    verification_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    learning_resources_json: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    glossary_links_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="recommendations"
    )
    finding: Mapped[Optional["Finding"]] = relationship("Finding")


# ── Assessment Timeline Event ──────────────────────────────────────


class AssessmentTimelineEvent(Base, UUIDMixin, TimestampMixin):
    """An event in the assessment timeline for audit and visualization."""

    __tablename__ = "assessment_timeline_events"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    actor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="timeline_events"
    )


# ── Assessment History ─────────────────────────────────────────────


class AssessmentHistory(Base, UUIDMixin, TimestampMixin):
    """Immutable history of state transitions for an assessment."""

    __tablename__ = "assessment_history"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)
    actor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="history_entries"
    )


# ── Assessment Metadata ────────────────────────────────────────────


class AssessmentMetadata(Base, UUIDMixin, TimestampMixin):
    """Key-value metadata attached to an assessment."""

    __tablename__ = "assessment_metadata"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    namespace: Mapped[str] = mapped_column(String(100), default="default", nullable=False)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="metadata_entries"
    )


# ── Assessment Tag ────────────────────────────────────────────────


class AssessmentTag(Base, UUIDMixin, TimestampMixin):
    """A tag attached to an assessment for categorization."""

    __tablename__ = "assessment_tags"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    tag: Mapped[str] = mapped_column(String(100), nullable=False)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="tags"
    )


# ── Assessment Note ────────────────────────────────────────────────


class AssessmentNote(Base, UUIDMixin, TimestampMixin):
    """A user-authored note attached to an assessment."""

    __tablename__ = "assessment_notes"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    author: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="notes"
    )


# ── Assessment Attachment ──────────────────────────────────────────


class AssessmentAttachment(Base, UUIDMixin, TimestampMixin):
    """A file attachment linked to an assessment."""

    __tablename__ = "assessment_attachments"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    integrity_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="attachments"
    )


# ── Assessment Log ─────────────────────────────────────────────────


class AssessmentLog(Base, UUIDMixin, TimestampMixin):
    """A structured log entry for an assessment."""

    __tablename__ = "assessment_logs"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="log_entries"
    )


# ── Assessment Metric ──────────────────────────────────────────────


class AssessmentMetric(Base, UUIDMixin, TimestampMixin):
    """A time-series metric recorded during assessment execution."""

    __tablename__ = "assessment_metrics"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    metric_name: Mapped[str] = mapped_column(String(255), nullable=False)
    metric_value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tags_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="metrics"
    )


# ── Assessment Report ──────────────────────────────────────────────


class AssessmentReport(Base, UUIDMixin, TimestampMixin):
    """A generated report for an assessment."""

    __tablename__ = "assessment_reports"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False,
    )
    format: Mapped[str] = mapped_column(
        Enum(ReportFormat, native_enum=False), nullable=False
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    integrity_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    generated_by: Mapped[str] = mapped_column(String(255), default="system", nullable=False)

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="reports"
    )


# ── Assessment Statistics (materialized summary) ───────────────────


class AssessmentStatistics(Base, UUIDMixin, TimestampMixin):
    """Cached statistics for an assessment, updated on completion."""

    __tablename__ = "assessment_statistics"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments_v2.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    total_findings: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    critical_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    high_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    medium_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    low_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    info_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_evidence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    plugin_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    target_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    risk_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
