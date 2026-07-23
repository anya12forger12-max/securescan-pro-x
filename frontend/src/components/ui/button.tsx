/**
 * Button Component
 *
 * Accessible button with keyboard support, focus indicators,
 * and multiple variants.
 */

import React from "react";
import { clsx } from "clsx";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variantStyles: Record<string, string> = {
  primary: "btn--primary",
  secondary: "btn--secondary",
  danger: "btn--danger",
  ghost: "btn--ghost",
};

const sizeStyles: Record<string, string> = {
  sm: "btn--sm",
  md: "btn--md",
  lg: "btn--lg",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      className={clsx(
        "btn",
        variantStyles[variant],
        sizeStyles[size],
        loading && "btn--loading",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading}
      type="button"
      {...props}
    >
      {loading && (
        <span className="btn__spinner" aria-hidden="true">
          ⟳
        </span>
      )}
      <span className={clsx(loading && "sr-only")}>{children}</span>
    </button>
  );
}
