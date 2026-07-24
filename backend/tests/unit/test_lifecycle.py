"""Unit tests for the assessment lifecycle state machine.

Tests cover all valid transitions, invalid transitions, pause/resume,
retry, terminal states, and progress calculations.
"""

from __future__ import annotations

import pytest

from app.core.exceptions import AssessmentInvalidTransitionError
from app.models.assessment import AssessmentStatus
from app.services.assessment.lifecycle import (
    ACTIVE_STATES,
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


class TestLifecycleStateMachine:
    """Tests for the assessment lifecycle state machine."""

    def test_draft_can_transition_to_queued(self) -> None:
        """Draft → Queued is valid."""
        assert validate_transition(AssessmentStatus.DRAFT, AssessmentStatus.QUEUED)

    def test_draft_can_transition_to_cancelled(self) -> None:
        """Draft → Cancelled is valid."""
        assert validate_transition(AssessmentStatus.DRAFT, AssessmentStatus.CANCELLED)

    def test_draft_cannot_transition_to_running(self) -> None:
        """Draft → Running is invalid."""
        with pytest.raises(AssessmentInvalidTransitionError):
            validate_transition(AssessmentStatus.DRAFT, AssessmentStatus.RUNNING)

    def test_draft_cannot_transition_to_completed(self) -> None:
        """Draft → Completed is invalid."""
        with pytest.raises(AssessmentInvalidTransitionError):
            validate_transition(AssessmentStatus.DRAFT, AssessmentStatus.COMPLETED)

    def test_queued_to_preparing(self) -> None:
        """Queued → Preparing is valid."""
        assert validate_transition(AssessmentStatus.QUEUED, AssessmentStatus.PREPARING)

    def test_queued_to_cancelled(self) -> None:
        """Queued → Cancelled is valid."""
        assert validate_transition(AssessmentStatus.QUEUED, AssessmentStatus.CANCELLED)

    def test_preparing_to_running(self) -> None:
        """Preparing → Running is valid."""
        assert validate_transition(AssessmentStatus.PREPARING, AssessmentStatus.RUNNING)

    def test_preparing_to_failed(self) -> None:
        """Preparing → Failed is valid."""
        assert validate_transition(AssessmentStatus.PREPARING, AssessmentStatus.FAILED)

    def test_running_to_collecting_evidence(self) -> None:
        """Running → Collecting Evidence is valid."""
        assert validate_transition(
            AssessmentStatus.RUNNING, AssessmentStatus.COLLECTING_EVIDENCE
        )

    def test_running_to_paused(self) -> None:
        """Running → Paused is valid."""
        assert validate_transition(AssessmentStatus.RUNNING, AssessmentStatus.PAUSED)

    def test_collecting_to_normalizing(self) -> None:
        """Collecting Evidence → Normalizing Results is valid."""
        assert validate_transition(
            AssessmentStatus.COLLECTING_EVIDENCE,
            AssessmentStatus.NORMALIZING_RESULTS,
        )

    def test_normalizing_to_correlating(self) -> None:
        """Normalizing Results → Correlating is valid."""
        assert validate_transition(
            AssessmentStatus.NORMALIZING_RESULTS,
            AssessmentStatus.CORRELATING,
        )

    def test_correlating_to_generating_report(self) -> None:
        """Correlating → Generating Report is valid."""
        assert validate_transition(
            AssessmentStatus.CORRELATING,
            AssessmentStatus.GENERATING_REPORT,
        )

    def test_generating_report_to_completed(self) -> None:
        """Generating Report → Completed is valid."""
        assert validate_transition(
            AssessmentStatus.GENERATING_REPORT,
            AssessmentStatus.COMPLETED,
        )

    def test_completed_to_archived(self) -> None:
        """Completed → Archived is valid."""
        assert validate_transition(AssessmentStatus.COMPLETED, AssessmentStatus.ARCHIVED)

    def test_completed_cannot_go_back(self) -> None:
        """Completed → Running is invalid."""
        with pytest.raises(AssessmentInvalidTransitionError):
            validate_transition(AssessmentStatus.COMPLETED, AssessmentStatus.RUNNING)

    def test_paused_can_resume_to_running(self) -> None:
        """Paused → Running is valid."""
        assert validate_transition(AssessmentStatus.PAUSED, AssessmentStatus.RUNNING)

    def test_paused_can_be_cancelled(self) -> None:
        """Paused → Cancelled is valid."""
        assert validate_transition(AssessmentStatus.PAUSED, AssessmentStatus.CANCELLED)

    def test_failed_can_retry_to_queued(self) -> None:
        """Failed → Queued (retry) is valid."""
        assert validate_transition(AssessmentStatus.FAILED, AssessmentStatus.QUEUED)

    def test_failed_can_be_cancelled(self) -> None:
        """Failed → Cancelled is valid."""
        assert validate_transition(AssessmentStatus.FAILED, AssessmentStatus.CANCELLED)

    def test_archived_is_terminal(self) -> None:
        """Archived is a terminal state."""
        assert is_terminal(AssessmentStatus.ARCHIVED)
        assert TERMINAL_STATES == {AssessmentStatus.ARCHIVED, AssessmentStatus.CANCELLED}

    def test_cancelled_is_terminal(self) -> None:
        """Cancelled is a terminal state."""
        assert is_terminal(AssessmentStatus.CANCELLED)

    def test_draft_is_active(self) -> None:
        """Draft is not active."""
        assert not is_active(AssessmentStatus.DRAFT)

    def test_running_is_active(self) -> None:
        """Running is active."""
        assert is_active(AssessmentStatus.RUNNING)
        assert AssessmentStatus.RUNNING in ACTIVE_STATES

    def test_paused_is_not_active(self) -> None:
        """Paused is not active."""
        assert not is_active(AssessmentStatus.PAUSED)

    def test_can_pause_from_running(self) -> None:
        """Can pause from running."""
        assert can_pause(AssessmentStatus.RUNNING)

    def test_can_pause_from_collecting(self) -> None:
        """Can pause from collecting evidence."""
        assert can_pause(AssessmentStatus.COLLECTING_EVIDENCE)

    def test_cannot_pause_from_draft(self) -> None:
        """Cannot pause from draft."""
        assert not can_pause(AssessmentStatus.DRAFT)

    def test_can_retry_from_failed(self) -> None:
        """Can retry from failed."""
        assert can_retry(AssessmentStatus.FAILED)

    def test_cannot_retry_from_completed(self) -> None:
        """Cannot retry from completed."""
        assert not can_retry(AssessmentStatus.COMPLETED)

    def test_get_next_states_draft(self) -> None:
        """Draft has two next states."""
        states = get_next_states(AssessmentStatus.DRAFT)
        assert AssessmentStatus.QUEUED in states
        assert AssessmentStatus.CANCELLED in states

    def test_get_next_states_running(self) -> None:
        """Running has multiple next states."""
        states = get_next_states(AssessmentStatus.RUNNING)
        assert AssessmentStatus.COLLECTING_EVIDENCE in states
        assert AssessmentStatus.PAUSED in states
        assert AssessmentStatus.FAILED in states
        assert AssessmentStatus.CANCELLED in states

    def test_get_next_states_archived(self) -> None:
        """Archived has no next states."""
        states = get_next_states(AssessmentStatus.ARCHIVED)
        assert len(states) == 0

    def test_progress_percent_draft(self) -> None:
        """Draft is 0%."""
        assert get_progress_percent(AssessmentStatus.DRAFT) == 0

    def test_progress_percent_completed(self) -> None:
        """Completed is 100%."""
        assert get_progress_percent(AssessmentStatus.COMPLETED) == 100

    def test_progress_percent_paused_is_negative(self) -> None:
        """Paused has unknown progress (-1)."""
        assert get_progress_percent(AssessmentStatus.PAUSED) == -1

    def test_full_happy_path(self) -> None:
        """Full lifecycle from draft to archived."""
        transitions = [
            (AssessmentStatus.DRAFT, AssessmentStatus.QUEUED),
            (AssessmentStatus.QUEUED, AssessmentStatus.PREPARING),
            (AssessmentStatus.PREPARING, AssessmentStatus.RUNNING),
            (AssessmentStatus.RUNNING, AssessmentStatus.COLLECTING_EVIDENCE),
            (AssessmentStatus.COLLECTING_EVIDENCE, AssessmentStatus.NORMALIZING_RESULTS),
            (AssessmentStatus.NORMALIZING_RESULTS, AssessmentStatus.CORRELATING),
            (AssessmentStatus.CORRELATING, AssessmentStatus.GENERATING_REPORT),
            (AssessmentStatus.GENERATING_REPORT, AssessmentStatus.COMPLETED),
            (AssessmentStatus.COMPLETED, AssessmentStatus.ARCHIVED),
        ]
        for current, target in transitions:
            assert validate_transition(current, target), (
                f"Transition {current.value} → {target.value} should be valid"
            )
