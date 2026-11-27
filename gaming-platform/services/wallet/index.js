import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { baseEnvSchema, capabilityFields, dbPoolOptions, loadEnv, parseCorsOrigins, jwtVerifyEnvFields, jwtVerifyPluginOptions } from "@gp/config";
import { ERROR_CODES, boundedInt, serviceTokenOk, toMoney } from "@gp/shared-types";

/**
 * Wallet service (3011).
 *
 * Mandatory integrations are POST /internal/wallet/credit (promotions claims)
 * and POST /internal/wallet/debit (crash stakes). Both are deliberately
 * idempotent: a caller that rolls back after an ambiguous response replays the
 * same idempotencyKey, which must not move the account a second time.
 */
// Scoped peer credentials are optional for local runs: deployments inject all
// three through Compose, but the full gateway token alone still works for
// development and for the gateway's internal-wallet security tests.
const scopedToken = (name) =>
  z.string().min(32, `${name} must be at least 32 characters`).optional();

const envSchema = baseEnvSchema.extend({
  ...capabilityFields("SERVICE_TOKEN", "WALLET_SERVICE_TOKEN"),
  WALLET_DEBIT_SERVICE_TOKEN: scopedToken("WALLET_DEBIT_SERVICE_TOKEN"),
  WALLET_BONUS_SERVICE_TOKEN: scopedToken("WALLET_BONUS_SERVICE_TOKEN"),
  WALLET_WIN_SERVICE_TOKEN: scopedToken("WALLET_WIN_SERVICE_TOKEN"),
  PORT: z.coerce.number().int().positive().default(3011),
  DATABASE_URL: z.string().min(1).url(),
  ...jwtVerifyEnvFields,
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: parseCorsOrigins(env.CORS_ORIGIN) });
await app.register(jwt, jwtVerifyPluginOptions(env));

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

/**
 * Capability scoping. WALLET_SERVICE_TOKEN remains the full
 * gateway/test/admin capability. Peer tokens are narrower:
 *   WALLET_DEBIT_SERVICE_TOKEN  -> debit only
 *   WALLET_BONUS_SERVICE_TOKEN  -> credit with type=bonus only
 *   WALLET_WIN_SERVICE_TOKEN    -> credit with type=win only, plus the narrow
 *                                  crash refund shape below
 * A token that is valid but lacks the operation/type gets 403, not 401, so a
 * misconfigured peer is distinguishable from an unauthenticated caller.
 *
 * During a mixed-version rollout peers send the full token in the legacy
 * `x-service-token` header and their narrow token in `x-wallet-scope`; the
 * scope header wins here while older wallet versions simply ignore it.
 */
const tokenEquals = (provided, expected) =>
  typeof provided === "string" &&
  provided.length > 0 &&
  typeof expected === "string" &&
  expected.length > 0 &&
  serviceTokenOk({ "x-service-token": provided }, expected);

/** `x-wallet-scope` carries the narrow token. When present it is authoritative,
 * so a peer cannot escalate by also sending the compatibility full token. */
const scopeToken = (req) => headerString(req.headers, "x-wallet-scope");
const hasToken = (req, expected) =>
  tokenEquals(scopeToken(req), expected) ||
  tokenEquals(headerString(req.headers, "x-service-token"), expected);
const hasFullToken = (req) => !scopeToken(req) && hasToken(req, env.WALLET_SERVICE_TOKEN);

const walletCredentialPresent = (req) =>
  [
    env.WALLET_SERVICE_TOKEN,
    env.WALLET_DEBIT_SERVICE_TOKEN,
    env.WALLET_BONUS_SERVICE_TOKEN,
    env.WALLET_WIN_SERVICE_TOKEN,
  ].some((token) => hasToken(req, token));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The win-scoped token may refund a *real* crash stake, not merely submit a
 * request that happens to look like a refund. Every field in the body is
 * caller-controlled, so the bet itself is the authority for who is owed what.
 */
async function crashRefundAuthorised(input, amount) {
  const betId = input.idempotencyKey.slice("crash-refund-".length);
  if (!UUID_RE.test(betId) || input.referenceId !== betId) return false;
  try {
    const found = await pool.query(
      `SELECT user_id, amount, status FROM crash_bets WHERE id = $1`,
      [betId],
    );
    const bet = found.rows[0];
    if (!bet) return false;
    return (
      bet.user_id === input.userId &&
      Number(bet.amount) === Number(amount) &&
      input.referenceType === "crash_refund" &&
      ["refunding", "refunded"].includes(bet.status)
    );
  } catch {
    return false;
  }
}

const creditAllowed = async (req, input, amount) => {
  if (hasFullToken(req)) return true;
  if (input.type === "bonus") return hasToken(req, env.WALLET_BONUS_SERVICE_TOKEN);
  if (input.type === "win") return hasToken(req, env.WALLET_WIN_SERVICE_TOKEN);
  // Narrow exception agreed with the crash workstream: a failed bet is refunded
  // with the win-scoped token, but only after verifying the referenced bet.
  // All other adjustment credits still require the full wallet capability.
  if (
    input.type === "adjustment" &&
    input.referenceType === "crash_refund" &&
    input.idempotencyKey.startsWith("crash-refund-") &&
    (await crashRefundAuthorised(input, amount))
  )
    return hasToken(req, env.WALLET_WIN_SERVICE_TOKEN);
  return false;
};

const debitAllowed = (req) =>
  hasFullToken(req) || hasToken(req, env.WALLET_DEBIT_SERVICE_TOKEN);

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

// toMoney() rounds to two decimals, so a positive sub-cent amount would still
// create a zero-value transaction. Validate the minimum before conversion.
const moneyAmount = z.coerce
  .number()
  .positive()
  .finite()
  .refine((value) => value >= 0.01, { message: "amount must be at least 0.01" });

const CreditSchema = z.object({
  userId: z.string().min(1),
  amount: moneyAmount,
  type: z.enum(["bonus", "deposit", "win", "adjustment"]).default("bonus"),
  referenceType: z.string().min(1),
  referenceId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
});

const TX_COLUMNS = `id, idempotency_key, user_id, amount, type, reference_type,
  reference_id, balance_after, created_at`;

/** A replay must describe the same movement, not just the same key: a caller
 * that knows a key must not be able to replay it against a different amount,
 * type or resource, or read another user's balance/amount from the response. */
const replayMatches = (tx, { userId, type, referenceType, referenceId }, signedAmount) =>
  tx.user_id === userId &&
  Number(tx.amount) === Number(signedAmount) &&
  tx.type === type &&
  tx.reference_type === referenceType &&
  (tx.reference_id ?? null) === (referenceId ?? null);

app.post("/internal/wallet/credit", async (req, reply) => {
  // Reject unknown credentials before parsing the body; then require the
  // credential to be allowed for the *requested* credit type.
  if (!walletCredentialPresent(req))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = CreditSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const input = parsed.data;
  const amount = toMoney(input.amount);
  if (!(await creditAllowed(req, input, amount)))
    return deny(reply, 403, ERROR_CODES.FORBIDDEN, "token not authorized for this credit type");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT ${TX_COLUMNS} FROM wallet_transactions WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      if (!replayMatches(existing.rows[0], input, amount))
        return deny(reply, 409, ERROR_CODES.CONFLICT, "idempotency key belongs to a different transaction");
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
      if (replay.rowCount) {
        if (!replayMatches(replay.rows[0], input, amount))
          return deny(reply, 409, ERROR_CODES.CONFLICT, "idempotency key belongs to a different transaction");
        return ok(reply, 200, { transaction: replay.rows[0], replay: true }, reqId(req));
      }
    }
    req.log.error({ err }, "wallet credit failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "credit failed");
  } finally {
    client.release();
  }
});

/**
 * Atomic, idempotent stake debit used by the unified crash game.
 *
 * The balance UPDATE is conditional on sufficient funds, so two concurrent
 * bets cannot both spend the same credits. Replaying the same idempotencyKey
 * returns the original transaction instead of debiting twice — the same
 * contract /internal/wallet/credit already provides for promotions.
 */
const DebitSchema = z.object({
  userId: z.string().min(1),
  amount: moneyAmount,
  referenceType: z.string().min(1),
  referenceId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
});

app.post("/internal/wallet/debit", async (req, reply) => {
  // The full wallet capability and the debit-only peer capability may stake;
  // bonus/win credit tokens must never be able to move funds out.
  if (!walletCredentialPresent(req))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  if (!debitAllowed(req))
    return deny(reply, 403, ERROR_CODES.FORBIDDEN, "token not authorized for debit");

  const parsed = DebitSchema.safeParse(req.body);
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
      if (!replayMatches(existing.rows[0], { ...input, type: "wager" }, -amount))
        return deny(reply, 409, ERROR_CODES.CONFLICT, "idempotency key belongs to a different transaction");
      return ok(reply, 200, { transaction: existing.rows[0], replay: true }, reqId(req));
    }

    await client.query(
      `INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [input.userId],
    );
    const balance = await client.query(
      `UPDATE wallet_accounts SET balance = balance - $2, updated_at = now()
       WHERE user_id = $1 AND balance >= $2 RETURNING balance`,
      [input.userId, amount],
    );
    if (!balance.rowCount) {
      await client.query("ROLLBACK");
      return deny(reply, 409, ERROR_CODES.CONFLICT, "insufficient balance");
    }

    const tx = await client.query(
      `INSERT INTO wallet_transactions
        (id, idempotency_key, user_id, amount, type, reference_type, reference_id, balance_after)
       VALUES ($1, $2, $3, $4, 'wager', $5, $6, $7)
       RETURNING ${TX_COLUMNS}`,
      [
        randomUUID(),
        input.idempotencyKey,
        input.userId,
        -amount,
        input.referenceType,
        input.referenceId ?? null,
        balance.rows[0].balance,
      ],
    );
    await client.query("COMMIT");
    return ok(reply, 201, { transaction: tx.rows[0], replay: false }, reqId(req));
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "wallet_transactions_idempotency_key_key") {
      const replay = await pool.query(
        `SELECT ${TX_COLUMNS} FROM wallet_transactions WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (replay.rowCount) {
        if (!replayMatches(replay.rows[0], { ...input, type: "wager" }, -amount))
          return deny(reply, 409, ERROR_CODES.CONFLICT, "idempotency key belongs to a different transaction");
        return ok(reply, 200, { transaction: replay.rows[0], replay: true }, reqId(req));
      }
    }
    req.log.error({ err }, "wallet debit failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "debit failed");
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

  const limit = boundedInt(req.query.limit, 50, 1, 100);
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
  await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "wallet failed to start");
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
