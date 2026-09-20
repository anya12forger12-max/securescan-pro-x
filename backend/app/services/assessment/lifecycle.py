"""Assessment lifecycle state machine.

Implements a deterministic state machine governing assessment transitions.
Each transition is validated, logged, and audited. Invalid transitions raise
`AssessmentInvalidTransitionError`.

State Flow:
    Draft → Queued → Preparing → Running → Collecting Evidence →
    Normalizing Results → Correlating → Generating Report → Completed → Archived

Pause/Resume supported from Running through Generating Report.
Cancel supported from all non-terminal states.
Retry supported from Failed state.
"""

from __future__ import annotations

from app.core.exceptions import AssessmentInvalidTransitionError
from app.core.logging import get_logger
from app.models.assessment import AssessmentStatus

logger = get_logger(__name__)

# ── Allowed Transitions ────────────────────────────────────────────

# Maps current status → set of allowed next statuses.
# This is the single source of truth for the assessment lifecycle.
ALLOWED_TRANSITIONS: dict[AssessmentStatus, set[AssessmentStatus]] = {
    AssessmentStatus.DRAFT: {
        AssessmentStatus.QUEUED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.QUEUED: {
        AssessmentStatus.PREPARING,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.PREPARING: {
        AssessmentStatus.RUNNING,
        AssessmentStatus.FAILED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.RUNNING: {
        AssessmentStatus.COLLECTING_EVIDENCE,
        AssessmentStatus.PAUSED,
        AssessmentStatus.FAILED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.COLLECTING_EVIDENCE: {
        AssessmentStatus.NORMALIZING_RESULTS,
        AssessmentStatus.PAUSED,
        AssessmentStatus.FAILED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.NORMALIZING_RESULTS: {
        AssessmentStatus.CORRELATING,
        AssessmentStatus.PAUSED,
        AssessmentStatus.FAILED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.CORRELATING: {
        AssessmentStatus.GENERATING_REPORT,
        AssessmentStatus.PAUSED,
        AssessmentStatus.FAILED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.GENERATING_REPORT: {
        AssessmentStatus.COMPLETED,
        AssessmentStatus.PAUSED,
        AssessmentStatus.FAILED,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.COMPLETED: {
        AssessmentStatus.ARCHIVED,
    },
    AssessmentStatus.PAUSED: {
        AssessmentStatus.RUNNING,
        AssessmentStatus.COLLECTING_EVIDENCE,
        AssessmentStatus.NORMALIZING_RESULTS,
        AssessmentStatus.CORRELATING,
        AssessmentStatus.GENERATING_REPORT,
        AssessmentStatus.CANCELLED,
    },
    AssessmentStatus.FAILED: {
        AssessmentStatus.QUEUED,  # retry
        AssessmentStatus.CANCELLED,
    },
    # Terminal states — no transitions out (except Completed → Archived above)
    AssessmentStatus.ARCHIVED: set(),
    AssessmentStatus.CANCELLED: set(),
}

# ── Terminal States ────────────────────────────────────────────────

TERMINAL_STATES: set[AssessmentStatus] = {
    AssessmentStatus.ARCHIVED,
    AssessmentStatus.CANCELLED,
}

# ── Pause-able States ─────────────────────────────────────────────

PAUSEABLE_STATES: set[AssessmentStatus] = {
    AssessmentStatus.RUNNING,
    AssessmentStatus.COLLECTING_EVIDENCE,
    AssessmentStatus.NORMALIZING_RESULTS,
    AssessmentStatus.CORRELATING,
    AssessmentStatus.GENERATING_REPORT,
}

# ── Resumable States (where the machine was paused) ────────────────

RESUMABLE_STATES: set[AssessmentStatus] = {
    AssessmentStatus.RUNNING,
    AssessmentStatus.COLLECTING_EVIDENCE,
    AssessmentStatus.NORMALIZING_RESULTS,
    AssessmentStatus.CORRELATING,
    AssessmentStatus.GENERATING_REPORT,
}

# ── Active States (assessment is actively processing) ──────────────

ACTIVE_STATES: set[AssessmentStatus] = {
    AssessmentStatus.PREPARING,
    AssessmentStatus.RUNNING,
    AssessmentStatus.COLLECTING_EVIDENCE,
    AssessmentStatus.NORMALIZING_RESULTS,
    AssessmentStatus.CORRELATING,
    AssessmentStatus.GENERATING_REPORT,
}


def validate_transition(
    current: AssessmentStatus,
    target: AssessmentStatus,
) -> bool:
    """Validate that a state transition is allowed.

    Args:
        current: The current assessment status.
        target: The desired target status.

    Returns:
        True if the transition is valid.

    Raises:
        AssessmentInvalidTransitionError: If the transition is not allowed.
    """
    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise AssessmentInvalidTransitionError(
            f"Cannot transition from '{current.value}' to '{target.value}'. "
            f"Allowed transitions: {sorted(s.value for s in allowed)}"
        )
    return True


def get_next_states(current: AssessmentStatus) -> list[AssessmentStatus]:
    """Get all possible next states from the current state.

    Args:
        current: The current assessment status.

    Returns:
        List of allowed next statuses.
    """
    return sorted(ALLOWED_TRANSITIONS.get(current, set()), key=lambda s: s.value)


def is_terminal(status: AssessmentStatus) -> bool:
    """Check if a status is terminal (no further transitions possible).

    Args:
        status: The status to check.

    Returns:
        True if the status is terminal.
    """
    return status in TERMINAL_STATES


def is_active(status: AssessmentStatus) -> bool:
    """Check if an assessment is actively processing.

    Args:
        status: The status to check.

    Returns:
        True if the assessment is active.
    """
    return status in ACTIVE_STATES


def is_paused(status: AssessmentStatus) -> bool:
    """Check if an assessment is paused.

    Args:
        status: The status to check.

    Returns:
        True if the status is paused.
    """
    return status == AssessmentStatus.PAUSED


def can_pause(status: AssessmentStatus) -> bool:
    """Check if an assessment can be paused from the given state.

    Args:
        status: The current status.

    Returns:
        True if the assessment can be paused.
    """
    return status in PAUSEABLE_STATES


def can_retry(status: AssessmentStatus) -> bool:
    """Check if a failed assessment can be retried.

    Args:
        status: The current status.

    Returns:
        True if the assessment can be retried.
    """
    return status == AssessmentStatus.FAILED


def get_progress_percent(status: AssessmentStatus) -> int:
    """Map a status to an approximate progress percentage.

    Args:
        status: The current status.

    Returns:
        Progress percentage (0-100).
    """
    progress_map = {
        AssessmentStatus.DRAFT: 0,
        AssessmentStatus.QUEUED: 5,
        AssessmentStatus.PREPARING: 10,
        AssessmentStatus.RUNNING: 20,
        AssessmentStatus.COLLECTING_EVIDENCE: 50,
        AssessmentStatus.NORMALIZING_RESULTS: 70,
        AssessmentStatus.CORRELATING: 80,
        AssessmentStatus.GENERATING_REPORT: 90,
        AssessmentStatus.COMPLETED: 100,
        AssessmentStatus.ARCHIVED: 100,
        AssessmentStatus.PAUSED: -1,  # unknown, depends on where paused
        AssessmentStatus.FAILED: -1,
        AssessmentStatus.CANCELLED: -1,
    }
    return progress_map.get(status, 0)
