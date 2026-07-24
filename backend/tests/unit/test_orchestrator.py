"""Unit tests for the assessment orchestrator.

Tests cover the full lifecycle, event publishing, timeline tracking,
findings, evidence, reports, statistics, and recovery.
"""

from __future__ import annotations

import pytest

from app.core.exceptions import (
    AssessmentInvalidTransitionError,
    AssessmentNotFoundError,
)
from app.services.assessment.orchestrator import (
    AssessmentEvent,
    EventBus,
    InMemoryOrchestrator,
)


class TestEventBus:
    """Tests for the EventBus."""

    def test_subscribe_and_publish(self) -> None:
        """Published events reach subscribers."""
        bus = EventBus()
        received: list[AssessmentEvent] = []

        bus.subscribe("test.event", lambda e: received.append(e))
        bus.publish(AssessmentEvent("test.event", "id-1"))

        assert len(received) == 1
        assert received[0].assessment_id == "id-1"

    def test_wildcard_subscriber(self) -> None:
        """Wildcard subscribers receive all events."""
        bus = EventBus()
        received: list[AssessmentEvent] = []

        bus.subscribe("*", lambda e: received.append(e))
        bus.publish(AssessmentEvent("foo", "id-1"))
        bus.publish(AssessmentEvent("bar", "id-2"))

        assert len(received) == 2

    def test_unsubscribe(self) -> None:
        """Unsubscribed callbacks don't receive events."""
        bus = EventBus()
        received: list[AssessmentEvent] = []

        callback = lambda e: received.append(e)
        bus.subscribe("test", callback)
        bus.unsubscribe("test", callback)
        bus.publish(AssessmentEvent("test", "id-1"))

        assert len(received) == 0

    def test_event_history(self) -> None:
        """Events are stored in history."""
        bus = EventBus()
        bus.publish(AssessmentEvent("a", "id-1"))
        bus.publish(AssessmentEvent("b", "id-2"))

        history = bus.get_history()
        assert len(history) == 2

    def test_event_history_filter(self) -> None:
        """History can be filtered by event type."""
        bus = EventBus()
        bus.publish(AssessmentEvent("a", "id-1"))
        bus.publish(AssessmentEvent("b", "id-2"))
        bus.publish(AssessmentEvent("a", "id-3"))

        history = bus.get_history(event_type="a")
        assert len(history) == 2


class TestOrchestrator:
    """Tests for the InMemoryOrchestrator."""

    @pytest.fixture
    def orch(self) -> InMemoryOrchestrator:
        """Create a fresh orchestrator."""
        return InMemoryOrchestrator()

    @pytest.mark.asyncio
    async def test_create_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Creating an assessment succeeds."""
        result = await orch.create_assessment(
            workspace_id="ws-1",
            name="Test Assessment",
            description="A test",
            tags=["test"],
        )
        assert result["name"] == "Test Assessment"
        assert result["status"] == "draft"
        assert result["workspace_id"] == "ws-1"
        assert "test" in result["tags"]

    @pytest.mark.asyncio
    async def test_get_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Getting an existing assessment returns it."""
        created = await orch.create_assessment("ws-1", "Test")
        result = await orch.get_assessment(created["id"])
        assert result["name"] == "Test"

    @pytest.mark.asyncio
    async def test_get_assessment_not_found(self, orch: InMemoryOrchestrator) -> None:
        """Getting a nonexistent assessment raises error."""
        with pytest.raises(AssessmentNotFoundError):
            await orch.get_assessment("nonexistent")

    @pytest.mark.asyncio
    async def test_queue_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Queueing transitions draft → queued."""
        created = await orch.create_assessment("ws-1", "Test")
        result = await orch.queue_assessment(created["id"])
        assert result["status"] == "queued"

    @pytest.mark.asyncio
    async def test_start_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Starting an assessment runs through the full lifecycle."""
        created = await orch.create_assessment("ws-1", "Test")
        result = await orch.start_assessment(created["id"])
        assert result["status"] == "completed"
        assert result["started_at"] is not None
        assert result["completed_at"] is not None

    @pytest.mark.asyncio
    async def test_pause_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Pausing a running assessment works."""
        created = await orch.create_assessment("ws-1", "Test")
        await orch.queue_assessment(created["id"])
        await orch.start_assessment(created["id"])
        # Note: in current impl, start goes to completed (demo mode)
        # We need to test pause on a different flow
        orch2 = InMemoryOrchestrator()
        created2 = await orch2.create_assessment("ws-1", "Test2")
        await orch2.queue_assessment(created2["id"])
        # Manually set to running to test pause
        orch2._assessments[created2["id"]]["status"] = "running"
        result = await orch2.pause_assessment(created2["id"])
        assert result["status"] == "paused"

    @pytest.mark.asyncio
    async def test_cancel_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Cancelling a draft assessment works."""
        created = await orch.create_assessment("ws-1", "Test")
        result = await orch.cancel_assessment(created["id"])
        assert result["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_queued_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Cancelling a queued assessment works."""
        created = await orch.create_assessment("ws-1", "Test")
        await orch.queue_assessment(created["id"])
        result = await orch.cancel_assessment(created["id"])
        assert result["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_retry_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Retrying a failed assessment works."""
        created = await orch.create_assessment("ws-1", "Test")
        # Manually set to failed
        orch._assessments[created["id"]]["status"] = "failed"
        result = await orch.retry_assessment(created["id"])
        assert result["status"] == "queued"
        assert result["retry_count"] == 1

    @pytest.mark.asyncio
    async def test_retry_max_exceeded(self, orch: InMemoryOrchestrator) -> None:
        """Retrying beyond max retries raises error."""
        created = await orch.create_assessment("ws-1", "Test")
        orch._assessments[created["id"]]["status"] = "failed"
        orch._assessments[created["id"]]["retry_count"] = 3
        orch._assessments[created["id"]]["max_retries"] = 3

        with pytest.raises(AssessmentInvalidTransitionError):
            await orch.retry_assessment(created["id"])

    @pytest.mark.asyncio
    async def test_archive_assessment(self, orch: InMemoryOrchestrator) -> None:
        """Archiving a completed assessment works."""
        created = await orch.create_assessment("ws-1", "Test")
        # Set to completed
        orch._assessments[created["id"]]["status"] = "completed"
        result = await orch.archive_assessment(created["id"])
        assert result["status"] == "archived"

    @pytest.mark.asyncio
    async def test_timeline_tracking(self, orch: InMemoryOrchestrator) -> None:
        """Timeline events are recorded."""
        created = await orch.create_assessment("ws-1", "Test")
        await orch.queue_assessment(created["id"])

        timeline = await orch.get_timeline(created["id"])
        assert len(timeline) >= 2
        assert any("created" in e["event_type"] for e in timeline)
        assert any("queued" in e["event_type"] for e in timeline)

    @pytest.mark.asyncio
    async def test_add_finding(self, orch: InMemoryOrchestrator) -> None:
        """Adding a finding succeeds."""
        created = await orch.create_assessment("ws-1", "Test")
        finding = await orch.add_finding(created["id"], {
            "title": "Test Finding",
            "severity": "high",
            "category": "test",
            "summary": "A test finding",
        })
        assert finding["title"] == "Test Finding"
        assert finding["severity"] == "high"

        # Verify count updated
        assessment = await orch.get_assessment(created["id"])
        assert assessment["finding_count"] == 1

    @pytest.mark.asyncio
    async def test_add_evidence(self, orch: InMemoryOrchestrator) -> None:
        """Adding evidence succeeds."""
        created = await orch.create_assessment("ws-1", "Test")
        evidence = await orch.add_evidence(created["id"], {
            "title": "Test Evidence",
            "evidence_type": "structured_data",
            "source": "test",
        })
        assert evidence["title"] == "Test Evidence"
        assert evidence["evidence_type"] == "structured_data"

    @pytest.mark.asyncio
    async def test_generate_report(self, orch: InMemoryOrchestrator) -> None:
        """Generating a report succeeds."""
        created = await orch.create_assessment("ws-1", "Test")
        await orch.add_finding(created["id"], {
            "title": "Finding",
            "severity": "medium",
            "category": "test",
        })
        report = await orch.generate_report(created["id"], format="json")
        assert report["format"] == "json"
        assert report["finding_count"] == 1

    @pytest.mark.asyncio
    async def test_statistics(self, orch: InMemoryOrchestrator) -> None:
        """Statistics are computed correctly."""
        created = await orch.create_assessment("ws-1", "Test")
        await orch.add_finding(created["id"], {
            "title": "Critical",
            "severity": "critical",
            "category": "test",
        })
        await orch.add_finding(created["id"], {
            "title": "Low",
            "severity": "low",
            "category": "test",
        })
        await orch.add_evidence(created["id"], {"title": "Ev1"})

        stats = await orch.get_statistics(created["id"])
        assert stats["total_findings"] == 2
        assert stats["critical_count"] == 1
        assert stats["low_count"] == 1
        assert stats["total_evidence"] == 1

    @pytest.mark.asyncio
    async def test_recover_interrupted(self, orch: InMemoryOrchestrator) -> None:
        """Recovering interrupted assessments resets them."""
        created = await orch.create_assessment("ws-1", "Test")
        # Manually set to running (stuck)
        orch._assessments[created["id"]]["status"] = "running"

        recovered = await orch.recover_interrupted()
        assert len(recovered) == 1
        assert recovered[0]["status"] == "queued"

    @pytest.mark.asyncio
    async def test_events_published(self, orch: InMemoryOrchestrator) -> None:
        """Events are published during lifecycle."""
        bus = orch._event_bus
        events: list[AssessmentEvent] = []
        bus.subscribe("*", lambda e: events.append(e))

        created = await orch.create_assessment("ws-1", "Test")
        assert any(e.event_type == "assessment.created" for e in events)

    @pytest.mark.asyncio
    async def test_invalid_transition_raises(self, orch: InMemoryOrchestrator) -> None:
        """Invalid transitions raise AssessmentInvalidTransitionError."""
        from app.models.assessment import AssessmentStatus

        created = await orch.create_assessment("ws-1", "Test")
        # Try to start directly (draft → running is invalid)
        with pytest.raises(AssessmentInvalidTransitionError):
            orch._transition(created["id"], AssessmentStatus.RUNNING)

    @pytest.mark.asyncio
    async def test_full_lifecycle(self, orch: InMemoryOrchestrator) -> None:
        """Full lifecycle: create → queue → start → complete."""
        from app.models.assessment import AssessmentStatus

        created = await orch.create_assessment("ws-1", "Full Lifecycle")
        assessment_id = created["id"]

        # Queue
        result = await orch.queue_assessment(assessment_id)
        assert result["status"] == "queued"

        # Start (goes through full pipeline to completed in demo mode)
        result = await orch.start_assessment(assessment_id)
        assert result["status"] == "completed"
        assert result["started_at"] is not None
        assert result["completed_at"] is not None

        # Archive
        result = await orch.archive_assessment(assessment_id)
        assert result["status"] == "archived"

    @pytest.mark.asyncio
    async def test_history_entries(self, orch: InMemoryOrchestrator) -> None:
        """State transition history is recorded."""
        created = await orch.create_assessment("ws-1", "History Test")
        await orch.queue_assessment(created["id"])

        history = orch._history.get(created["id"], [])
        assert len(history) >= 2
        # First entry: None → draft
        assert history[0]["from_status"] is None
        assert history[0]["to_status"] == "draft"
        # Second entry: draft → queued
        assert history[1]["from_status"] == "draft"
        assert history[1]["to_status"] == "queued"
