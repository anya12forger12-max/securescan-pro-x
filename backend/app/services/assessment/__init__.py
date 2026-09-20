"""Assessment service — orchestrates security assessments.

Manages the lifecycle of assessments: plan → execute → collect → analyze.

Phase 2A: Full orchestrator with lifecycle state machine, evidence pipeline,
result normalization, profiles, policies, and report generation.
"""

from __future__ import annotations

from app.services.assessment.correlation import (
    CorrelationEngine,
    CorrelationResult,
    CorrelationRule,
    NoOpCorrelationEngine,
)
from app.services.assessment.evidence import (
    EvidenceService,
    InMemoryEvidenceService,
    compute_evidence_hash,
)
from app.services.assessment.knowledge import (
    InMemoryKnowledgeService,
    KnowledgeEntry,
    KnowledgeService,
)
from app.services.assessment.lifecycle import (
    ACTIVE_STATES,
    TERMINAL_STATES,
    ALLOWED_TRANSITIONS,
    get_next_states,
    get_progress_percent,
    is_active,
    is_paused,
    is_terminal,
    can_pause,
    can_retry,
    validate_transition,
)
from app.services.assessment.normalization import (
    NormalizedFinding,
    normalize_finding,
    normalize_findings_batch,
    finding_to_dict,
)
from app.services.assessment.orchestrator import (
    AssessmentEvent,
    AssessmentOrchestrator,
    EventBus,
    InMemoryOrchestrator,
)
from app.services.assessment.policies import (
    InMemoryPolicyService,
    PolicyService,
)
from app.services.assessment.profiles import (
    InMemoryProfileService,
    ProfileService,
)
from app.services.assessment.reports import (
    InMemoryReportService,
    ReportService,
    build_report_data,
    generate_csv_report,
    generate_html_report,
    generate_json_report,
    generate_markdown_report,
)

__all__ = [
    # Lifecycle
    "ACTIVE_STATES",
    "ALLOWED_TRANSITIONS",
    "TERMINAL_STATES",
    "get_next_states",
    "get_progress_percent",
    "is_active",
    "is_paused",
    "is_terminal",
    "can_pause",
    "can_retry",
    "validate_transition",
    # Orchestrator
    "AssessmentEvent",
    "AssessmentOrchestrator",
    "EventBus",
    "InMemoryOrchestrator",
    # Evidence
    "EvidenceService",
    "InMemoryEvidenceService",
    "compute_evidence_hash",
    # Normalization
    "NormalizedFinding",
    "finding_to_dict",
    "normalize_finding",
    "normalize_findings_batch",
    # Profiles
    "InMemoryProfileService",
    "ProfileService",
    # Policies
    "InMemoryPolicyService",
    "PolicyService",
    # Reports
    "InMemoryReportService",
    "ReportService",
    "build_report_data",
    "generate_csv_report",
    "generate_html_report",
    "generate_json_report",
    "generate_markdown_report",
    # Correlation
    "CorrelationEngine",
    "CorrelationResult",
    "CorrelationRule",
    "NoOpCorrelationEngine",
    # Knowledge
    "InMemoryKnowledgeService",
    "KnowledgeEntry",
    "KnowledgeService",
]
