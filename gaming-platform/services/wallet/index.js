import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { baseEnvSchema, loadEnv } from "@gp/config";
import { ERROR_CODES, serviceTokenOk, toMoney } from "@gp/shared-types";

/**
 * Wallet service (3011).
 *
 * The only mandatory integration is POST /internal/wallet/credit, called by
 * promotions when a claim is accepted. That endpoint is deliberately
 * idempotent: promotions rolls the claim back if the call throws, so a replay
 * of the same idempotencyKey must NOT credit the account a second time.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3011),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });

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

/** A player JWT is accepted directly; otherwise the gateway may assert the
 * user with x-user-id, but only when it presents a valid service token. */
async function requestUserId(req) {
  const raw = headerString(req.headers, "authorization");
  if (raw?.startsWith("Bearer ")) {
    try {
      const decoded = await app.jwt.verify(raw.slice(7));
      return typeof decoded.userId === "string" && decoded.userId ? decoded.userId : null;
    } catch {
      return null;
    }
  }
  if (serviceTokenOk(req.headers, env.SERVICE_TOKEN))
    return headerString(req.headers, "x-user-id");
  return null;
}

const CreditSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().positive().finite(),
  type: z.enum(["bonus", "deposit", "win", "adjustment"]).default("bonus"),
  referenceType: z.string().min(1),
  referenceId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
});

const TX_COLUMNS = `id, idempotency_key, user_id, amount, type, reference_type,
  reference_id, balance_after, created_at`;

app.post("/internal/wallet/credit", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = CreditSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const input = parsed.data;
  const amount = toMoney(input.amount);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT ${TX_COLUMNS} FROM wallet_transactions WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return ok(reply, 200, { transaction: existing.rows[0], replay: true }, reqId(req));
    }

    await client.query(
      `INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [input.userId],
    );
    const balance = await client.query(
      `UPDATE wallet_accounts SET balance = balance + $2, updated_at = now()
       WHERE user_id = $1 RETURNING balance`,
      [input.userId, amount],
    );
    const tx = await client.query(
      `INSERT INTO wallet_transactions
        (id, idempotency_key, user_id, amount, type, reference_type, reference_id, balance_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${TX_COLUMNS}`,
      [
        randomUUID(),
        input.idempotencyKey,
        input.userId,
        amount,
        input.type,
        input.referenceType,
        input.referenceId ?? null,
        balance.rows[0].balance,
      ],
    );
    await client.query("COMMIT");
    return ok(reply, 201, { transaction: tx.rows[0], replay: false }, reqId(req));
  } catch (err) {
    await client.query("ROLLBACK");
    // A concurrent duplicate request loses the unique-key race. Treat it as a
    // replay rather than an error so promotions never rolls back a valid claim.
    if (err.code === "23505" && err.constraint === "wallet_transactions_idempotency_key_key") {
      const replay = await pool.query(
        `SELECT ${TX_COLUMNS} FROM wallet_transactions WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (replay.rowCount)
        return ok(reply, 200, { transaction: replay.rows[0], replay: true }, reqId(req));
    }
    req.log.error({ err }, "wallet credit failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "credit failed");
  } finally {
    client.release();
  }
});

app.get("/v1/wallet/balance", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");

  const result = await pool.query(
    `SELECT user_id, balance, updated_at FROM wallet_accounts WHERE user_id = $1`,
    [userId],
  );
  const account = result.rows[0] ?? { user_id: userId, balance: "0.00", updated_at: null };
  return ok(reply, 200, { account }, reqId(req));
});

app.get("/v1/wallet/transactions", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");

  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 100);
  const result = await pool.query(
    `SELECT ${TX_COLUMNS} FROM wallet_transactions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return ok(reply, 200, { items: result.rows }, reqId(req));
});

app.get("/health", async () => ({ status: "ok", service: "wallet" }));
app.get("/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch (err) {
    return reply.code(503).send({ status: "error", message: err.message });
  }
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "wallet failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}
