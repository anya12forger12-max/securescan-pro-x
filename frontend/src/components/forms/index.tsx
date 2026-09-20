/**
 * Form Components — Input, Select, Textarea, Checkbox, Switch
 */
import React, { useState } from "react";
import { clsx } from "clsx";
import { EyeIcon, EyeOffIcon } from "../icons";

// ── Input ─────────────────────────────────────────────────────

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export function Input({
  label,
  error,
  icon,
  id,
  className,
  type,
  ...props
}: InputProps): JSX.Element {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  if (type === "password") {
    return (
      <PasswordInput
        label={label}
        error={error}
        id={inputId}
        className={className}
        {...props}
      />
    );
  }

  return (
    <div className={clsx("form-group", className)}>
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <div className={clsx("form-input-wrapper", error && "form-input-wrapper--error")}>
        {icon && <span className="form-input-icon">{icon}</span>}
        <input
          id={inputId}
          className={clsx("form-input", icon && "form-input--with-icon")}
          type={type}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Password Input ────────────────────────────────────────────

interface PasswordInputProps extends Omit<InputProps, "type"> {}

function PasswordInput({ label, error, id, className, ...props }: PasswordInputProps): JSX.Element {
  const [show, setShow] = useState(false);
  const inputId = id || "password";

  return (
    <div className={clsx("form-group", className)}>
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <div className={clsx("form-input-wrapper", error && "form-input-wrapper--error")}>
        <input
          id={inputId}
          className="form-input form-input--with-icon"
          type={show ? "text" : "password"}
          aria-invalid={!!error}
          {...props}
        />
        <button
          type="button"
          className="form-input-toggle"
          onClick={() => setShow(!show)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label?: string;
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
}

export function Select({
  label,
  options,
  value,
  onChange,
  error,
  disabled,
  placeholder,
  id,
  className,
}: SelectProps): JSX.Element {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className={clsx("form-group", className)}>
      {label && (
        <label htmlFor={selectId} className="form-label">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={clsx("form-select", error && "form-select--error")}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        aria-invalid={!!error}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Textarea ──────────────────────────────────────────────────

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({
  label,
  error,
  id,
  className,
  ...props
}: TextareaProps): JSX.Element {
  const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className={clsx("form-group", className)}>
      {label && (
        <label htmlFor={textareaId} className="form-label">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={clsx("form-textarea", error && "form-textarea--error")}
        aria-invalid={!!error}
        rows={4}
        {...props}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Checkbox ──────────────────────────────────────────────────

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  id,
  className,
}: CheckboxProps): JSX.Element {
  const checkboxId = id || label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className={clsx("form-checkbox-wrapper", className)}>
      <input
        id={checkboxId}
        type="checkbox"
        className="form-checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
      />
      <label htmlFor={checkboxId} className="form-checkbox-label">
        {label}
      </label>
    </div>
  );
}

// ── Switch ────────────────────────────────────────────────────

export interface SwitchProps {
  label?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  id,
  className,
}: SwitchProps): JSX.Element {
  const switchId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : "switch");

  return (
    <div className={clsx("form-switch-wrapper", className)}>
      <button
        id={switchId}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={clsx("form-switch", checked && "form-switch--on")}
        onClick={() => onChange?.(!checked)}
        disabled={disabled}
        type="button"
      >
        <span className="form-switch-thumb" />
      </button>
      {label && (
        <label htmlFor={switchId} className="form-switch-label">
          {label}
        </label>
      )}
    </div>
  );
}
