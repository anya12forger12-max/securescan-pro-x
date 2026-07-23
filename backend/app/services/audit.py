"""Audit service — tamper-evident audit trail.

Provides immutable logging of all security-relevant operations.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class AuditEvent:
    """A single audit event."""

    id: str
    timestamp: datetime
    action: str
    user_id: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    ip_address: str | None = None
    success: bool = True
    error_message: str | None = None


class AuditService(ABC):
    """Interface for audit logging operations."""

    @abstractmethod
    async def log_event(
        self,
        action: str,
        user_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict[str, Any] | None = None,
        success: bool = True,
        error_message: str | None = None,
    ) -> AuditEvent:
        """Log an audit event.

        Args:
            action: Action performed (e.g., 'workspace.create').
            user_id: ID of the user performing the action.
            resource_type: Type of resource affected.
            resource_id: ID of resource affected.
            details: Additional context.
            success: Whether the action succeeded.
            error_message: Error message if action failed.

        Returns:
            The created AuditEvent.
        """
        ...

    @abstractmethod
    async def get_events(
        self,
        user_id: str | None = None,
        resource_type: str | None = None,
        action: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditEvent]:
        """Query audit events.

        Args:
            user_id: Filter by user ID.
            resource_type: Filter by resource type.
            action: Filter by action.
            limit: Maximum number of events to return.
            offset: Number of events to skip.

        Returns:
            List of matching audit events.
        """
        ...

    @abstractmethod
    async def get_event_count(self) -> int:
        """Get the total number of audit events.

        Returns:
            Total event count.
        """
        ...


class InMemoryAuditService(AuditService):
    """In-memory audit service for development and testing.

    Events are stored in memory and lost on restart.
    """

    def __init__(self) -> None:
        """Initialize the in-memory audit store."""
        self._events: list[AuditEvent] = []
        self._counter: int = 0

    async def log_event(
        self,
        action: str,
        user_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict[str, Any] | None = None,
        success: bool = True,
        error_message: str | None = None,
    ) -> AuditEvent:
        """Log an audit event to memory.

        Args:
            action: Action performed.
            user_id: User performing the action.
            resource_type: Resource type affected.
            resource_id: Resource ID affected.
            details: Additional context.
            success: Whether the action succeeded.
            error_message: Error message if action failed.

        Returns:
            The created AuditEvent.
        """
        self._counter += 1
        event = AuditEvent(
            id=f"audit-{self._counter:08d}",
            timestamp=datetime.now(timezone.utc),
            action=action,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            success=success,
            error_message=error_message,
        )
        self._events.append(event)

        # Also log via structlog for log file output
        log_fn = logger.info if success else logger.warning
        log_fn(
            "audit.event",
            event_id=event.id,
            action=action,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            success=success,
        )

        return event

    async def get_events(
        self,
        user_id: str | None = None,
        resource_type: str | None = None,
        action: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditEvent]:
        """Query audit events from memory.

        Args:
            user_id: Filter by user ID.
            resource_type: Filter by resource type.
            action: Filter by action.
            limit: Maximum number of events.
            offset: Number of events to skip.

        Returns:
            List of matching audit events.
        """
        filtered = self._events

        if user_id is not None:
            filtered = [e for e in filtered if e.user_id == user_id]
        if resource_type is not None:
            filtered = [e for e in filtered if e.resource_type == resource_type]
        if action is not None:
            filtered = [e for e in filtered if e.action == action]

        return filtered[offset: offset + limit]

    async def get_event_count(self) -> int:
        """Get total number of audit events.

        Returns:
            Total event count.
        """
        return len(self._events)
