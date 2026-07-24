"""Audit repository — database-backed audit log persistence.

Stores immutable audit trail entries for all security-relevant operations.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.logging import get_logger
from app.models import UUIDMixin
from app.services.database.base import (
    BaseRepository,
    FilterSpec,
    PaginatedResult,
    PaginationParams,
    QueryFilters,
)

logger = get_logger(__name__)


class AuditLogModel(Base, UUIDMixin):
    """SQLAlchemy model for immutable audit log entries."""

    __tablename__ = "audit_log"

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    resource_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditRepository(BaseRepository[AuditLogModel]):
    """Repository for audit log persistence and queries.

    Audit entries are append-only — no update or delete operations are
    exposed to preserve the integrity of the audit trail.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(AuditLogModel, session)

    async def log_event(
        self,
        action: str,
        user_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict[str, Any] | None = None,
        ip_address: str | None = None,
        success: bool = True,
        error_message: str | None = None,
    ) -> AuditLogModel:
        """Record an audit event.

        Args:
            action: Action identifier (e.g. 'workspace.create').
            user_id: ID of the user performing the action.
            resource_type: Type of resource affected.
            resource_id: ID of resource affected.
            details: Arbitrary context dict (stored as JSON).
            ip_address: Client IP address.
            success: Whether the action succeeded.
            error_message: Error detail when success=False.

        Returns:
            The persisted AuditLogModel entry.
        """
        details_json = json.dumps(details) if details else None

        entry = await self.create(
            action=action,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            details_json=details_json,
            ip_address=ip_address,
            success=success,
            error_message=error_message,
        )

        log_fn = logger.info if success else logger.warning
        log_fn(
            "audit.logged",
            entry_id=entry.id,
            action=action,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            success=success,
        )

        return entry

    async def get_events(
        self,
        user_id: str | None = None,
        resource_type: str | None = None,
        action: str | None = None,
        success_only: bool | None = None,
        since: datetime | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[AuditLogModel]:
        """Query audit events with flexible filtering.

        Args:
            user_id: Filter by acting user.
            resource_type: Filter by resource type.
            action: Filter by action (exact match).
            success_only: If True only successful; if False only failed; None both.
            since: Only entries after this timestamp.
            pagination: Page parameters.

        Returns:
            PaginatedResult of AuditLogModel entries.
        """
        filters = QueryFilters(
            order_by="timestamp",
            order_desc=True,
        )
        if user_id:
            filters.filters.append(
                FilterSpec(column="user_id", op="eq", value=user_id)
            )
        if resource_type:
            filters.filters.append(
                FilterSpec(column="resource_type", op="eq", value=resource_type)
            )
        if action:
            filters.filters.append(
                FilterSpec(column="action", op="eq", value=action)
            )
        if success_only is not None:
            filters.filters.append(
                FilterSpec(column="success", op="eq", value=success_only)
            )
        if since:
            filters.filters.append(
                FilterSpec(column="timestamp", op="gte", value=since)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def get_event_count(self) -> int:
        """Return total number of audit entries."""
        return await self.count()

    async def get_events_by_resource(
        self,
        resource_type: str,
        resource_id: str,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[AuditLogModel]:
        """Get the full audit trail for a specific resource.

        Args:
            resource_type: Resource type (e.g. 'assessment').
            resource_id: Resource ID.
            pagination: Page parameters.

        Returns:
            PaginatedResult ordered by timestamp descending.
        """
        filters = QueryFilters(
            filters=[
                FilterSpec(column="resource_type", op="eq", value=resource_type),
                FilterSpec(column="resource_id", op="eq", value=resource_id),
            ],
            order_by="timestamp",
            order_desc=True,
        )
        return await self.list(filters=filters, pagination=pagination)

    async def get_failed_events(
        self,
        since: datetime | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[AuditLogModel]:
        """Get all failed audit events (security monitoring)."""
        filters = QueryFilters(
            filters=[
                FilterSpec(column="success", op="eq", value=False),
            ],
            order_by="timestamp",
            order_desc=True,
        )
        if since:
            filters.filters.append(
                FilterSpec(column="timestamp", op="gte", value=since)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def get_recent_by_user(
        self,
        user_id: str,
        limit: int = 20,
    ) -> list[AuditLogModel]:
        """Get the most recent audit entries for a user."""
        result = await self.get_events(
            user_id=user_id,
            pagination=PaginationParams(page=1, page_size=limit),
        )
        return result.items

    async def purge_old_entries(
        self,
        before: datetime,
        batch_size: int = 1000,
    ) -> int:
        """Delete audit entries older than the given timestamp.

        This is the only delete operation — intended for retention policies.

        Args:
            before: Delete entries with timestamp < this value.
            batch_size: Number of rows to delete per batch.

        Returns:
            Total number of entries deleted.
        """
        from sqlalchemy import delete as sa_delete

        total_deleted = 0
        while True:
            stmt = (
                sa_delete(AuditLogModel)
                .where(AuditLogModel.timestamp < before)
                .limit(batch_size)
            )
            result = await self.session.execute(stmt)
            batch = result.rowcount
            total_deleted += batch
            await self.session.flush()
            if batch < batch_size:
                break

        logger.info(
            "audit.purge",
            deleted=total_deleted,
            before=before.isoformat(),
        )
        return total_deleted
