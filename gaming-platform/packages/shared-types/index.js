import { createHash, timingSafeEqual } from "node:crypto";
import Decimal from "decimal.js";

/** Error codes shared by the gateway-facing services. */
export const ERROR_CODES = Object.freeze({
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INTERNAL: "INTERNAL",
  CONFLICT: "CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

/** Normalise a money-like value to a two-decimal string (never a JS float). */
export function toMoney(value) {
  return new Decimal(value ?? 0).toFixed(2);
}

/** Decimal-safe multiplication for wagering targets. */
export function moneyMul(value, multiplier) {
  return new Decimal(value ?? 0).mul(new Decimal(multiplier ?? 0)).toFixed(2);
}

/** Turn an untrusted query value into a finite integer that is safe to bind as
 * a Postgres bigint. `Number(x) || fallback` lets fractions and Infinity
 * through, which fails at the bigint cast with a raw 500 from the database. */
export function boundedInt(value, fallback, min, max) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Constant-time comparison for the gateway service token. */
export function serviceTokenOk(headers, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  const provided = headers?.["x-service-token"] ?? headers?.["X-Service-Token"];
  if (typeof provided !== "string") return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
