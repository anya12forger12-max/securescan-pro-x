import { z } from "zod";

/**
 * Configuration shared by every service.
 *
 * Internal credentials are capability scoped. One shared token used to let a
 * compromised chat process credit wallets and grant admin roles; each internal
 * API now has its own token and the gateway injects only the one that route
 * needs. None has a default, so a half-configured deployment fails closed.
 */
const internalToken = (name) =>
  z.string().min(32, `${name} must be at least 32 characters and explicitly configured`);

/**
 * Capability credentials are declared by the services that actually hold them.
 * Putting every token in a shared base schema used to force Compose to inject
 * all of them into every container, which made compromising a game service
 * equivalent to compromising the wallet and admin APIs.
 */
export const capabilityTokenFields = {
  SERVICE_TOKEN: internalToken("SERVICE_TOKEN"),
  ADMIN_SERVICE_TOKEN: internalToken("ADMIN_SERVICE_TOKEN"),
  WALLET_SERVICE_TOKEN: internalToken("WALLET_SERVICE_TOKEN"),
  REALTIME_SERVICE_TOKEN: internalToken("REALTIME_SERVICE_TOKEN"),
  PROMOTIONS_SERVICE_TOKEN: internalToken("PROMOTIONS_SERVICE_TOKEN"),
  CRASH_SERVICE_TOKEN: internalToken("CRASH_SERVICE_TOKEN"),
  ADMIN_BOOTSTRAP_TOKEN: internalToken("ADMIN_BOOTSTRAP_TOKEN"),
};

/** Select only the credentials a service needs; unlisted ones stay absent. */
export function capabilityFields(...names) {
  return Object.fromEntries(names.map((name) => [name, capabilityTokenFields[name]]));
}

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

/**
 * Parse a comma-separated CORS_ORIGIN into the exact strings browsers send.
 * Every service and the gateway must use this one implementation: trimming and
 * URL-normalising in only some processes made edge and peer CORS decisions
 * diverge (for example `http://localhost:3000/` never matches an Origin
 * header even though it appears in the gateway's connect-src).
 *
 * Malformed entries are kept verbatim so they fail closed as exact,
 * non-matching origins instead of widening the allow-list.
 */
export function parseCorsOrigins(value = "http://localhost:5173") {
  return String(value)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const url = new URL(origin);
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        )
          return url.origin;
      } catch {
        // Keep the raw value; an invalid origin must not widen the allow-list.
      }
      return origin;
    });
}

/**
 * Bounded Postgres pool settings shared by every service.
 *
 * Thirteen services previously opened up to 20 connections each (~270) while
 * Postgres defaults to max_connections=100. Under load the fleet starved
 * itself of connections instead of queueing. DB_POOL_MAX is now the one knob
 * that sizes the whole deployment; idle and connection timeouts stop a leaked
 * client from holding a slot indefinitely.
 */
export function dbPoolOptions(connectionString, fallbackMax = 5) {
  const configured = Number(process.env.DB_POOL_MAX);
  const max = Number.isInteger(configured) && configured > 0 ? configured : fallbackMax;
  return {
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

/**
 * Validate process.env against a service schema. Startup fails loudly rather
 * than binding a port with half-configured state.
 */
export function loadEnv(schema) {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    console.error(`[config] invalid environment:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

/**
 * Uniform JSON error envelope for services that use the gateway-style
 * {request_id, success, data} contract.
 */
const KNOWN_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

/** Map an error to the shared code contract without flattening 5xx into 500. */
function errorCode(error, status) {
  if (typeof error.code === "string" && KNOWN_ERROR_CODES.has(error.code)) return error.code;
  switch (status) {
    case 400: return "VALIDATION_ERROR";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 503: return "SERVICE_UNAVAILABLE";
    default: return status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
  }
}

export function registerErrorHandler(app) {
  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, "request failed");
    if (reply.sent) return;
    // Fastify and upstream failures can legitimately be 401/403/404/503;
    // rewriting them to 500 hid auth denials and made outages indistinguishable
    // from bugs in the service itself.
    const status =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    reply.code(status).send({
      request_id: String(req.headers["x-request-id"] ?? ""),
      error: {
        code: errorCode(error, status),
        message: status >= 500 ? "internal error" : error.message,
      },
    });
  });
}

/** fetch with an abort timeout, used for synchronous inter-service checks. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signals = [controller.signal, options.signal].filter(Boolean);
  // The caller's cancellation must survive alongside the timeout; overwriting
  // `signal` used to make externally aborted requests impossible to cancel.
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  try {
    return await fetch(url, { ...options, signal });
  } finally {
    clearTimeout(timer);
  }
}
