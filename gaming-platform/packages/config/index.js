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
