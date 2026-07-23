"""Pydantic schemas for API request/response validation."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Base Schemas ───────────────────────────────────────────────────

class BaseSchema(BaseModel):
    """Base schema with common configuration."""

    model_config = {"from_attributes": True}


class IDMixin(BaseSchema):
    """Mixin that adds id and timestamps."""

    id: str
    created_at: datetime
    updated_at: datetime


# ── Workspace Schemas ──────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    """Schema for creating a workspace."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)


class WorkspaceUpdate(BaseModel):
    """Schema for updating a workspace."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)
    is_active: Optional[bool] = None


class WorkspaceResponse(IDMixin):
    """Schema for workspace responses."""

    name: str
    description: Optional[str] = None
    is_active: bool


# ── Asset Schemas ──────────────────────────────────────────────────

class AssetCreate(BaseModel):
    """Schema for creating an asset."""

    name: str = Field(..., min_length=1, max_length=255)
    asset_type: str = Field(..., pattern="^(host|network|web|cloud|container)$")
    identifier: str = Field(..., min_length=1, max_length=512)
    metadata: Optional[dict[str, Any]] = None


class AssetUpdate(BaseModel):
    """Schema for updating an asset."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    identifier: Optional[str] = Field(None, min_length=1, max_length=512)
    metadata: Optional[dict[str, Any]] = None


class AssetResponse(IDMixin):
    """Schema for asset responses."""

    workspace_id: str
    name: str
    asset_type: str
    identifier: str
    metadata: Optional[dict[str, Any]] = None


# ── Assessment Schemas ─────────────────────────────────────────────

class AssessmentCreate(BaseModel):
    """Schema for creating an assessment."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)
    asset_ids: list[str] = Field(default_factory=list)


class AssessmentUpdate(BaseModel):
    """Schema for updating an assessment."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=4096)


class AssessmentResponse(IDMixin):
    """Schema for assessment responses."""

    workspace_id: str
    name: str
    description: Optional[str] = None
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    target_count: int
    finding_count: int


# ── Finding Schemas ────────────────────────────────────────────────

class FindingCreate(BaseModel):
    """Schema for creating a finding."""

    title: str = Field(..., min_length=1, max_length=512)
    description: Optional[str] = None
    severity: str = Field(..., pattern="^(critical|high|medium|low|info)$")
    category: Optional[str] = Field(None, max_length=255)
    recommendation: Optional[str] = None
    evidence: Optional[str] = None
    cvss_score: Optional[float] = Field(None, ge=0.0, le=10.0)
    cwe_ids: Optional[list[str]] = None


class FindingUpdate(BaseModel):
    """Schema for updating a finding."""

    status: Optional[str] = Field(None, pattern="^(open|confirmed|fixed|false_positive)$")
    recommendation: Optional[str] = None


class FindingResponse(IDMixin):
    """Schema for finding responses."""

    assessment_id: str
    asset_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    severity: str
    category: Optional[str] = None
    recommendation: Optional[str] = None
    evidence: Optional[str] = None
    cvss_score: Optional[float] = None
    cwe_ids: Optional[list[str]] = None
    status: str


# ── Pagination ─────────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    """Generic paginated response."""

    items: list[Any]
    total: int
    page: int
    page_size: int
    pages: int


# ── Health ─────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "healthy"
    version: str
    database: str = "connected"
    uptime: float


# ── Error ──────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    """Error response."""

    error: str
    detail: Optional[str] = None
    code: Optional[str] = None
