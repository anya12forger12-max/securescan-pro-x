"""Assessment framework migration — create assessment domain tables.

Revision ID: 002_assessment_framework
Revises: 001_initial
Create Date: 2026-07-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_assessment_framework"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create assessment framework tables."""

    # Assessment Profiles
    op.create_table(
        "assessment_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), unique=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_builtin", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("timeout_seconds", sa.Integer, nullable=False, server_default=sa.text("3600")),
        sa.Column("concurrency_limit", sa.Integer, nullable=False, server_default=sa.text("5")),
        sa.Column("evidence_collection", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("reporting_style", sa.String(50), nullable=False, server_default="standard"),
        sa.Column("notification_rules_json", sa.Text, nullable=True),
        sa.Column("plugin_ids_json", sa.Text, nullable=True),
        sa.Column("policy_ids_json", sa.Text, nullable=True),
        sa.Column("config_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Policies
    op.create_table(
        "assessment_policies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), unique=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_builtin", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("max_runtime_seconds", sa.Integer, nullable=False, server_default=sa.text("7200")),
        sa.Column("max_memory_mb", sa.Integer, nullable=False, server_default=sa.text("1024")),
        sa.Column("max_cpu_percent", sa.Integer, nullable=False, server_default=sa.text("80")),
        sa.Column("logging_level", sa.String(20), nullable=False, server_default="info"),
        sa.Column("retention_days", sa.Integer, nullable=False, server_default=sa.text("90")),
        sa.Column("export_allowed", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("approval_required", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("evidence_storage", sa.String(50), nullable=False, server_default="local"),
        sa.Column("allowed_plugin_ids_json", sa.Text, nullable=True),
        sa.Column("config_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessments v2 (extended)
    op.create_table(
        "assessments_v2",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("version", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("profile_id", sa.String(36), sa.ForeignKey("assessment_profiles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("policy_id", sa.String(36), sa.ForeignKey("assessment_policies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("target_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("finding_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("evidence_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("progress_percent", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("max_retries", sa.Integer, nullable=False, server_default=sa.text("3")),
        sa.Column("config_snapshot", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assessments_v2_workspace_id", "assessments_v2", ["workspace_id"])
    op.create_index("ix_assessments_v2_status", "assessments_v2", ["status"])

    # Assessment Jobs
    op.create_table(
        "assessment_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plugin_id", sa.String(255), nullable=False),
        sa.Column("target_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("priority", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("timeout_seconds", sa.Integer, nullable=False, server_default=sa.text("300")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_json", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assessment_jobs_assessment_id", "assessment_jobs", ["assessment_id"])

    # Assessment Targets
    op.create_table(
        "assessment_targets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(100), nullable=False),
        sa.Column("config_json", sa.Text, nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assessment_targets_assessment_id", "assessment_targets", ["assessment_id"])

    # Evidence
    op.create_table(
        "evidence",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("finding_id", sa.String(36), sa.ForeignKey("findings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("evidence_type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("integrity_hash", sa.String(128), nullable=False),
        sa.Column("source", sa.String(255), nullable=False),
        sa.Column("collector", sa.String(255), nullable=False),
        sa.Column("classification", sa.String(50), nullable=False, server_default="internal"),
        sa.Column("tags_json", sa.Text, nullable=True),
        sa.Column("retention_days", sa.Integer, nullable=False, server_default=sa.text("365")),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_evidence_assessment_id", "evidence", ["assessment_id"])

    # Recommendations
    op.create_table(
        "recommendations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("finding_id", sa.String(36), sa.ForeignKey("findings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("effort", sa.String(100), nullable=True),
        sa.Column("explanation", sa.Text, nullable=True),
        sa.Column("why_it_matters", sa.Text, nullable=True),
        sa.Column("suggested_actions_json", sa.Text, nullable=True),
        sa.Column("references_json", sa.Text, nullable=True),
        sa.Column("verification_notes", sa.Text, nullable=True),
        sa.Column("learning_resources_json", sa.Text, nullable=True),
        sa.Column("glossary_links_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Timeline Events
    op.create_table(
        "assessment_timeline_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("severity", sa.String(50), nullable=True),
        sa.Column("actor", sa.String(255), nullable=True),
        sa.Column("metadata_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment History
    op.create_table(
        "assessment_history",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(50), nullable=True),
        sa.Column("to_status", sa.String(50), nullable=False),
        sa.Column("actor", sa.String(255), nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("metadata_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Metadata
    op.create_table(
        "assessment_metadata",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.Text, nullable=True),
        sa.Column("namespace", sa.String(100), nullable=False, server_default="default"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Tags
    op.create_table(
        "assessment_tags",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Notes
    op.create_table(
        "assessment_notes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("is_pinned", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Attachments
    op.create_table(
        "assessment_attachments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column("integrity_hash", sa.String(128), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Logs
    op.create_table(
        "assessment_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.String(20), nullable=False),
        sa.Column("source", sa.String(255), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("details_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Metrics
    op.create_table(
        "assessment_metrics",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric_name", sa.String(255), nullable=False),
        sa.Column("metric_value", sa.Float, nullable=False),
        sa.Column("unit", sa.String(50), nullable=True),
        sa.Column("tags_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Reports
    op.create_table(
        "assessment_reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("format", sa.String(50), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("integrity_hash", sa.String(128), nullable=False),
        sa.Column("generated_by", sa.String(255), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Assessment Statistics
    op.create_table(
        "assessment_statistics",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("assessment_id", sa.String(36), sa.ForeignKey("assessments_v2.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("total_findings", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("critical_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("high_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("medium_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("low_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("info_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("total_evidence", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("duration_seconds", sa.Float, nullable=True),
        sa.Column("plugin_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("target_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("risk_score", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    """Drop assessment framework tables."""
    op.drop_table("assessment_statistics")
    op.drop_table("assessment_reports")
    op.drop_table("assessment_metrics")
    op.drop_table("assessment_logs")
    op.drop_table("assessment_attachments")
    op.drop_table("assessment_notes")
    op.drop_table("assessment_tags")
    op.drop_table("assessment_metadata")
    op.drop_table("assessment_history")
    op.drop_table("assessment_timeline_events")
    op.drop_table("recommendations")
    op.drop_table("evidence")
    op.drop_table("assessment_targets")
    op.drop_table("assessment_jobs")
    op.drop_index("ix_assessments_v2_status", "assessments_v2")
    op.drop_index("ix_assessments_v2_workspace_id", "assessments_v2")
    op.drop_table("assessments_v2")
    op.drop_table("assessment_policies")
    op.drop_table("assessment_profiles")
