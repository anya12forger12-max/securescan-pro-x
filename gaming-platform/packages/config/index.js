import { z } from "zod";

/**
 * Configuration shared by every service.
 *
 * SERVICE_TOKEN is used by the gateway to assert trusted internal calls
 * (for example x-user-id injection and promotions catalogue management).
 * It has no default: a silent shared fallback would let any deployment that
 * forgot to configure it accept forged internal credentials.
 */
export const baseEnvSchema = z.object({
  SERVICE_TOKEN: z
    .string()
    .min(32, "SERVICE_TOKEN must be at least 32 characters and explicitly configured"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

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
export function registerErrorHandler(app) {
  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, "request failed");
    if (reply.sent) return;
    const status =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    reply.code(status).send({
      request_id: String(req.headers["x-request-id"] ?? ""),
      error: {
        code: status === 400 ? "VALIDATION_ERROR" : status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
        message: status === 500 ? "internal error" : error.message,
      },
    });
  });
}

/** fetch with an abort timeout, used for synchronous inter-service checks. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
