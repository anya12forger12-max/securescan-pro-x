"""Database-backed service implementations for SecureScan Pro X.

Provides SQLAlchemy async repositories implementing the repository pattern
with full CRUD, pagination, filtering, and transaction management.
"""

from __future__ import annotations

from app.services.database.assessment_repo import AssessmentRepository
from app.services.database.asset_repo import AssetRepository
from app.services.database.audit_repo import AuditRepository
from app.services.database.base import BaseRepository
from app.services.database.finding_repo import FindingRepository
from app.services.database.user_repo import UserRepository
from app.services.database.workspace_repo import WorkspaceRepository

__all__ = [
    "AssessmentRepository",
    "AssetRepository",
    "AuditRepository",
    "BaseRepository",
    "FindingRepository",
    "UserRepository",
    "WorkspaceRepository",
]
