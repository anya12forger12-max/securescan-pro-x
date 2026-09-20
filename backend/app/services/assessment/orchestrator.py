"""Assessment orchestrator — coordinates the full assessment lifecycle.

The orchestrator is the central nervous system of the assessment framework.
It manages job queuing, lifecycle transitions, progress tracking, plugin
coordination, evidence collection, event publishing, retries, and failure
recovery.

This is a framework-only implementation. No actual scanning or network
probing is performed. The orchestrator works with demo data and imported
results.
"""

from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Callable

from app.core.exceptions import (
    AssessmentInvalidTransitionError,
    AssessmentNotFoundError,
    AssessmentTimeoutError,
)
from app.core.logging import get_logger
from app.models.assessment import (
    AssessmentPriority,
    AssessmentStatus,
    ReportFormat,
)
from app.services.assessment.lifecycle import (
    ACTIVE_STATES,
    TERMINAL_STATES,
    can_pause,
    can_retry,
    get_next_states,
    get_progress_percent,
    is_active,
    is_terminal,
    validate_transition,
)
from app.services.assessment.normalization import NormalizedFinding, normalize_findings_batch

logger = get_logger(__name__)


# ── Event Types ────────────────────────────────────────────────────


class AssessmentEvent:
    """A generic event published by the orchestrator."""

    def __init__(
        self,
        event_type: str,
        assessment_id: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        """Initialize an assessment event.

        Args:
            event_type: Type of the event (e.g. 'assessment.created').
            assessment_id: ID of the related assessment.
            data: Additional event data.
        """
        self.event_type = event_type
        self.assessment_id = assessment_id
        self.data = data or {}
        self.timestamp = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the event to a dictionary.

        Returns:
            Dictionary representation.
        """
        return {
            "event_type": self.event_type,
            "assessment_id": self.assessment_id,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
        }


# ── Event Bus ──────────────────────────────────────────────────────


class EventBus:
    """Simple synchronous event bus for assessment events.

    Subscribers register callbacks for specific event types.
    Events are dispatched to all matching subscribers.
    """

    def __init__(self) -> None:
        """Initialize the event bus."""
        self._subscribers: dict[str, list[Callable[[AssessmentEvent], None]]] = {}
        self._history: list[AssessmentEvent] = []

    def subscribe(
        self,
        event_type: str,
        callback: Callable[[AssessmentEvent], None],
    ) -> None:
        """Subscribe to an event type.

        Args:
            event_type: Event type to subscribe to. Use '*' for all events.
            callback: Function to call when event fires.
        """
        self._subscribers.setdefault(event_type, []).append(callback)

    def unsubscribe(
        self,
        event_type: str,
        callback: Callable[[AssessmentEvent], None],
    ) -> None:
        """Unsubscribe from an event type.

        Args:
            event_type: Event type to unsubscribe from.
            callback: The callback to remove.
        """
        subs = self._subscribers.get(event_type, [])
        if callback in subs:
            subs.remove(callback)

    def publish(self, event: AssessmentEvent) -> None:
        """Publish an event to all matching subscribers.

        Args:
            event: The event to publish.
        """
        self._history.append(event)

        # Notify type-specific subscribers
        for callback in self._subscribers.get(event.event_type, []):
            try:
                callback(event)
            except Exception as exc:
                logger.error(
                    "eventbus.subscriber_error",
                    event_type=event.event_type,
                    error=str(exc),
                )

        # Notify wildcard subscribers
        for callback in self._subscribers.get("*", []):
            try:
                callback(event)
            except Exception as exc:
                logger.error(
                    "eventbus.wildcard_error",
                    event_type=event.event_type,
                    error=str(exc),
                )

        logger.debug(
            "eventbus.published",
            event_type=event.event_type,
            assessment_id=event.assessment_id,
        )

    def get_history(
        self,
        event_type: str | None = None,
        assessment_id: str | None = None,
        limit: int = 100,
    ) -> list[AssessmentEvent]:
        """Get event history with optional filters.

        Args:
            event_type: Filter by event type.
            assessment_id: Filter by assessment ID.
            limit: Maximum events to return.

        Returns:
            List of matching events (most recent first).
        """
        events = self._history
        if event_type is not None:
            events = [e for e in events if e.event_type == event_type]
        if assessment_id is not None:
            events = [e for e in events if e.assessment_id == assessment_id]
        return list(reversed(events[-limit:]))


# ── Orchestrator Interface ─────────────────────────────────────────


class AssessmentOrchestrator(ABC):
    """Interface for assessment orchestration operations."""

    @abstractmethod
    async def create_assessment(
        self,
        workspace_id: str,
        name: str,
        description: str | None = None,
        profile_id: str | None = None,
        policy_id: str | None = None,
        asset_ids: list[str] | None = None,
        priority: str = "normal",
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a new assessment in draft state.

        Args:
            workspace_id: Parent workspace ID.
            name: Assessment name.
            description: Optional description.
            profile_id: Optional profile to apply.
            policy_id: Optional policy to enforce.
            asset_ids: Optional list of asset IDs to assess.
            priority: Assessment priority.
            tags: Optional tags.

        Returns:
            The created assessment.
        """
        ...

    @abstractmethod
    async def queue_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Move an assessment from draft to queued.

        Args:
            assessment_id: Assessment to queue.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def start_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Start executing an assessment.

        Transitions through: Queued → Preparing → Running.

        Args:
            assessment_id: Assessment to start.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def pause_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Pause a running assessment.

        Args:
            assessment_id: Assessment to pause.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def resume_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Resume a paused assessment.

        Args:
            assessment_id: Assessment to resume.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def cancel_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Cancel an assessment.

        Args:
            assessment_id: Assessment to cancel.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def retry_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Retry a failed assessment.

        Args:
            assessment_id: Assessment to retry.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def complete_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Mark an assessment as completed.

        Args:
            assessment_id: Assessment to complete.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def archive_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Archive a completed assessment.

        Args:
            assessment_id: Assessment to archive.

        Returns:
            Updated assessment.
        """
        ...

    @abstractmethod
    async def get_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Get assessment details.

        Args:
            assessment_id: Assessment ID.

        Returns:
            Assessment details.
        """
        ...

    @abstractmethod
    async def get_timeline(self, assessment_id: str) -> list[dict[str, Any]]:
        """Get the timeline of events for an assessment.

        Args:
            assessment_id: Assessment ID.

        Returns:
            List of timeline events.
        """
        ...

    @abstractmethod
    async def add_finding(
        self,
        assessment_id: str,
        finding: dict[str, Any],
    ) -> dict[str, Any]:
        """Add a normalized finding to an assessment.

        Args:
            assessment_id: Assessment ID.
            finding: Finding data (will be normalized).

        Returns:
            The created finding.
        """
        ...

    @abstractmethod
    async def add_evidence(
        self,
        assessment_id: str,
        evidence_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Add evidence to an assessment.

        Args:
            assessment_id: Assessment ID.
            evidence_data: Evidence data.

        Returns:
            The created evidence item.
        """
        ...

    @abstractmethod
    async def generate_report(
        self,
        assessment_id: str,
        format: str = "json",
    ) -> dict[str, Any]:
        """Generate a report for an assessment.

        Args:
            assessment_id: Assessment ID.
            format: Report format (json, markdown, html, csv).

        Returns:
            Report metadata including storage path.
        """
        ...

    @abstractmethod
    async def get_statistics(self, assessment_id: str) -> dict[str, Any]:
        """Get computed statistics for an assessment.

        Args:
            assessment_id: Assessment ID.

        Returns:
            Statistics dictionary.
        """
        ...

    @abstractmethod
    async def recover_interrupted(self) -> list[dict[str, Any]]:
        """Recover assessments that were interrupted (stuck in active state).

        Returns:
            List of recovered assessments.
        """
        ...


# ── In-Memory Implementation ──────────────────────────────────────


class InMemoryOrchestrator(AssessmentOrchestrator):
    """In-memory orchestrator for development and testing.

    Implements the full lifecycle using in-memory storage with event
    publishing and timeline tracking.
    """

    def __init__(self, event_bus: EventBus | None = None) -> None:
        """Initialize the orchestrator.

        Args:
            event_bus: Optional event bus for publishing events.
        """
        self._assessments: dict[str, dict[str, Any]] = {}
        self._findings: dict[str, list[dict[str, Any]]] = {}
        self._evidence: dict[str, list[dict[str, Any]]] = {}
        self._timelines: dict[str, list[dict[str, Any]]] = {}
        self._history: dict[str, list[dict[str, Any]]] = {}
        self._reports: dict[str, list[dict[str, Any]]] = {}
        self._counter: int = 0
        self._finding_counter: int = 0
        self._evidence_counter: int = 0
        self._report_counter: int = 0
        self._event_bus = event_bus or EventBus()

    def _record_timeline(
        self,
        assessment_id: str,
        event_type: str,
        title: str,
        description: str | None = None,
        severity: str | None = None,
    ) -> None:
        """Record a timeline event.

        Args:
            assessment_id: Assessment ID.
            event_type: Type of event.
            title: Event title.
            description: Optional description.
            severity: Optional severity.
        """
        event = {
            "event_type": event_type,
            "title": title,
            "description": description,
            "severity": severity,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._timelines.setdefault(assessment_id, []).append(event)

    def _record_history(
        self,
        assessment_id: str,
        from_status: str | None,
        to_status: str,
        reason: str | None = None,
    ) -> None:
        """Record a state transition history entry.

        Args:
            assessment_id: Assessment ID.
            from_status: Previous status.
            to_status: New status.
            reason: Optional reason for transition.
        """
        entry = {
            "from_status": from_status,
            "to_status": to_status,
            "reason": reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._history.setdefault(assessment_id, []).append(entry)

    def _transition(
        self,
        assessment_id: str,
        target_status: AssessmentStatus,
        reason: str | None = None,
    ) -> None:
        """Perform a state transition with validation and recording.

        Args:
            assessment_id: Assessment ID.
            target_status: Target status.
            reason: Optional reason.

        Raises:
            AssessmentInvalidTransitionError: If transition is invalid.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        current = AssessmentStatus(assessment["status"])
        validate_transition(current, target_status)

        old_status = assessment["status"]
        now = datetime.now(timezone.utc)

        assessment["status"] = target_status.value
        assessment["updated_at"] = now
        assessment["progress_percent"] = get_progress_percent(target_status)

        # Record timestamp fields
        if target_status == AssessmentStatus.QUEUED:
            assessment["queued_at"] = now
        elif target_status == AssessmentStatus.RUNNING:
            assessment["started_at"] = now
        elif target_status == AssessmentStatus.PAUSED:
            assessment["paused_at"] = now
        elif target_status == AssessmentStatus.COMPLETED:
            assessment["completed_at"] = now
        elif target_status == AssessmentStatus.ARCHIVED:
            assessment["archived_at"] = now
        elif target_status == AssessmentStatus.CANCELLED:
            assessment["cancelled_at"] = now
        elif target_status == AssessmentStatus.FAILED:
            assessment["failed_at"] = now

        self._record_history(assessment_id, old_status, target_status.value, reason)
        self._record_timeline(
            assessment_id,
            f"assessment.{target_status.value}",
            f"Status changed to {target_status.value}",
            reason,
        )
        self._event_bus.publish(
            AssessmentEvent(
                f"assessment.{target_status.value}",
                assessment_id,
                {"from": old_status, "to": target_status.value},
            )
        )

    async def create_assessment(
        self,
        workspace_id: str,
        name: str,
        description: str | None = None,
        profile_id: str | None = None,
        policy_id: str | None = None,
        asset_ids: list[str] | None = None,
        priority: str = "normal",
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a new assessment in draft state.

        Args:
            workspace_id: Parent workspace ID.
            name: Assessment name.
            description: Optional description.
            profile_id: Optional profile ID.
            policy_id: Optional policy ID.
            asset_ids: Optional asset IDs.
            priority: Assessment priority.
            tags: Optional tags.

        Returns:
            Created assessment data.
        """
        self._counter += 1
        now = datetime.now(timezone.utc)
        assessment_id = f"assess-{self._counter:08d}"

        assessment = {
            "id": assessment_id,
            "workspace_id": workspace_id,
            "name": name,
            "description": description,
            "status": AssessmentStatus.DRAFT.value,
            "priority": priority,
            "version": 1,
            "is_deleted": False,
            "profile_id": profile_id,
            "policy_id": policy_id,
            "queued_at": None,
            "started_at": None,
            "paused_at": None,
            "completed_at": None,
            "archived_at": None,
            "cancelled_at": None,
            "failed_at": None,
            "target_count": len(asset_ids or []),
            "finding_count": 0,
            "evidence_count": 0,
            "progress_percent": 0,
            "error_message": None,
            "retry_count": 0,
            "max_retries": 3,
            "tags": tags or [],
            "created_at": now,
            "updated_at": now,
        }
        self._assessments[assessment_id] = assessment
        self._findings[assessment_id] = []
        self._evidence[assessment_id] = []
        self._timelines[assessment_id] = []
        self._history[assessment_id] = []
        self._reports[assessment_id] = []

        self._record_timeline(assessment_id, "assessment.created", "Assessment created")
        self._record_history(assessment_id, None, "draft")
        self._event_bus.publish(
            AssessmentEvent("assessment.created", assessment_id, {"name": name})
        )

        logger.info(
            "orchestrator.assessment_created",
            assessment_id=assessment_id,
            workspace_id=workspace_id,
            name=name,
        )
        return dict(assessment)

    async def queue_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Queue an assessment (Draft → Queued).

        Args:
            assessment_id: Assessment to queue.

        Returns:
            Updated assessment.
        """
        self._transition(assessment_id, AssessmentStatus.QUEUED)
        return dict(self._assessments[assessment_id])

    async def start_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Start an assessment, transitioning through intermediate states.

        Args:
            assessment_id: Assessment to start.

        Returns:
            Updated assessment.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        current = AssessmentStatus(assessment["status"])

        # Transition through the pipeline states
        if current == AssessmentStatus.QUEUED:
            self._transition(assessment_id, AssessmentStatus.PREPARING)
            self._transition(assessment_id, AssessmentStatus.RUNNING)
        elif current == AssessmentStatus.PAUSED:
            # Resume from pause to running
            self._transition(assessment_id, AssessmentStatus.RUNNING)
        elif current == AssessmentStatus.DRAFT:
            self._transition(assessment_id, AssessmentStatus.QUEUED)
            self._transition(assessment_id, AssessmentStatus.PREPARING)
            self._transition(assessment_id, AssessmentStatus.RUNNING)

        # In a real system, this is where jobs would execute.
        # For now, we simulate progression through all states to completion.
        assessment = self._assessments[assessment_id]
        if assessment["status"] == AssessmentStatus.RUNNING.value:
            self._transition(assessment_id, AssessmentStatus.COLLECTING_EVIDENCE)
            self._transition(assessment_id, AssessmentStatus.NORMALIZING_RESULTS)
            self._transition(assessment_id, AssessmentStatus.CORRELATING)
            self._transition(assessment_id, AssessmentStatus.GENERATING_REPORT)
            self._transition(assessment_id, AssessmentStatus.COMPLETED)

        return dict(self._assessments[assessment_id])

    async def pause_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Pause a running assessment.

        Args:
            assessment_id: Assessment to pause.

        Returns:
            Updated assessment.
        """
        self._transition(assessment_id, AssessmentStatus.PAUSED, "User requested pause")
        return dict(self._assessments[assessment_id])

    async def resume_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Resume a paused assessment.

        Args:
            assessment_id: Assessment to resume.

        Returns:
            Updated assessment.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        # Resume to Running state
        self._transition(assessment_id, AssessmentStatus.RUNNING, "Resumed from pause")
        return dict(self._assessments[assessment_id])

    async def cancel_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Cancel an assessment.

        Args:
            assessment_id: Assessment to cancel.

        Returns:
            Updated assessment.
        """
        self._transition(
            assessment_id,
            AssessmentStatus.CANCELLED,
            "User requested cancellation",
        )
        return dict(self._assessments[assessment_id])

    async def retry_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Retry a failed assessment.

        Args:
            assessment_id: Assessment to retry.

        Returns:
            Updated assessment.

        Raises:
            AssessmentInvalidTransitionError: If assessment is not in failed state.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        if assessment["retry_count"] >= assessment["max_retries"]:
            raise AssessmentInvalidTransitionError(
                f"Assessment '{assessment_id}' has exceeded maximum retries "
                f"({assessment['max_retries']})"
            )

        assessment["retry_count"] += 1
        assessment["error_message"] = None
        self._transition(
            assessment_id,
            AssessmentStatus.QUEUED,
            f"Retry attempt {assessment['retry_count']}",
        )
        return dict(assessment)

    async def complete_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Mark an assessment as completed.

        Args:
            assessment_id: Assessment to complete.

        Returns:
            Updated assessment.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        # Transition to generating report then completed
        current = AssessmentStatus(assessment["status"])
        if current == AssessmentStatus.GENERATING_REPORT:
            self._transition(assessment_id, AssessmentStatus.COMPLETED)
        elif current == AssessmentStatus.RUNNING:
            self._transition(assessment_id, AssessmentStatus.COLLECTING_EVIDENCE)
            self._transition(assessment_id, AssessmentStatus.NORMALIZING_RESULTS)
            self._transition(assessment_id, AssessmentStatus.CORRELATING)
            self._transition(assessment_id, AssessmentStatus.GENERATING_REPORT)
            self._transition(assessment_id, AssessmentStatus.COMPLETED)

        return dict(self._assessments[assessment_id])

    async def archive_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Archive a completed assessment.

        Args:
            assessment_id: Assessment to archive.

        Returns:
            Updated assessment.
        """
        self._transition(assessment_id, AssessmentStatus.ARCHIVED)
        return dict(self._assessments[assessment_id])

    async def get_assessment(self, assessment_id: str) -> dict[str, Any]:
        """Get assessment details.

        Args:
            assessment_id: Assessment ID.

        Returns:
            Assessment data.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        assessment = self._assessments.get(assessment_id)
        if assessment is None:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )
        return dict(assessment)

    async def get_timeline(self, assessment_id: str) -> list[dict[str, Any]]:
        """Get the timeline of events for an assessment.

        Args:
            assessment_id: Assessment ID.

        Returns:
            List of timeline events.
        """
        if assessment_id not in self._assessments:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )
        return list(self._timelines.get(assessment_id, []))

    async def add_finding(
        self,
        assessment_id: str,
        finding: dict[str, Any],
    ) -> dict[str, Any]:
        """Add a normalized finding to an assessment.

        Args:
            assessment_id: Assessment ID.
            finding: Raw finding data.

        Returns:
            The created finding.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        if assessment_id not in self._assessments:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        normalized = normalize_findings_batch(
            [finding],
            plugin_id=finding.get("plugin_id", "manual"),
        )
        if not normalized:
            raise ValueError("Finding could not be normalized")

        self._finding_counter += 1
        nf = normalized[0]
        result = {
            "id": f"find-{self._finding_counter:08d}",
            "assessment_id": assessment_id,
            "title": nf.title,
            "summary": nf.summary,
            "severity": nf.severity,
            "confidence": nf.confidence,
            "category": nf.category,
            "status": nf.status,
            "recommendation": nf.recommendation,
            "references": nf.references,
            "cvss_score": nf.cvss_score,
            "cwe_ids": nf.cwe_ids,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._findings[assessment_id].append(result)

        assessment = self._assessments[assessment_id]
        assessment["finding_count"] = len(self._findings[assessment_id])

        self._record_timeline(
            assessment_id,
            "finding.added",
            f"Finding added: {nf.title}",
            severity=nf.severity,
        )

        logger.info(
            "orchestrator.finding_added",
            assessment_id=assessment_id,
            finding_id=result["id"],
            severity=nf.severity,
        )
        return result

    async def add_evidence(
        self,
        assessment_id: str,
        evidence_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Add evidence to an assessment.

        Args:
            assessment_id: Assessment ID.
            evidence_data: Evidence data.

        Returns:
            The created evidence item.

        Raises:
            AssessmentNotFoundError: If assessment does not exist.
        """
        if assessment_id not in self._assessments:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        self._evidence_counter += 1
        now = datetime.now(timezone.utc)
        result = {
            "id": f"ev-{self._evidence_counter:08d}",
            "assessment_id": assessment_id,
            "evidence_type": evidence_data.get("evidence_type", "structured_data"),
            "title": evidence_data.get("title", "Untitled"),
            "content": evidence_data.get("content"),
            "source": evidence_data.get("source", "manual"),
            "classification": evidence_data.get("classification", "internal"),
            "created_at": now.isoformat(),
        }
        self._evidence[assessment_id].append(result)

        assessment = self._assessments[assessment_id]
        assessment["evidence_count"] = len(self._evidence[assessment_id])

        self._event_bus.publish(
            AssessmentEvent("evidence.added", assessment_id, {"evidence_id": result["id"]})
        )
        return result

    async def generate_report(
        self,
        assessment_id: str,
        format: str = "json",
    ) -> dict[str, Any]:
        """Generate a report for an assessment.

        Creates a report data structure with findings, evidence, and metadata.
        No actual file I/O is performed in this in-memory implementation.

        Args:
            assessment_id: Assessment ID.
            format: Report format.

        Returns:
            Report metadata.
        """
        if assessment_id not in self._assessments:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        self._report_counter += 1
        assessment = self._assessments[assessment_id]
        findings = self._findings.get(assessment_id, [])
        evidence = self._evidence.get(assessment_id, [])

        report = {
            "id": f"report-{self._report_counter:08d}",
            "assessment_id": assessment_id,
            "format": format,
            "title": f"Report: {assessment['name']}",
            "finding_count": len(findings),
            "evidence_count": len(evidence),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._reports.setdefault(assessment_id, []).append(report)

        self._event_bus.publish(
            AssessmentEvent(
                "report.generated",
                assessment_id,
                {"report_id": report["id"], "format": format},
            )
        )

        logger.info(
            "orchestrator.report_generated",
            assessment_id=assessment_id,
            report_id=report["id"],
            format=format,
        )
        return report

    async def get_statistics(self, assessment_id: str) -> dict[str, Any]:
        """Get computed statistics for an assessment.

        Args:
            assessment_id: Assessment ID.

        Returns:
            Statistics including severity breakdown, duration, etc.
        """
        if assessment_id not in self._assessments:
            raise AssessmentNotFoundError(
                f"Assessment '{assessment_id}' not found"
            )

        assessment = self._assessments[assessment_id]
        findings = self._findings.get(assessment_id, [])
        evidence = self._evidence.get(assessment_id, [])

        severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for f in findings:
            sev = f.get("severity", "info")
            if sev in severity_counts:
                severity_counts[sev] += 1

        duration = None
        if assessment["started_at"] and assessment["completed_at"]:
            started = assessment["started_at"]
            completed = assessment["completed_at"]
            if isinstance(started, str):
                from datetime import datetime as dt
                started = dt.fromisoformat(started)
                completed = dt.fromisoformat(completed)
            duration = (completed - started).total_seconds()

        return {
            "assessment_id": assessment_id,
            "total_findings": len(findings),
            "critical_count": severity_counts["critical"],
            "high_count": severity_counts["high"],
            "medium_count": severity_counts["medium"],
            "low_count": severity_counts["low"],
            "info_count": severity_counts["info"],
            "total_evidence": len(evidence),
            "duration_seconds": duration,
            "target_count": assessment.get("target_count", 0),
            "report_count": len(self._reports.get(assessment_id, [])),
        }

    async def recover_interrupted(self) -> list[dict[str, Any]]:
        """Recover assessments stuck in active states.

        Resets active assessments back to queued for re-execution.

        Returns:
            List of recovered assessments.
        """
        recovered = []
        for aid, assessment in self._assessments.items():
            status = AssessmentStatus(assessment["status"])
            if is_active(status):
                assessment["status"] = AssessmentStatus.QUEUED.value
                assessment["queued_at"] = datetime.now(timezone.utc)
                assessment["updated_at"] = datetime.now(timezone.utc)
                assessment["error_message"] = None
                self._record_timeline(
                    aid, "assessment.recovered", "Assessment recovered from interruption"
                )
                self._event_bus.publish(
                    AssessmentEvent("assessment.recovered", aid)
                )
                recovered.append(dict(assessment))
                logger.info("orchestrator.recovered", assessment_id=aid)

        return recovered
