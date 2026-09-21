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
    ALLOWED_TRANSITIONS,
    TERMINAL_STATES,
    can_pause,
    can_retry,
    get_next_states,
    get_progress_percent,
    is_active,
    is_paused,
    is_terminal,
    validate_transition,
)
from app.services.assessment.normalization import (
    NormalizedFinding,
    finding_to_dict,
    normalize_finding,
    normalize_findings_batch,
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
    # Orchestrator
    "AssessmentEvent",
    "AssessmentOrchestrator",
    # Correlation
    "CorrelationEngine",
    "CorrelationResult",
    "CorrelationRule",
    "EventBus",
    # Evidence
    "EvidenceService",
    "InMemoryEvidenceService",
    # Knowledge
    "InMemoryKnowledgeService",
    "InMemoryOrchestrator",
    # Policies
    "InMemoryPolicyService",
    # Profiles
    "InMemoryProfileService",
    # Reports
    "InMemoryReportService",
    "KnowledgeEntry",
    "KnowledgeService",
    "NoOpCorrelationEngine",
    # Normalization
    "NormalizedFinding",
    "PolicyService",
    "ProfileService",
    "ReportService",
    "build_report_data",
    "can_pause",
    "can_retry",
    "compute_evidence_hash",
    "finding_to_dict",
    "generate_csv_report",
    "generate_html_report",
    "generate_json_report",
    "generate_markdown_report",
    "get_next_states",
    "get_progress_percent",
    "is_active",
    "is_paused",
    "is_terminal",
    "normalize_finding",
    "normalize_findings_batch",
    "validate_transition",
]
