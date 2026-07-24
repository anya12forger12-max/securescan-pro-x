/**
 * Utility UI Components — Spinner, EmptyState, Toast, Progress, etc.
 */
import React, { useEffect } from "react";
import { clsx } from "clsx";
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon, InfoIcon } from "../icons";

// ── Loading Spinner ───────────────────────────────────────────

export function LoadingSpinner({
  size = "md",
  label = "Loading...",
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
}): JSX.Element {
  return (
    <div className={clsx("spinner", `spinner--${size}`)} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state" role="status">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3 className="empty-state__title">{title}</h3>
      {description && <p className="empty-state__description">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

// ── Toast Notifications ───────────────────────────────────────

interface ToastProps {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  onClose: () => void;
  autoClose?: number;
}

const toastIcons = {
  success: <CheckCircleIcon size={18} />,
  error: <XCircleIcon size={18} />,
  warning: <AlertTriangleIcon size={18} />,
  info: <CheckCircleIcon size={18} />,
};

export function Toast({ type, title, message, onClose, autoClose = 5000 }: ToastProps): JSX.Element {
  useEffect(() => {
    if (autoClose > 0) {
      const timer = setTimeout(onClose, autoClose);
      return () => clearTimeout(timer);
    }
  }, [autoClose, onClose]);

  return (
    <div className={clsx("toast", `toast--${type}`)} role="alert" aria-live="assertive">
      <span className="toast__icon">{toastIcons[type]}</span>
      <div className="toast__content">
        <strong className="toast__title">{title}</strong>
        <p className="toast__message">{message}</p>
      </div>
      <button className="toast__close" onClick={onClose} aria-label="Dismiss">
        <XCircleIcon size={16} />
      </button>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Array<{ id: string; type: "success" | "error" | "warning" | "info"; title: string; message: string }>;
  onDismiss: (id: string) => void;
}): JSX.Element {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          type={t.type}
          title={t.title}
          message={t.message}
          onClose={() => onDismiss(t.id)}
        />
      ))}
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = true,
}: {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
}): JSX.Element {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className="progress-wrapper" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      {(label || showPercent) && (
        <div className="progress-header">
          {label && <span className="progress-label">{label}</span>}
          {showPercent && <span className="progress-percent">{Math.round(percent)}%</span>}
        </div>
      )}
      <div className="progress-track">
        <div
          className={clsx(
            "progress-fill",
            percent >= 80 && "progress-fill--success",
            percent >= 50 && percent < 80 && "progress-fill--warning",
            percent < 50 && "progress-fill--danger",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <ol className="breadcrumb__list">
        {items.map((item, i) => (
          <li key={i} className="breadcrumb__item">
            {i < items.length - 1 && item.href ? (
              <a href={item.href} className="breadcrumb__link" onClick={item.onClick}>
                {item.label}
              </a>
            ) : i < items.length - 1 ? (
              <button className="breadcrumb__link" onClick={item.onClick}>
                {item.label}
              </button>
            ) : (
              <span className="breadcrumb__current" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── Pagination ────────────────────────────────────────────────

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}): JSX.Element | null {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="pagination__btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        &laquo;
      </button>
      {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
        let pageNum: number;
        if (totalPages <= 7) {
          pageNum = i + 1;
        } else if (page <= 4) {
          pageNum = i + 1;
        } else if (page >= totalPages - 3) {
          pageNum = totalPages - 6 + i;
        } else {
          pageNum = page - 3 + i;
        }
        return (
          <button
            key={pageNum}
            className={clsx("pagination__btn", pageNum === page && "pagination__btn--active")}
            onClick={() => onPageChange(pageNum)}
            aria-label={`Page ${pageNum}`}
            aria-current={pageNum === page ? "page" : undefined}
          >
            {pageNum}
          </button>
        );
      })}
      <button
        className="pagination__btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        &raquo;
      </button>
    </nav>
  );
}

// ── Severity Badge ────────────────────────────────────────────

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export function SeverityBadge({ severity }: { severity: string }): JSX.Element {
  return (
    <span className={clsx("severity-badge", `severity-badge--${severity}`)}>
      <span className="sr-only">Severity:</span>
      {SEVERITY_LABELS[severity] || severity}
    </span>
  );
}

// ── Stat Card ─────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  color?: string;
}): JSX.Element {
  return (
    <div className="stat-card">
      {icon && <div className="stat-card__icon" style={{ color }}>{icon}</div>}
      <div className="stat-card__content">
        <span className="stat-card__value" style={{ color }}>{value}</span>
        <span className="stat-card__label">{label}</span>
      </div>
    </div>
  );
}
