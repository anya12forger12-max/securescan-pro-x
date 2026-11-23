import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import {
  baseEnvSchema,
  capabilityFields,
  dbPoolOptions,
  fetchWithTimeout,
  loadEnv,
} from "@gp/config";
import { ERROR_CODES, moneyMul, serviceTokenOk, toMoney } from "@gp/shared-types";

/**
 * Unified Aviator/crash service (3023).
 *
 * This is the authoritative scoring backend the four vendored Aviator projects
 * never had. Rounds are provably fair: the SHA-256 hash of the server seed is
 * published before betting opens, and the seed plus its derived crash point
 * are revealed after the round finishes. Bets debit the wallet atomically and
 * cash-outs credit it with an idempotency key derived from the persisted bet
 * claim, so an ambiguous HTTP response can be replayed without paying twice.
 *
 * The only identity accepted from the browser is a signed player JWT. Internal
 * lifecycle calls require the crash-scoped capability token, and wallet /
 * realtime calls use their own scoped tokens — never a shared secret.
 */
const envSchema = baseEnvSchema.extend({
  ...capabilityFields(
    "CRASH_SERVICE_TOKEN",
    "REALTIME_SERVICE_TOKEN",
    // Used only to call responsible-gaming's internal check. The wallet's full
    // capability is deliberately absent: this service receives scoped tokens.
    "SERVICE_TOKEN",
  ),
  // Production injects capability-scoped wallet tokens only. The full-access
  // token stays optional purely as a mixed-version local-run fallback and is
  // never sent on the wire when a scoped credential is available.
  WALLET_SERVICE_TOKEN: z.string().min(32).optional(),
  WALLET_DEBIT_SERVICE_TOKEN: z.string().min(32).optional(),
  WALLET_WIN_SERVICE_TOKEN: z.string().min(32).optional(),
  PORT: z.coerce.number().int().positive().default(3023),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WALLET_INTERNAL_URL: z.string().url().default("http://wallet:3011"),
  REALTIME_INTERNAL_URL: z.string().url().default("http://realtime:3010"),
  RESPONSIBLE_GAMING_URL: z.string().url().default("http://responsible-gaming:3012"),
  BETTING_WINDOW_MS: z.coerce.number().int().min(1000).max(120000).default(8000),
  ROUND_GAP_MS: z.coerce.number().int().min(250).max(60000).default(2500),
  DOUBLING_SECONDS: z.coerce.number().positive().min(0.5).max(30).default(3),
  HOUSE_EDGE: z.coerce.number().min(0).max(0.5).default(0.02),
  MAX_MULTIPLIER: z.coerce.number().positive().min(2).max(1000).default(100),
  MIN_BET: z.coerce.number().positive().default(1),
  MAX_BET: z.coerce.number().positive().default(10000),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));

// Deadlines are derived from persisted timestamps, never from process timers
// alone. A restart must not turn a stale round into a max-multiplier cash-out.
const BETTING_TOLERANCE_MS = 1000;
const UNSETTLED_RECONCILE_MS = 2000;

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
const ok = (reply, status, data) =>
  reply.code(status).send({ request_id: String(reply.getHeader("x-request-id") ?? ""), success: true, data });
const deny = (reply, status, code, message, details) =>
  reply.code(status).send({
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    error: details === undefined ? { code, message } : { code, message, details },
  });

async function requestUserId(req) {
  // A service token or a caller-supplied header is never an identity. Only a
  // signed player JWT can authorize a bet or a cash-out.
  const raw = headerString(req.headers, "authorization");
  if (!raw?.startsWith("Bearer ")) return null;
  try {
    const decoded = await app.jwt.verify(raw.slice(7));
    return typeof decoded.userId === "string" && decoded.userId ? decoded.userId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provably fair round generation
// ---------------------------------------------------------------------------

function hmacUnit(serverSeed, roundId) {
  const digest = createHmac("sha256", serverSeed).update(roundId).digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

/** Turn a uniform unit value into a crash point. Shared by live rounds and
 * the strategy lab so both use exactly the same distribution. */
export function pointFromUnit(u, houseEdge, maxMultiplier) {
  if (u < houseEdge) return 1;
  const normalised = (u - houseEdge) / (1 - houseEdge);
  // 1/(1-p) gives the familiar heavy tail: most rounds end near 1-2x, with
  // rare long flights. Clamp before rounding so the published value is exact.
  const raw = Math.min(maxMultiplier, 1 / (1 - normalised * 0.99));
  return Math.max(1, Math.floor(raw * 100) / 100);
}

/** Deterministic, verifiable crash point derived from (serverSeed, roundId). */
export function crashPointFor(serverSeed, roundId, houseEdge, maxMultiplier) {
  return pointFromUnit(hmacUnit(serverSeed, roundId), houseEdge, maxMultiplier);
}

function multiplierAt(elapsedMs, doublingSeconds = env.DOUBLING_SECONDS) {
  return Math.pow(2, Math.max(0, elapsedMs) / (doublingSeconds * 1000));
}

function crashDurationMs(crashPoint, doublingSeconds = env.DOUBLING_SECONDS) {
  return Math.max(0, doublingSeconds * 1000 * Math.log2(crashPoint));
}

function roundConfig(round) {
  return {
    houseEdge: round.house_edge === undefined || round.house_edge === null
      ? env.HOUSE_EDGE : Number(round.house_edge),
    maxMultiplier: round.max_multiplier === undefined || round.max_multiplier === null
      ? env.MAX_MULTIPLIER : Number(round.max_multiplier),
    doublingSeconds: round.doubling_seconds === undefined || round.doubling_seconds === null
      ? env.DOUBLING_SECONDS : Number(round.doubling_seconds),
  };
}

/** Absolute, DB-derived deadline for a round. Timers are only an optimisation;
 * this timestamp is the authoritative answer after a restart. */
function roundDeadline(round) {
  if (round.status === "running" && round.started_at) {
    const { doublingSeconds } = roundConfig(round);
    return new Date(round.started_at).getTime()
      + crashDurationMs(Number(round.crash_point), doublingSeconds);
  }
  if (round.status === "betting" && round.created_at) {
    return new Date(round.created_at).getTime() + env.BETTING_WINDOW_MS;
  }
  return null;
}

function roundPastDeadline(round, toleranceMs = 0) {
  const deadline = roundDeadline(round);
  return deadline !== null && Date.now() > deadline + toleranceMs;
}

function bettingDeadlinePassed(round) {
  return round?.status === "betting" && roundPastDeadline(round, BETTING_TOLERANCE_MS);
}

function roundHasCrashed(round) {
  return round?.status === "running" && roundPastDeadline(round, 0);
}

function verifyRound(round) {
  if (!round.server_seed || !round.crash_point) return null;
  const { houseEdge, maxMultiplier } = roundConfig(round);
  const expected = crashPointFor(round.server_seed, round.id, houseEdge, maxMultiplier);
  return {
    serverSeed: round.server_seed,
    seedHash: createHash("sha256").update(round.server_seed).digest("hex"),
    crashPoint: Number(round.crash_point),
    houseEdge,
    maxMultiplier,
    valid: Math.abs(expected - Number(round.crash_point)) < 0.001,
  };
}

function publicRound(row) {
  const out = {
    id: row.id,
    status: row.status,
    seedHash: row.seed_hash,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    // The client renders the same exponential curve the server pays.
    doublingSeconds: roundConfig(row).doublingSeconds,
    maxMultiplier: roundConfig(row).maxMultiplier,
  };
  if (row.status === "finished" || row.status === "cancelled") {
    Object.assign(out, {
      crashPoint: row.crash_point === null ? null : Number(row.crash_point),
      finishedAt: row.finished_at ?? null,
      proof: verifyRound(row),
    });
  }
  return out;
}

/** Internal settlement value: capped at the actual crash point. Never expose
 * this on a public route — see publicMultiplier below. */
function liveMultiplier(row) {
  if (row.status !== "running" || !row.started_at) return null;
  const { doublingSeconds } = roundConfig(row);
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  return Math.round(Math.min(multiplierAt(elapsed, doublingSeconds), Number(row.crash_point)) * 100) / 100;
}

/** Public rendering of the live curve. It deliberately never reads the hidden
 * crash point: clamping the displayed value there makes it plateau at the
 * secret outcome during the gap between the true crash and the lifecycle tick,
 * leaking the result before it is published. Only the configured ceiling is
 * used here; settlement keeps its own crash-point-capped calculation. */
function publicMultiplier(row) {
  if (row.status !== "running" || !row.started_at) return null;
  const { doublingSeconds, maxMultiplier } = roundConfig(row);
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  return Math.round(Math.min(multiplierAt(elapsed, doublingSeconds), maxMultiplier) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Scoped inter-service clients
// ---------------------------------------------------------------------------

/** A wallet response whose outcome cannot be proven either way. The debit or
 * credit may have committed, so callers must reconcile by replaying the same
 * idempotency key rather than assuming the operation did not happen. */
/** Wallet failures must carry their HTTP status. A plain `Error` ignores the
 * extra constructor arguments, which used to make a definite 409 look like an
 * ambiguous transport failure: the bet stayed pending and every retry logged
 * another false alarm. */
export class WalletRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "WalletRequestError";
    this.status = status;
    this.code = code;
  }
}

export class WalletAmbiguousError extends WalletRequestError {
  constructor(message, status, code) {
    super(message, status, code);
    this.name = "WalletAmbiguousError";
  }
}

/** True only when the wallet proved the operation did NOT happen. Malformed
 * bodies and 5xx responses are WalletAmbiguousError — the money may have moved —
 * so callers must keep their idempotent claim and replay it instead of
 * rolling back to a state that can later be settled as a loss. */
const definitiveWalletRejection = (err) =>
  err instanceof WalletRequestError &&
  !(err instanceof WalletAmbiguousError) &&
  err.status >= 400 &&
  err.status < 500;

/**
 * Replay an idempotent wallet call after an ambiguous response. The factory is
 * invoked again with the exact same request body, including its deterministic
 * key: if the wallet committed the first time it returns that original
 * transaction, otherwise the same key is applied at most once. A definitive
 * rejection from the replay keeps its own class and HTTP status, so callers can
 * still distinguish "did not happen" from "may have happened".
 */
async function walletIdempotent(request) {
  try {
    return await request();
  } catch (err) {
    if (!(err instanceof WalletAmbiguousError)) throw err;
    app.log.warn({ err }, "wallet response ambiguous; replaying the same idempotency key");
    return request();
  }
}

/** Responsible gaming is the single source of truth for self-exclusion. Every
 * wager is gated on it and an unreachable/stale service fails closed, so an
 * excluded player cannot stake during an RG or network outage. */
async function wageringAllowed(userId, amount) {
  try {
    const response = await fetchWithTimeout(
      `${env.RESPONSIBLE_GAMING_URL}/v1/internal/check`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": env.SERVICE_TOKEN,
        },
        body: JSON.stringify({ userId, action: "crash.bet", amount }),
      },
      2000,
    );
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.data?.decision?.allowed === true;
  } catch (err) {
    app.log.warn({ err, userId }, "responsible-gaming check failed; blocking wager");
    return false;
  }
}

async function walletRequest(path, body, scopedTokenValue) {
  // Send only the narrow capability for this call. Peer containers no longer
  // receive the full wallet token, so there is nothing to fall back to; a
  // compromised crash process cannot escalate to arbitrary credit/debit types.
  let response;
  try {
    response = await fetchWithTimeout(
      `${env.WALLET_INTERNAL_URL}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": scopedTokenValue,
        },
        body: JSON.stringify(body),
      },
      5000,
    );
  } catch (err) {
    // A timeout or transport failure proves nothing: the wallet may have
    // committed just before the socket died. Classify it as ambiguous so the
    // caller replays the same claim instead of rolling back a real debit.
    throw new WalletAmbiguousError(`wallet request failed: ${err.message}`, 0, err.code);
  }
  const text = await response.text();
  let payload = null;
  let parseFailed = false;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }
  if (!response.ok || parseFailed) {
    const ambiguous = parseFailed || response.status >= 500;
    const ErrorClass = ambiguous ? WalletAmbiguousError : WalletRequestError;
    const err = new ErrorClass(
      payload?.error?.message ?? `wallet returned ${response.status}`,
      response.status,
      payload?.error?.code,
    );
    // Do not stack retries here: walletIdempotent() already replays the whole
    // request once with the same key. Three attempts inside that replay used
    // to hold the global serialized() lifecycle lock for ~30s per claim.
    throw err;
  }
  return payload?.data ?? payload;
}

// Each direction gets its own capability token; the shared token remains the
// fallback until the wallet/gateway deployment switches to the scoped ones.
const debitToken = () => env.WALLET_DEBIT_SERVICE_TOKEN ?? env.WALLET_SERVICE_TOKEN;
const winToken = () => env.WALLET_WIN_SERVICE_TOKEN ?? env.WALLET_SERVICE_TOKEN;

// A wallet key belongs to a persisted bet claim, never to an HTTP attempt.
// Deriving it from crash_bets.idempotency_key (with the bet id as a fallback)
// makes a replay of the same bet reuse the wallet transaction even across a
// process restart, while a genuinely new bet in another round gets a new key.
const BET_CLAIM_PREFIX = "crash-bet-";
const walletClaimId = (bet) =>
  typeof bet.idempotency_key === "string" && bet.idempotency_key.startsWith(BET_CLAIM_PREFIX)
    ? bet.idempotency_key.slice(BET_CLAIM_PREFIX.length)
    : bet.id;
const debitKey = (bet) => `crash-debit-${walletClaimId(bet)}`;
const creditKey = (bet) => `crash-credit-${walletClaimId(bet)}`;
const refundKey = (bet) => `crash-refund-${walletClaimId(bet)}`;

const walletDebit = (bet) =>
  walletIdempotent(() => walletRequest("/internal/wallet/debit", {
    userId: bet.user_id,
    amount: Number(bet.amount),
    referenceType: "crash_bet",
    referenceId: bet.round_id,
    idempotencyKey: debitKey(bet),
  }, debitToken()));

const walletCredit = (bet, payout = Number(bet.payout)) =>
  walletIdempotent(() => walletRequest("/internal/wallet/credit", {
    userId: bet.user_id,
    amount: payout,
    type: "win",
    referenceType: "crash_bet",
    referenceId: bet.id,
    idempotencyKey: creditKey(bet),
  }, winToken()));

/** Duplicate/refunded stakes must not be booked as wins. Refunds are credits,
 * so they use the win capability with a distinct, idempotent key. The wallet
 * authorises the win token for type=adjustment only when referenceType is
 * 'crash_refund' and the key starts with 'crash-refund-' — all three are fixed
 * below, so the scoped token is safe to send here. */
const walletRefund = (bet) =>
  walletIdempotent(() => walletRequest("/internal/wallet/credit", {
    userId: bet.user_id,
    amount: Number(bet.amount),
    type: "adjustment",
    referenceType: "crash_refund",
    referenceId: bet.id,
    idempotencyKey: refundKey(bet),
  }, winToken()));

async function publish(topic, payload) {
  try {
    await fetchWithTimeout(
      `${env.REALTIME_INTERNAL_URL}/internal/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": env.REALTIME_SERVICE_TOKEN,
        },
        body: JSON.stringify({ topic, payload }),
      },
      5000,
    );
  } catch (err) {
    // The round ledger is authoritative; a missed event must not lose money.
    app.log.warn({ err, topic }, "crash event publish failed");
  }
}

// ---------------------------------------------------------------------------
// Round lifecycle. One in-process lock serialises start/finish/cash-out so a
// tick can never cash out a bet after the crash has been published.
// ---------------------------------------------------------------------------

let lifecycle = Promise.resolve();
const serialized = (fn) => {
  const next = lifecycle.then(fn, fn);
  lifecycle = next.catch(() => undefined);
  return next;
};
let stopping = false;
const timers = new Set();

function later(fn, ms) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (!stopping)
      void serialized(fn).catch((err) => app.log.warn({ err }, "deferred crash task failed"));
  }, ms);
  timers.add(timer);
  return timer;
}

async function createRound() {
  const serverSeed = randomBytes(32).toString("hex");
  const seedHash = createHash("sha256").update(serverSeed).digest("hex");
  const id = randomUUID();
  const crashPoint = crashPointFor(serverSeed, id, env.HOUSE_EDGE, env.MAX_MULTIPLIER);
  let result;
  try {
    result = await pool.query(
      `INSERT INTO crash_rounds
        (id, seed_hash, server_seed, crash_point, status, house_edge, max_multiplier, doubling_seconds)
       VALUES ($1, $2, $3, $4, 'betting', $5, $6, $7) RETURNING *`,
      [
        id, seedHash, serverSeed, crashPoint.toFixed(2),
        env.HOUSE_EDGE, env.MAX_MULTIPLIER, env.DOUBLING_SECONDS,
      ],
    );
  } catch (err) {
    // Only one betting/running round may exist. An operator-created round can
    // race a scheduled one; reuse the winner instead of failing the tick.
    if (err.code !== "23505") throw err;
    const existing = await pool.query(
      `SELECT * FROM crash_rounds WHERE status IN ('betting','running')
        ORDER BY created_at DESC LIMIT 1`,
    );
    if (!existing.rowCount) throw err;
    result = existing;
  }
  const round = result.rows[0];
  await publish("crash.round_created", {
    id: round.id,
    seedHash: round.seed_hash,
    bettingMs: env.BETTING_WINDOW_MS,
    doublingSeconds: roundConfig(round).doublingSeconds,
  });
  later(() => startRound(round.id), env.BETTING_WINDOW_MS);
  return round;
}

async function startRound(id) {
  const result = await pool.query(
    `UPDATE crash_rounds SET status = 'running', started_at = now()
     WHERE id = $1 AND status = 'betting' RETURNING *`,
    [id],
  );
  if (!result.rowCount) return;
  const round = result.rows[0];
  await publish("crash.round_started", {
    id,
    seedHash: round.seed_hash,
    doublingSeconds: roundConfig(round).doublingSeconds,
  });
  const duration = crashDurationMs(Number(round.crash_point), roundConfig(round).doublingSeconds);
  later(() => finishRound(id), Math.ceil(duration) + 40);
}

// ---------------------------------------------------------------------------
// Reservation-first bet placement and recovery.
//
// Invariants:
//   * a bet row exists before any wallet call, so every debit has a bet to
//     reconcile against;
//   * the round row is locked while reserving, so betting cannot close mid-insert;
//   * a bet row is never replaced on retry, so its wallet keys stay stable;
//   * all wallet keys are deterministic per bet, so retries never double-pay.
// ---------------------------------------------------------------------------

async function reserveBet(roundId, userId, amount, autoCashout, sessionId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const round = await client.query(
      `SELECT * FROM crash_rounds
        WHERE id = $1 AND status = 'betting'
          AND created_at > now() - ($2 * INTERVAL '1 millisecond')
        FOR UPDATE`,
      [roundId, env.BETTING_WINDOW_MS],
    );
    if (!round.rowCount) {
      await client.query("ROLLBACK");
      return { error: [409, ERROR_CODES.CONFLICT, "betting is closed for this round"] };
    }
    // A retry after an ambiguous response must reuse the original claim (and
    // therefore its wallet keys). Never DELETE and re-INSERT here: a fresh bet
    // id would give the wallet a fresh key and could book a second wager for
    // a debit that had already committed.
    const existing = await client.query(
      `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 FOR UPDATE`,
      [roundId, userId],
    );
    if (existing.rowCount) {
      const prior = existing.rows[0];
      if (prior.status === "pending") {
        await client.query("COMMIT");
        return { bet: prior, retry: true };
      }
      if (prior.status === "cancelled") {
        // A definitive rejection recorded no debit. Reusing the same row lets
        // a player retry after topping up without minting another wallet key,
        // but that key is frozen to the stored economics: accepting a changed
        // amount/target/session would charge the new stake against the old key.
        const priorAuto = prior.auto_cashout === null ? null : Number(prior.auto_cashout);
        const wantedAuto = autoCashout ?? null;
        if (
          Number(prior.amount) !== amount ||
          priorAuto !== wantedAuto ||
          (prior.session_id ?? null) !== (sessionId ?? null)
        ) {
          await client.query("COMMIT");
          return {
            error: [
              409,
              ERROR_CODES.CONFLICT,
              "stake details changed; retry with the original amount and target",
            ],
          };
        }
        const revived = await client.query(
          `UPDATE crash_bets SET status = 'pending', settled_at = NULL
            WHERE id = $1 AND status = 'cancelled' RETURNING *`, [prior.id]);
        await client.query("COMMIT");
        if (revived.rowCount) return { bet: revived.rows[0], retry: true };
      }
      await client.query("COMMIT");
      // A refunded stake was already returned; reactivating it would be a free
      // bet, and inserting a new claim would duplicate the net-zero ledger pair.
      const message = prior.status === "refunded"
        ? "stake was refunded; betting is closed"
        : "already bet on this round";
      return { error: [409, ERROR_CODES.CONFLICT, message] };
    }
    const betId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO crash_bets
        (id, round_id, session_id, user_id, amount, auto_cashout, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (round_id, user_id) DO NOTHING RETURNING *`,
      [betId, roundId, sessionId ?? null, userId, toMoney(amount),
        autoCashout === undefined ? null : autoCashout.toFixed(2), `crash-bet-${betId}`],
    );
    if (!inserted.rowCount) {
      // A concurrent request won the insert race; read its committed claim.
      const winner = await client.query(
        `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 FOR UPDATE`,
        [roundId, userId],
      );
      await client.query("COMMIT");
      const prior = winner.rows[0];
      if (prior?.status === "pending") return { bet: prior, retry: true };
      return { error: [409, ERROR_CODES.CONFLICT, "already bet on this round"] };
    }
    await client.query("COMMIT");
    return { bet: inserted.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function activateReservedBet(bet) {
  // The activation carries the same betting-window guard as the reservation:
  // a bet must never become live after the round has started.
  const activated = await pool.query(
    `UPDATE crash_bets b SET status = 'active', settled_at = NULL
      WHERE b.id = $1 AND b.status = 'pending'
        AND EXISTS (SELECT 1 FROM crash_rounds r
                     WHERE r.id = b.round_id AND r.status = 'betting'
                       AND r.created_at > now() - ($2 * INTERVAL '1 millisecond'))
      RETURNING b.*`,
    [bet.id, env.BETTING_WINDOW_MS],
  );
  if (activated.rowCount) return { bet: activated.rows[0] };
  const fresh = await pool.query(`SELECT * FROM crash_bets WHERE id = $1`, [bet.id]);
  // A losing/refunded/cancelled row must never be reported as a placed bet;
  // only a still-pending row can be a safe idempotent retry.
  if (fresh.rows[0]?.status === "pending") return { bet: fresh.rows[0], retry: true };
  return { error: [409, ERROR_CODES.CONFLICT, "betting is closed for this round"] };
}

async function refundBet(bet, { ensureDebit = true } = {}) {
  try {
    if (ensureDebit) {
      // A pending bet may have been abandoned before the wallet call. Replay
      // the debit with this bet's deterministic key first so a refund can
      // never mint new credits or create a second net-zero tx pair on retry.
      await walletDebit(bet);
    }
    await walletRefund(bet);
    await pool.query(
      `UPDATE crash_bets SET status = 'refunded', settled_at = now()
        WHERE id = $1 AND status IN ('pending','active','cancelled')`,
      [bet.id],
    );
  } catch (err) {
    app.log.error({ err, betId: bet.id }, "crash stake refund failed; bet stays reconcilable");
    throw err;
  }
}

/** Retry interrupted stake moves and replay in-flight win credits. Everything
 * here is idempotent, so it is safe on boot and on a periodic timer. */
async function reconcileUnsettled() {
  const pending = await pool.query(
    `SELECT b.*, r.status AS round_status, r.created_at AS round_created_at
       FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE b.status = 'pending'`,
  );
  for (const bet of pending.rows) {
    try {
      if (bettingDeadlinePassed({ status: bet.round_status, created_at: bet.round_created_at })) {
        await refundBet(bet);
        continue;
      }
      await walletDebit(bet);
      const activation = await activateReservedBet(bet);
      if (activation.error) await refundBet(bet);
    } catch (err) {
      if (definitiveWalletRejection(err) && err.status === 409) {
        // Definitive "insufficient balance": no debit was recorded.
        await pool.query(
          `UPDATE crash_bets SET status = 'cancelled', settled_at = now()
            WHERE id = $1 AND status = 'pending'`, [bet.id]);
      } else {
        app.log.warn({ err, betId: bet.id }, "pending crash bet kept for reconciliation");
      }
    }
  }
  // Migration 0010 cancels older live rounds directly in SQL, so their already
  // debited `active` bets never pass through cancelRound()'s refund loop and
  // can no longer be cashed out (the round is no longer running). Sweep them
  // with the same deterministic refund claim instead of leaving stakes stuck.
  const cancelledRoundBets = await pool.query(
    `SELECT b.* FROM crash_bets b
       JOIN crash_rounds r ON r.id = b.round_id
      WHERE r.status = 'cancelled' AND b.status IN ('pending','active')`,
  );
  for (const bet of cancelledRoundBets.rows) {
    try {
      await refundBet(bet);
    } catch (err) {
      if (definitiveWalletRejection(err) && err.status === 409) {
        // No debit was ever recorded for this pending claim: close it without
        // minting a refund credit.
        await pool.query(
          `UPDATE crash_bets SET status = 'cancelled', settled_at = now()
            WHERE id = $1 AND status = 'pending'`, [bet.id]);
      } else {
        app.log.warn({ err, betId: bet.id }, "cancelled round bet kept for refund reconciliation");
      }
    }
  }

  const cashing = await pool.query(`SELECT * FROM crash_bets WHERE status = 'cashing_out'`);
  for (const bet of cashing.rows) {
    try {
      // Stored payout, not a recomputed multiplier: the credited amount is
      // exactly the amount that was committed before the process died.
      await finalizeCashout(bet);
    } catch (err) {
      app.log.warn({ err, betId: bet.id }, "cash-out replay kept in flight");
    }
  }
}

/** Replay a credited-but-not-finalised cash-out. The wallet key makes this
 * safe to repeat, and boot recovery uses it to finish interrupted payouts. */
async function finalizeCashout(bet) {
  const payout = Number(bet.payout);
  const multiplier = Number(bet.cashout_at);
  if (!Number.isFinite(payout) || payout <= 0 || !Number.isFinite(multiplier))
    throw new Error(`incomplete cash-out claim for bet ${bet.id}`);
  await walletCredit(bet, payout);
  const settled = await pool.query(
    `UPDATE crash_bets SET status = 'cashed_out', settled_at = now()
      WHERE id = $1 AND status = 'cashing_out' RETURNING id`,
    [bet.id],
  );
  if (!settled.rowCount) {
    // A concurrent reconciler may already have finalised the same wallet key.
    const fresh = await pool.query(`SELECT status FROM crash_bets WHERE id = $1`, [bet.id]);
    if (fresh.rows[0]?.status !== "cashed_out")
      throw new Error(`cash-out finalisation failed for bet ${bet.id}`);
    return payout;
  }
  // Broadcast only public fields. Realtime versions before topic-aware
  // redaction must not be able to leak another player's identity or payout.
  await publish("crash.cashout", {
    id: bet.id,
    roundId: bet.round_id,
    multiplier,
  });
  return payout;
}

/**
 * Claim an active bet for cash-out under row locks, then credit it with a
 * deterministic key. `cashing_out` is an explicit in-flight state so a failed
 * wallet call never leaves a paid bet looking active (and later marked lost).
 * Returns { error } for rejected calls, null when another path won the race.
 */
async function cashoutBet(bet, requestedMultiplier, { userId } = {}) {
  const client = await pool.connect();
  let claim;
  let multiplier;
  let payout;
  try {
    await client.query("BEGIN");
    // Lock the round so finishRound cannot settle the bet while we are
    // deciding whether the deadline is still open.
    const roundResult = await client.query(
      `SELECT * FROM crash_rounds WHERE id = $1 FOR UPDATE`, [bet.round_id]);
    const round = roundResult.rows[0];
    if (!round) {
      await client.query("ROLLBACK");
      return { error: [404, ERROR_CODES.NOT_FOUND, "round not found"] };
    }
    // No post-crash grace: the multiplier is capped at the published crash
    // point, so even a few hundred ms of tolerance would pay a losing bet.
    if (round.status !== "running" || roundPastDeadline(round, 0)) {
      await client.query("ROLLBACK");
      return { error: [409, ERROR_CODES.CONFLICT, "round is not running"] };
    }
    const locked = await client.query(
      `SELECT * FROM crash_bets WHERE id = $1 FOR UPDATE`, [bet.id]);
    const current = locked.rows[0];
    if (!current || (userId && current.user_id !== userId)) {
      await client.query("ROLLBACK");
      return { error: [404, ERROR_CODES.NOT_FOUND, "no bet on this round"] };
    }
    if (current.status === "cashed_out") {
      await client.query("ROLLBACK");
      return { error: [409, ERROR_CODES.CONFLICT, "already cashed out"] };
    }
    if (current.status === "cashing_out") {
      // Reconciliation owns this bet; replaying the same key is safe.
      await client.query("ROLLBACK");
      return { pending: true };
    }
    if (current.status !== "active") {
      await client.query("ROLLBACK");
      return { error: [409, ERROR_CODES.CONFLICT, "bet is no longer active"] };
    }
    const live = liveMultiplier(round);
    if (live === null || live < 1) {
      await client.query("ROLLBACK");
      return { error: [409, ERROR_CODES.CONFLICT, "cash-out is not available"] };
    }
    // A manual cash-out uses the live multiplier; auto cash-outs pass their
    // configured trigger. Never pay more than the live value or crash point.
    const requested = requestedMultiplier === undefined ? live : Number(requestedMultiplier);
    multiplier = Math.round(Math.min(requested, live, Number(round.crash_point)) * 100) / 100;
    if (multiplier < 1) {
      await client.query("ROLLBACK");
      return { error: [409, ERROR_CODES.CONFLICT, "cash-out is not available"] };
    }
    payout = Number(toMoney(moneyMul(current.amount, multiplier.toFixed(2))));
    const claimed = await client.query(
      `UPDATE crash_bets SET status = 'cashing_out', cashout_at = $2, payout = $3,
         settled_at = NULL
        WHERE id = $1 AND status = 'active' RETURNING *`,
      [current.id, multiplier.toFixed(2), toMoney(payout)],
    );
    if (!claimed.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    claim = claimed.rows[0];
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  try {
    await finalizeCashout(claim);
  } catch (err) {
    // Only a definitive wallet rejection proves no money moved. Ambiguous
    // failures (4xx with an unparseable body, 5xx, transport errors) keep
    // `cashing_out` so boot/periodic replay uses the same key.
    if (definitiveWalletRejection(err)) {
      await pool.query(
        `UPDATE crash_bets SET status = 'active', cashout_at = NULL, payout = NULL,
           settled_at = NULL WHERE id = $1 AND status = 'cashing_out'`, [claim.id]);
    }
    throw err;
  }
  return { payout, multiplier };
}

async function finishRound(id, scheduleNext = true) {
  const client = await pool.connect();
  let round;
  let losers = [];
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM crash_rounds WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!locked.rowCount || locked.rows[0].status !== "running") {
      await client.query("ROLLBACK");
      return;
    }
    round = locked.rows[0];
    // Only truly active bets become losers. `cashing_out` bets have a payout
    // already committed in the ledger and are owned by boot reconciliation.
    const active = await client.query(
      `SELECT id, user_id, round_id, amount FROM crash_bets
        WHERE round_id = $1 AND status = 'active' FOR UPDATE`,
      [id],
    );
    losers = active.rows;
    await client.query(
      `UPDATE crash_bets SET status = 'lost', settled_at = now()
        WHERE round_id = $1 AND status = 'active'`,
      [id],
    );
    await client.query(
      `UPDATE crash_rounds SET status = 'finished', finished_at = now() WHERE id = $1`,
      [id],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    app.log.error({ err }, "crash round finish failed");
    throw err;
  } finally {
    client.release();
  }

  const proof = verifyRound(round);
  await publish("crash.round_finished", {
    id: round.id,
    crashPoint: Number(round.crash_point),
    serverSeed: round.server_seed,
    seedHash: round.seed_hash,
    valid: proof?.valid ?? false,
    losers: losers.map((bet) => bet.id),
  });
  if (scheduleNext) later(() => createRound(), env.ROUND_GAP_MS);
}

/** Cancel a betting round that outlived its window (e.g. across a restart). */
async function cancelRound(id) {
  const result = await pool.query(
    `UPDATE crash_rounds SET status = 'cancelled', finished_at = now()
      WHERE id = $1 AND status = 'betting' RETURNING *`, [id]);
  if (!result.rowCount) return null;
  const round = result.rows[0];
  const open = await pool.query(
    `SELECT * FROM crash_bets WHERE round_id = $1 AND status IN ('pending','active')`, [id]);
  for (const bet of open.rows) {
    try {
      await refundBet(bet);
    } catch (err) {
      app.log.error({ err, betId: bet.id }, "cancelled round bet could not be refunded");
    }
  }
  await publish("crash.round_cancelled", {
    id: round.id,
    seedHash: round.seed_hash,
    crashPoint: round.crash_point === null ? null : Number(round.crash_point),
    valid: verifyRound(round)?.valid ?? false,
  });
  return round;
}

/** DB-derived reconciliation: timers may be gone after a restart, but the
 * persisted started_at/created_at still prove a round's deadline. */
async function reconcileStaleRounds() {
  const live = await pool.query(
    `SELECT * FROM crash_rounds WHERE status IN ('betting','running')
      ORDER BY created_at DESC`);
  let kept = null;
  for (const round of live.rows) {
    const stale = round.status === "running" ? roundHasCrashed(round) : bettingDeadlinePassed(round);
    if (stale) {
      if (round.status === "running") await finishRound(round.id, false);
      else await cancelRound(round.id);
    } else if (!kept) {
      kept = round; // at most one live round is allowed by the DB partial index
    } else {
      await cancelRound(round.id);
    }
  }
  return kept;
}

function scheduleRoundDeadlines(round) {
  const deadline = roundDeadline(round);
  if (deadline === null) return;
  const delay = Math.max(50, deadline - Date.now());
  if (round.status === "betting") later(() => startRound(round.id), delay);
  else if (round.status === "running") later(() => finishRound(round.id), delay);
}

/** Finish/cancel stale rows first, then make sure exactly one live round exists. */
async function ensureCurrentRound() {
  const current = await reconcileStaleRounds();
  if (current) {
    scheduleRoundDeadlines(current);
    return current;
  }
  try {
    return await createRound();
  } catch (err) {
    if (err.code === "23505") {
      // A concurrent process won the single-live-round index race.
      const existing = await pool.query(
        `SELECT * FROM crash_rounds WHERE status IN ('betting','running')
          ORDER BY created_at DESC LIMIT 1`);
      if (existing.rowCount) {
        scheduleRoundDeadlines(existing.rows[0]);
        return existing.rows[0];
      }
    }
    throw err;
  }
}

/** Auto cash-outs for all running rounds, driven by a short polling tick.
 * Each bet is paid at its own configured target — never the poll's current
 * multiplier — and only while the round is still below its crash point. */
async function tick() {
  const rounds = await pool.query(
    `SELECT * FROM crash_rounds WHERE status = 'running' ORDER BY started_at DESC`,
  );
  for (const round of rounds.rows) {
    if (roundHasCrashed(round)) continue;
    const multiplier = liveMultiplier(round);
    if (multiplier === null) continue;
    const crashPoint = Number(round.crash_point);
    // Keyset pagination: a batch can never be silently truncated at 50, and
    // rows already settled by this tick cannot be skipped by an OFFSET.
    let cursor = null;
    for (;;) {
      const params = [round.id, multiplier.toFixed(2), crashPoint];
      let where =
        `round_id = $1 AND status = 'active' AND auto_cashout IS NOT NULL
          AND auto_cashout <= $2 AND auto_cashout < $3`;
      if (cursor) {
        params.push(cursor.autoCashout, cursor.id);
        where += ` AND (auto_cashout, id) > ($4, $5)`;
      }
      const due = await pool.query(
        `SELECT * FROM crash_bets WHERE ${where} ORDER BY auto_cashout, id LIMIT 100`,
        params,
      );
      if (!due.rowCount) break;
      for (const bet of due.rows) {
        try {
          // tick() already runs inside the serialized lifecycle chain. Calling
          // serialized() here would deadlock against the running tick itself.
          await cashoutBet(bet, Number(bet.auto_cashout));
        } catch (err) {
          app.log.warn({ err, betId: bet.id }, "auto cash-out will be retried");
        }
      }
      const last = due.rows[due.rowCount - 1];
      cursor = { autoCashout: last.auto_cashout, id: last.id };
      if (due.rowCount < 100) break;
    }
  }
}

// ---------------------------------------------------------------------------
// Player API
// ---------------------------------------------------------------------------

app.get("/v1/crash/rounds/current", async (_req, reply) => {
  const result = await pool.query(
    `SELECT * FROM crash_rounds
      WHERE status IN ('betting','running') ORDER BY created_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return ok(reply, 200, {
    round: row ? { ...publicRound(row), multiplier: publicMultiplier(row) } : null,
  });
});

app.get("/v1/crash/rounds/history", async (req, reply) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
  const result = await pool.query(
    `SELECT * FROM crash_rounds WHERE status IN ('finished','cancelled')
      ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT $1`,
    [limit],
  );
  return ok(reply, 200, { items: result.rows.map(publicRound) });
});

app.get("/v1/crash/rounds/:id", async (req, reply) => {
  const { id } = req.params;
  const result = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [id]);
  if (!result.rowCount) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "round not found");
  const row = result.rows[0];
  const round = { ...publicRound(row), multiplier: publicMultiplier(row) };
  const userId = await requestUserId(req);
  let myBet = null;
  if (userId) {
    const bet = await pool.query(
      `SELECT id, amount, auto_cashout, cashout_at, payout, status, created_at
        FROM crash_bets WHERE round_id = $1 AND user_id = $2`,
      [id, userId],
    );
    myBet = bet.rows[0] ?? null;
  }
  return ok(reply, 200, { round, myBet });
});

const BetSchema = z.object({
  amount: z.coerce.number().positive().finite(),
  autoCashout: z.coerce.number().min(1.01).max(1000).optional(),
  // The game-engine session this wager belongs to. Used only to anchor a
  // verified leaderboard score; it never influences the crash outcome.
  sessionId: z.string().uuid().optional(),
});

app.post("/v1/crash/rounds/:id/bets", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const parsed = BetSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));
  const { amount, autoCashout, sessionId } = parsed.data;
  if (amount < env.MIN_BET || amount > env.MAX_BET)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "bet amount out of range");

  // Fail-closed self-exclusion gate: no stake may be reserved for a player the
  // RG service has excluded (or cannot confirm is eligible).
  if (!(await wageringAllowed(userId, amount)))
    return deny(reply, 403, ERROR_CODES.FORBIDDEN, "wagering is not allowed for this player");

  const roundResult = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
  const round = roundResult.rows[0];
  if (!round) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "round not found");
  if (round.status !== "betting")
    return deny(reply, 409, ERROR_CODES.CONFLICT, "betting is closed for this round");

  // Reservation and status guard are one DB transaction; the wallet debit
  // follows only once the bet row is durably committed as `pending`.
  const reserved = await reserveBet(round.id, userId, amount, autoCashout, sessionId);
  if (reserved.error) return deny(reply, ...reserved.error);
  let bet = reserved.bet;

  try {
    // Use the STORED claim, not the request body: a replay cannot change the
    // stake, wallet key or identity it is reconciling. walletDebit retries an
    // ambiguous response with this same key, so a committed debit is returned
    // as the original wallet transaction instead of being booked again.
    await walletDebit(bet);
  } catch (err) {
    if (definitiveWalletRejection(err)) {
      // Definitive rejection: no debit happened, so no refund is needed.
      await pool.query(
        `UPDATE crash_bets SET status = 'cancelled', settled_at = now()
          WHERE id = $1 AND status = 'pending'`, [bet.id]);
      return deny(reply, 409, ERROR_CODES.CONFLICT, "insufficient balance");
    }
    req.log.error({ err, betId: bet.id }, "crash bet debit is ambiguous");
    return deny(
      reply,
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      "bet is pending; retry this request to reconcile",
      { idempotencyKey: debitKey(bet), betId: bet.id, ambiguous: err instanceof WalletAmbiguousError },
    );
  }

  const activation = await activateReservedBet(bet);
  if (activation.error) {
    // Betting closed after the debit (timer or restart). Compensate with an
    // idempotent refund; the row is marked refunded only after credit lands.
    try {
      await refundBet(bet);
    } catch {
      // The error is logged in refundBet; reconciliation will retry.
    }
    return deny(reply, ...activation.error);
  }
  bet = activation.bet;
  await publish("crash.bet", {
    id: bet.id,
    roundId: round.id,
    status: bet.status,
  });
  return ok(reply, 201, {
    bet: {
      id: bet.id,
      amount: Number(bet.amount),
      autoCashout: bet.auto_cashout === null ? null : Number(bet.auto_cashout),
      status: bet.status,
    },
  });
});

app.post("/v1/crash/rounds/:id/cashout", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  let payout;
  let pendingBet = null;
  try {
    payout = await serialized(async () => {
      const roundResult = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
      const round = roundResult.rows[0];
      if (!round) return { error: [404, ERROR_CODES.NOT_FOUND, "round not found"] };
      const betResult = await pool.query(
        `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2`,
        [round.id, userId],
      );
      const bet = betResult.rows[0];
      if (!bet) return { error: [404, ERROR_CODES.NOT_FOUND, "no bet on this round"] };
      pendingBet = bet;
      // An interrupted credit can be finalized even after the round ends.
      if (bet.status === "cashing_out") {
        const value = await finalizeCashout(bet);
        return { value, multiplier: Number(bet.cashout_at) };
      }
      if (bet.status === "cashed_out")
        return { error: [409, ERROR_CODES.CONFLICT, "already cashed out"] };
      // Status, deadline and bet state are re-checked under Postgres row locks
      // inside cashoutBet; these reads only shape the user-facing error.
      if (round.status !== "running")
        return { error: [409, ERROR_CODES.CONFLICT, "round is not running"] };
      const multiplier = liveMultiplier(round);
      if (multiplier === null || multiplier < 1.01)
        return { error: [409, ERROR_CODES.CONFLICT, "cash-out is not available"] };
      const outcome = await cashoutBet(bet, undefined, { userId });
      if (outcome?.error) return { error: outcome.error };
      if (!outcome || outcome.pending)
        return { error: [409, ERROR_CODES.CONFLICT, "bet is no longer active"] };
      return { value: outcome.payout, multiplier: outcome.multiplier };
    });
  } catch (err) {
    req.log.error({ err }, "crash cash-out is ambiguous");
    return deny(
      reply,
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      "cash-out could not be confirmed; retry this request to reconcile",
      {
        idempotencyKey: pendingBet ? creditKey(pendingBet) : null,
        betId: pendingBet?.id ?? null,
        ambiguous: err instanceof WalletAmbiguousError,
      },
    );
  }
  if (payout.error) return deny(reply, payout.error[0], payout.error[1], payout.error[2]);
  return ok(reply, 200, { payout: payout.value, multiplier: payout.multiplier });
});

app.get("/v1/crash/me/bets", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 100);
  const result = await pool.query(
    `SELECT id, round_id, amount, auto_cashout, cashout_at, payout, status, created_at, settled_at
      FROM crash_bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return ok(reply, 200, { items: result.rows });
});

// ---------------------------------------------------------------------------
// Strategy lab: the vendored betting bot, replayed safely against our own
// provably-fair number generator with paper credits only.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRATEGIES = ["flat", "martingale", "fibonacci", "paroli"];

function simulate(strategy, rounds, stake, target, rng) {
  let bankroll = 1000;
  let peak = bankroll;
  let maxDrawdown = 0;
  let step = 0;
  let consecutiveWins = 0;
  let fib = [1, 1];
  for (let i = 0; i < rounds; i += 1) {
    const rawWager = strategy === "flat" ? stake
      : strategy === "martingale" ? stake * 2 ** step
        : strategy === "fibonacci" ? stake * fib[Math.min(step, fib.length - 1)]
          : stake * 2 ** consecutiveWins;
    const wager = Math.min(bankroll, Math.max(stake, Number(toMoney(rawWager))));
    if (wager > bankroll || wager <= 0) break;
    bankroll -= wager;
    // Use the live generator's exact distribution so the lab is a faithful
    // replay rather than an approximation with a different rounding rule.
    const crash = pointFromUnit(rng(), env.HOUSE_EDGE, env.MAX_MULTIPLIER);
    const cashed = Math.min(target, crash);
    if (target <= crash) {
      bankroll += Number(toMoney(moneyMul(wager, cashed.toFixed(2))));
    }
    if (strategy === "martingale") step = target <= crash ? 0 : step + 1;
    else if (strategy === "fibonacci") {
      if (target <= crash) { step = Math.max(0, step - 2); fib = [1, 1]; for (let k = 1; k < step; k += 1) fib.push(fib[k - 1] + fib[k]); }
      else { step += 1; if (step >= fib.length) fib.push(fib[fib.length - 1] + fib[fib.length - 2]); }
    } else if (strategy === "paroli") consecutiveWins = target <= crash ? consecutiveWins + 1 : 0;
    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, peak - bankroll);
  }
  return {
    strategy,
    finalBankroll: Number(toMoney(bankroll)),
    profit: Number(toMoney(bankroll - 1000)),
    maxDrawdown: Number(toMoney(maxDrawdown)),
    busted: bankroll < stake,
  };
}

const LabSchema = z.object({
  seed: z.string().min(1).max(128),
  rounds: z.coerce.number().int().min(10).max(10000).default(1000),
  stake: z.coerce.number().positive().max(1000).default(10),
  target: z.coerce.number().min(1.01).max(100).default(2),
  strategies: z.array(z.enum(STRATEGIES)).min(1).default(STRATEGIES),
});

app.post("/v1/crash/strategy-lab/run", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const parsed = LabSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));
  const { seed, rounds, stake, target, strategies } = parsed.data;
  const seedNumber = createHash("sha256").update(`${userId}:${seed}`).digest().readUInt32BE(0);
  const results = strategies.map((strategy) =>
    simulate(strategy, rounds, stake, target, mulberry32(seedNumber)),
  );
  return ok(reply, 200, {
    seed,
    rounds,
    stake,
    target,
    paperOnly: true,
    note: "Simulated with the platform's own provably-fair generator. No real bets, no external sites.",
    results,
  });
});

// ---------------------------------------------------------------------------
// Restart recovery. A process stop must never strand an in-flight debit,
// credit, or running round. Every step is idempotent, so recovery can be
// replayed safely after another crash. The detailed helpers live next to the
// lifecycle code above so the deadline rules stay in one place.
// ---------------------------------------------------------------------------

async function recover() {
  // Money first: replay/reverse in-flight bets using their stored amounts and
  // keys. Then derive round state from timestamps, then open a fresh round.
  await reconcileUnsettled();
  await ensureCurrentRound();
}

// ---------------------------------------------------------------------------
// Capability-scoped lifecycle API (used by operators / smoke tests)
// ---------------------------------------------------------------------------

app.post("/internal/crash/rounds", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.CRASH_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  const round = await serialized(() => ensureCurrentRound());
  return ok(reply, 201, { round: publicRound(round) });
});

app.post("/internal/crash/rounds/:id/start", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.CRASH_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  await serialized(() => startRound(req.params.id));
  return ok(reply, 200, { started: true });
});

app.post("/internal/crash/rounds/:id/finish", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.CRASH_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  await serialized(() => finishRound(req.params.id));
  return ok(reply, 200, { finished: true });
});

app.get("/internal/crash/rounds/:id/verify", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.CRASH_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  const result = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
  if (!result.rowCount) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "round not found");
  const proof = verifyRound(result.rows[0]);
  if (!proof) return deny(reply, 409, ERROR_CODES.CONFLICT, "round has not been revealed");
  return ok(reply, 200, { proof });
});

// ---------------------------------------------------------------------------
// Probes and bootstrap
// ---------------------------------------------------------------------------

app.get("/health", async () => ({ status: "ok", service: "crash" }));
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
  await serialized(recover);
  const active = await pool.query(
    `SELECT 1 FROM crash_rounds WHERE status IN ('betting','running') LIMIT 1`,
  );
  if (!active.rowCount) await serialized(() => createRound());
  const ticker = setInterval(() => void serialized(tick), 100);
  ticker.unref?.();
  // Keep retrying any bet left in flight by an ambiguous wallet response;
  // all keys are deterministic, so repeated replays are harmless.
  const reconciler = setInterval(
    () => void serialized(reconcileUnsettled).catch((err) =>
      app.log.warn({ err }, "crash reconciliation tick failed")),
    UNSETTLED_RECONCILE_MS,
  );
  reconciler.unref?.();
} catch (err) {
  app.log.error({ err }, "crash failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}
