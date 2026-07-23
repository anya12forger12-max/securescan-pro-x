/**
 * StatusBadge Component
 *
 * Displays severity or status with color, icon, and text.
 * Never relies on color alone — always includes icon and/or text.
 */

import React from "react";
import { clsx } from "clsx";
import type { Severity, FindingStatus, AssessmentStatus } from "../../types";

export interface StatusBadgeProps {
  status: Severity | FindingStatus | AssessmentStatus;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

const severityIcons: Record<Severity, string> = {
  critical: "⊘",
  high: "▲",
  medium: "◆",
  low: "●",
  info: "ℹ",
};

const findingStatusIcons: Record<FindingStatus, string> = {
  open: "○",
  confirmed: "◉",
  fixed: "✓",
  false_positive: "○",
};

const assessmentStatusIcons: Record<AssessmentStatus, string> = {
  pending: "○",
  running: "⟳",
  completed: "✓",
  failed: "✕",
  cancelled: "⊘",
};

function getIcon(status: string): string {
  if (status in severityIcons) return severityIcons[status as Severity];
  if (status in findingStatusIcons) return findingStatusIcons[status as FindingStatus];
  if (status in assessmentStatusIcons) return assessmentStatusIcons[status as AssessmentStatus];
  return "●";
}

function getLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({
  status,
  label,
  size = "md",
  className,
}: StatusBadgeProps): JSX.Element {
  const icon = getIcon(status);
  const displayLabel = label ?? getLabel(status);

  return (
    <span
      className={clsx(
        "status-badge",
        `status-badge--${status}`,
        `status-badge--${size}`,
        className,
      )}
      role="status"
      aria-label={`${displayLabel} status`}
    >
      <span className="status-badge__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="status-badge__label">{displayLabel}</span>
    </span>
  );
}
