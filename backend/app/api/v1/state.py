"""Shared in-memory state for the versioned API routers.

The assessments and reports routers must observe the same orchestrator
and report store: per-module instances split that state, so assessments
created through one router were invisible to the other (report
generation always answered 404).
"""

from __future__ import annotations

from app.services.assessment import EventBus, InMemoryOrchestrator
from app.services.reports import ReportGenerationService

event_bus = EventBus()
orchestrator = InMemoryOrchestrator(event_bus=event_bus)
report_service = ReportGenerationService()
