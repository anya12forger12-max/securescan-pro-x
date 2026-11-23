import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { baseEnvSchema, capabilityFields, dbPoolOptions, loadEnv } from "@gp/config";
import { ERROR_CODES, serviceTokenOk, toMoney } from "@gp/shared-types";

/**
 * Responsible-gaming service (3012).
 *
 * Promotions calls POST /v1/internal/check before accepting a claim and reads
 * data.decision.{allowed,reason}. Any non-2xx response is treated as "not
 * allowed", so this endpoint must stay fast and must fail closed.
 */
const envSchema = baseEnvSchema.extend({
  ...capabilityFields("SERVICE_TOKEN"),
  PORT: z.coerce.number().int().positive().default(3012),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });
await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });

app.addHook("onRequest", async (req, reply) => {
  const requestId = req.headers["x-request-id"] ?? randomUUID();
  req.headers["x-request-id"] = requestId;
  reply.header("x-request-id", requestId);
});
app.addHook("onClose", async () => {
  await pool.end();
});

const headerString = (headers, name) =>
  typeof headers[name] === "string" && headers[name].length > 0 ? headers[name] : null;
const reqId = (req) => String(req.headers["x-request-id"] ?? "");
const ok = (reply, status, data, requestId) =>
  reply.code(status).send({ request_id: requestId, success: true, data });
const deny = (reply, status, code, message) =>
  reply.code(status).send({
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    error: { code, message },
  });

async function requestUserId(req) {
  // Only a signed player JWT establishes identity. The gateway strips and
  // re-derives x-user-id from the verified token; trusting a bearer service
  // token plus a header here would let any internal caller impersonate a user.
  const raw = headerString(req.headers, "authorization");
  if (raw?.startsWith("Bearer ")) {
    try {
      const decoded = await app.jwt.verify(raw.slice(7));
      return typeof decoded.userId === "string" && decoded.userId ? decoded.userId : null;
    } catch {
      return null;
    }
  }
  return null;
}

const CheckSchema = z.object({
  userId: z.string().min(1),
  action: z.string().min(1),
  amount: z.coerce.number().nonnegative().finite().optional(),
});

app.post("/v1/internal/check", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = CheckSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const { userId, action, amount } = parsed.data;
  const exclusion = await pool.query(
    `SELECT reason FROM rg_self_exclusions
     WHERE user_id = $1 AND active = true
       AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  );

  const decision = exclusion.rowCount
    ? { allowed: false, reason: exclusion.rows[0].reason ?? "self-excluded" }
    : { allowed: true, reason: null };

  await pool.query(
    `INSERT INTO rg_check_audit (id, user_id, action, amount, allowed, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), userId, action, amount === undefined ? null : toMoney(amount), decision.allowed, decision.reason],
  );

  return ok(reply, 200, { decision }, reqId(req));
});

const SelfExcludeSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
  durationDays: z.coerce.number().int().positive().max(3650).optional(),
});

app.post("/v1/responsible-gaming/self-exclude", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");

  const parsed = SelfExcludeSchema.safeParse(req.body ?? {});
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const { reason, durationDays } = parsed.data;
  const expiresAt = durationDays
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // An exclusion that is still in effect is immutable by the player. The
  // conditional upsert is the atomic guard: a second concurrent request cannot
  // slip past a read-then-write check and turn a lifetime (NULL) exclusion into
  // a short, auto-expiring one. There is deliberately no self-service lift.
  const result = await pool.query(
    `INSERT INTO rg_self_exclusions (user_id, active, reason, expires_at, created_at)
     VALUES ($1, true, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
       SET active = true, reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at, created_at = now()
     WHERE NOT (rg_self_exclusions.active
                AND (rg_self_exclusions.expires_at IS NULL
                     OR rg_self_exclusions.expires_at > now()))`,
    [userId, reason ?? "self-requested exclusion", expiresAt],
  );
  if (!result.rowCount) {
    return deny(
      reply,
      409,
      ERROR_CODES.CONFLICT,
      "an active self-exclusion is already in effect and cannot be changed by the player",
    );
  }
  return ok(reply, 200, { selfExcluded: true, expiresAt }, reqId(req));
});

app.get("/v1/responsible-gaming/status", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");

  const result = await pool.query(
    `SELECT active, reason, created_at, expires_at,
            (expires_at IS NULL OR expires_at > now()) AS in_effect
     FROM rg_self_exclusions WHERE user_id = $1`,
    [userId],
  );
  return ok(reply, 200, { status: result.rows[0] ?? { active: false, in_effect: false } }, reqId(req));
});

app.get("/health", async () => ({ status: "ok", service: "responsible-gaming" }));
app.get("/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch (err) {
    return reply.code(503).send({ status: "error", message: err.message });
  }
});

try {
  await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "responsible-gaming failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}

// Drain in-flight requests and let the onClose hook end the pool before the
// container is killed; without this SIGTERM drops active transactions.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}
