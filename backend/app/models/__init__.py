"""Database models for SecureScan Pro X.

All models use UUIDs for primary keys and include audit fields.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TimestampMixin:
    """Mixin that adds created_at and updated_at timestamps."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UUIDMixin:
    """Mixin that adds UUID primary key."""

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )


# ── Workspace ──────────────────────────────────────────────────────

class Workspace(Base, UUIDMixin, TimestampMixin):
    """A workspace groups related assessments and assets."""

    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    assets: Mapped[list["Asset"]] = relationship(
        "Asset", back_populates="workspace", cascade="all, delete-orphan"
    )
    assessments: Mapped[list["Assessment"]] = relationship(
        "Assessment", back_populates="workspace", cascade="all, delete-orphan"
    )


# ── Asset ──────────────────────────────────────────────────────────

class Asset(Base, UUIDMixin, TimestampMixin):
    """An asset represents an assessable target (host, network, etc.)."""

    __tablename__ = "assets"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    asset_type: Mapped[str] = mapped_column(
        Enum("host", "network", "web", "cloud", "container", name="asset_type"),
        nullable=False,
    )
    identifier: Mapped[str] = mapped_column(String(512), nullable=False)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="assets")
    findings: Mapped[list["Finding"]] = relationship(
        "Finding", back_populates="asset", cascade="all, delete-orphan"
    )


# ── Assessment ─────────────────────────────────────────────────────

class Assessment(Base, UUIDMixin, TimestampMixin):
    """An assessment represents a security evaluation session."""

    __tablename__ = "assessments"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Enum(
            "pending",
            "running",
            "completed",
            "failed",
            "cancelled",
            name="assessment_status",
        ),
        default="pending",
        nullable=False,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    target_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    finding_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    workspace: Mapped["Workspace"] = relationship(
        "Workspace", back_populates="assessments"
    )
    findings: Mapped[list["Finding"]] = relationship(
        "Finding", back_populates="assessment", cascade="all, delete-orphan"
    )


# ── Finding ────────────────────────────────────────────────────────

class Finding(Base, UUIDMixin, TimestampMixin):
    """A finding represents a security observation from an assessment."""

    __tablename__ = "findings"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assessments.id"), nullable=False
    )
    asset_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("assets.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(
        Enum("critical", "high", "medium", "low", "info", name="severity"),
        nullable=False,
    )
    category: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    recommendation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cvss_score: Mapped[Optional[float]] = mapped_column(nullable=True)
    cwe_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Enum("open", "confirmed", "fixed", "false_positive", name="finding_status"),
        default="open",
        nullable=False,
    )

    # Relationships
    assessment: Mapped["Assessment"] = relationship(
        "Assessment", back_populates="findings"
    )
    asset: Mapped[Optional["Asset"]] = relationship("Asset", back_populates="findings")
