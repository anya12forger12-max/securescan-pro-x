"""Initial database migration — create all tables.

Revision ID: 001_initial
Revises: None
Create Date: 2026-01-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all application tables."""

    # Workspaces
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), unique=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # Assets
    op.create_table(
        "assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "asset_type",
            sa.Enum("host", "network", "web", "cloud", "container", name="asset_type"),
            nullable=False,
        ),
        sa.Column("identifier", sa.String(512), nullable=False),
        sa.Column("metadata_json", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_assets_workspace_id", "assets", ["workspace_id"])

    # Assessments
    op.create_table(
        "assessments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "running", "completed", "failed", "cancelled",
                name="assessment_status",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("target_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("finding_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_assessments_workspace_id", "assessments", ["workspace_id"])

    # Findings
    op.create_table(
        "findings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "assessment_id",
            sa.String(36),
            sa.ForeignKey("assessments.id"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            sa.String(36),
            sa.ForeignKey("assets.id"),
            nullable=True,
        ),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "severity",
            sa.Enum("critical", "high", "medium", "low", "info", name="severity"),
            nullable=False,
        ),
        sa.Column("category", sa.String(255), nullable=True),
        sa.Column("recommendation", sa.Text, nullable=True),
        sa.Column("evidence", sa.Text, nullable=True),
        sa.Column("cvss_score", sa.Float, nullable=True),
        sa.Column("cwe_ids", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.Enum("open", "confirmed", "fixed", "false_positive", name="finding_status"),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_findings_assessment_id", "findings", ["assessment_id"])
    op.create_index("ix_findings_asset_id", "findings", ["asset_id"])
    op.create_index("ix_findings_severity", "findings", ["severity"])


def downgrade() -> None:
    """Drop all application tables."""
    op.drop_table("findings")
    op.drop_table("assessments")
    op.drop_table("assets")
    op.drop_table("workspaces")

    op.drop_type("finding_status")
    op.drop_type("severity")
    op.drop_type("assessment_status")
    op.drop_type("asset_type")
