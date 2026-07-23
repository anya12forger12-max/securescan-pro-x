/**
 * Card Component
 *
 * Container component with elevation and optional interactive states.
 */

import React from "react";
import { clsx } from "clsx";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outlined";
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({
  variant = "default",
  interactive = false,
  padding = "md",
  className,
  children,
  ...props
}: CardProps): JSX.Element {
  return (
    <div
      className={clsx(
        "card",
        `card--${variant}`,
        `card--padding-${padding}`,
        interactive && "card--interactive",
        className,
      )}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
  ...props
}: CardHeaderProps): JSX.Element {
  return (
    <div className={clsx("card__header", className)} {...props}>
      <div>
        <h3 className="card__title">{title}</h3>
        {subtitle && <p className="card__subtitle">{subtitle}</p>}
      </div>
      {action && <div className="card__action">{action}</div>}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={clsx("card__body", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={clsx("card__footer", className)} {...props}>
      {children}
    </div>
  );
}
