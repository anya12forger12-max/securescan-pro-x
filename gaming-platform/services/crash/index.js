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
 * cash-outs credit it with an idempotency key derived from the bet id, so an
 * ambiguous HTTP response can be replayed without paying twice.
 *
 * The only identity accepted from the browser is a signed player JWT. Internal
 * lifecycle calls require the crash-scoped capability token, and wallet /
 * realtime calls use their own scoped tokens — never a shared secret.
 */
const envSchema = baseEnvSchema.extend({
  ...capabilityFields(
    "SERVICE_TOKEN",
    "CRASH_SERVICE_TOKEN",
    "WALLET_SERVICE_TOKEN",
    "REALTIME_SERVICE_TOKEN",
  ),
  PORT: z.coerce.number().int().positive().default(3023),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WALLET_INTERNAL_URL: z.string().url().default("http://wallet:3011"),
  REALTIME_INTERNAL_URL: z.string().url().default("http://realtime:3010"),
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
const deny = (reply, status, code, message) =>
  reply.code(status).send({
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    error: { code, message },
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

/** Deterministic, verifiable crash point derived from (serverSeed, roundId). */
export function crashPointFor(serverSeed, roundId, houseEdge, maxMultiplier) {
  const u = hmacUnit(serverSeed, roundId);
  if (u < houseEdge) return 1;
  const normalised = (u - houseEdge) / (1 - houseEdge);
  // 1/(1-p) gives the familiar heavy tail: most rounds end near 1-2x, with
  // rare long flights. Clamp before rounding so the published value is exact.
  const raw = Math.min(maxMultiplier, 1 / (1 - normalised * 0.99));
  return Math.max(1, Math.floor(raw * 100) / 100);
}

function multiplierAt(elapsedMs) {
  return Math.pow(2, Math.max(0, elapsedMs) / (env.DOUBLING_SECONDS * 1000));
}

function crashDurationMs(crashPoint) {
  return Math.max(0, env.DOUBLING_SECONDS * 1000 * Math.log2(crashPoint));
}

function verifyRound(round) {
  if (!round.server_seed || !round.crash_point) return null;
  const expected = crashPointFor(round.server_seed, round.id, env.HOUSE_EDGE, env.MAX_MULTIPLIER);
  return {
    serverSeed: round.server_seed,
    seedHash: createHash("sha256").update(round.server_seed).digest("hex"),
    crashPoint: Number(round.crash_point),
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

function liveMultiplier(row) {
  if (row.status !== "running" || !row.started_at) return null;
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  return Math.round(Math.min(multiplierAt(elapsed), Number(row.crash_point)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Scoped inter-service clients
// ---------------------------------------------------------------------------

async function walletRequest(path, body, attempt = 0) {
  const response = await fetchWithTimeout(
    `${env.WALLET_INTERNAL_URL}${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-token": env.WALLET_SERVICE_TOKEN,
      },
      body: JSON.stringify(body),
    },
    5000,
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = new Error(payload?.error?.message ?? `wallet returned ${response.status}`);
    err.status = response.status;
    err.code = payload?.error?.code;
    if (response.status >= 500 && attempt < 2) return walletRequest(path, body, attempt + 1);
    throw err;
  }
  return payload?.data ?? payload;
}

const walletDebit = (userId, amount, roundId, betId) =>
  walletRequest("/internal/wallet/debit", {
    userId,
    amount,
    referenceType: "crash_bet",
    referenceId: roundId,
    idempotencyKey: `crash-debit-${betId}`,
  });

const walletCredit = (userId, amount, betId) =>
  walletRequest("/internal/wallet/credit", {
    userId,
    amount,
    type: "win",
    referenceType: "crash_bet",
    referenceId: betId,
    idempotencyKey: `crash-credit-${betId}`,
  });

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
    if (!stopping) void serialized(fn);
  }, ms);
  timers.add(timer);
  return timer;
}

async function createRound() {
  const serverSeed = randomBytes(32).toString("hex");
  const seedHash = createHash("sha256").update(serverSeed).digest("hex");
  const id = randomUUID();
  const crashPoint = crashPointFor(serverSeed, id, env.HOUSE_EDGE, env.MAX_MULTIPLIER);
  const result = await pool.query(
    `INSERT INTO crash_rounds (id, seed_hash, server_seed, crash_point, status)
     VALUES ($1, $2, $3, $4, 'betting') RETURNING *`,
    [id, seedHash, serverSeed, crashPoint.toFixed(2)],
  );
  const round = result.rows[0];
  await publish("crash.round_created", {
    id: round.id,
    seedHash: round.seed_hash,
    bettingMs: env.BETTING_WINDOW_MS,
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
  await publish("crash.round_started", { id, seedHash: round.seed_hash });
  const duration = crashDurationMs(Number(round.crash_point));
  later(() => finishRound(id), Math.ceil(duration) + 40);
}

async function cashoutBet(bet, multiplier) {
  const payout = Number(toMoney(moneyMul(bet.amount, multiplier.toFixed(2))));
  // Credit FIRST with a deterministic key. If the response is lost, the retry
  // replays the same wallet transaction instead of paying twice.
  await walletCredit(bet.user_id, payout, bet.id);
  await pool.query(
    `UPDATE crash_bets SET status = 'cashed_out', cashout_at = $2, payout = $3,
       settled_at = now() WHERE id = $1 AND status = 'active'`,
    [bet.id, multiplier.toFixed(2), toMoney(payout)],
  );
  await publish("crash.cashout", {
    id: bet.id,
    roundId: bet.round_id,
    userId: bet.user_id,
    multiplier: Number(multiplier.toFixed(2)),
    payout,
  });
  return payout;
}

async function finishRound(id) {
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
    losers: losers.map((bet) => ({ id: bet.id, userId: bet.user_id })),
  });
  later(() => createRound(), env.ROUND_GAP_MS);
}

/** Auto cash-outs for the running round, driven by a short polling tick. */
async function tick() {
  const result = await pool.query(
    `SELECT * FROM crash_rounds WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  );
  const round = result.rows[0];
  if (!round) return;
  const multiplier = liveMultiplier(round);
  if (multiplier === null) return;
  const due = await pool.query(
    `SELECT * FROM crash_bets
      WHERE round_id = $1 AND status = 'active' AND auto_cashout IS NOT NULL
        AND auto_cashout <= $2
      ORDER BY auto_cashout ASC LIMIT 50`,
    [round.id, multiplier.toFixed(2)],
  );
  for (const bet of due.rows) {
    try {
      await serialized(() => cashoutBet(bet, multiplier));
    } catch (err) {
      app.log.warn({ err, betId: bet.id }, "auto cash-out will be retried");
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
    round: row ? { ...publicRound(row), multiplier: liveMultiplier(row) } : null,
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
  const round = { ...publicRound(row), multiplier: liveMultiplier(row) };
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

  const roundResult = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
  const round = roundResult.rows[0];
  if (!round) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "round not found");
  if (round.status !== "betting")
    return deny(reply, 409, ERROR_CODES.CONFLICT, "betting is closed for this round");

  const betId = randomUUID();
  try {
    await walletDebit(userId, amount, round.id, betId);
  } catch (err) {
    if (err.status === 409) return deny(reply, 409, ERROR_CODES.CONFLICT, "insufficient balance");
    req.log.error({ err }, "crash bet debit failed");
    return deny(reply, 503, ERROR_CODES.SERVICE_UNAVAILABLE, "wallet is unavailable; no bet was placed");
  }

  let inserted;
  try {
    inserted = await pool.query(
      `INSERT INTO crash_bets
        (id, round_id, session_id, user_id, amount, auto_cashout, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (round_id, user_id) DO NOTHING RETURNING *`,
      [
        betId,
        round.id,
        sessionId ?? null,
        userId,
        toMoney(amount),
        autoCashout === undefined ? null : autoCashout.toFixed(2),
        `crash-bet-${betId}`,
      ],
    );
  } catch (err) {
    req.log.error({ err }, "crash bet insert failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "bet could not be recorded");
  }
  if (!inserted.rowCount) {
    // Concurrent duplicate: refund using a key tied to this request's bet id.
    // The original bet keeps the wallet debit under its own key.
    try {
      await walletCredit(userId, amount, betId);
    } catch (err) {
      req.log.error({ err }, "crash duplicate-bet refund failed");
    }
    return deny(reply, 409, ERROR_CODES.CONFLICT, "already bet on this round");
  }
  const bet = inserted.rows[0];
  await publish("crash.bet", {
    id: bet.id,
    roundId: round.id,
    userId,
    amount: Number(bet.amount),
    autoCashout: bet.auto_cashout === null ? null : Number(bet.auto_cashout),
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
  try {
    payout = await serialized(async () => {
      const roundResult = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
      const round = roundResult.rows[0];
      if (!round) return { error: [404, ERROR_CODES.NOT_FOUND, "round not found"] };
      if (round.status !== "running")
        return { error: [409, ERROR_CODES.CONFLICT, "round is not running"] };
      const betResult = await pool.query(
        `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2`,
        [round.id, userId],
      );
      const bet = betResult.rows[0];
      if (!bet) return { error: [404, ERROR_CODES.NOT_FOUND, "no bet on this round"] };
      if (bet.status === "cashed_out")
        return { error: [409, ERROR_CODES.CONFLICT, "already cashed out"] };
      if (bet.status !== "active")
        return { error: [409, ERROR_CODES.CONFLICT, "bet is no longer active"] };
      const multiplier = liveMultiplier(round);
      if (multiplier === null || multiplier < 1)
        return { error: [409, ERROR_CODES.CONFLICT, "cash-out is not available"] };
      const value = await cashoutBet(bet, multiplier);
      return { value, multiplier };
    });
  } catch (err) {
    req.log.error({ err }, "crash cash-out failed");
    return deny(reply, 503, ERROR_CODES.SERVICE_UNAVAILABLE, "wallet is unavailable; bet remains active");
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
    const wager = Math.min(bankroll, Math.max(stake, Math.round(
      strategy === "flat" ? stake
        : strategy === "martingale" ? stake * 2 ** step
          : strategy === "fibonacci" ? stake * fib[Math.min(step, fib.length - 1)]
            : stake * 2 ** consecutiveWins,
    )));
    if (wager > bankroll || wager <= 0) break;
    bankroll -= wager;
    const u = rng();
    const crash = u < env.HOUSE_EDGE ? 1 : Math.max(1, Math.min(env.MAX_MULTIPLIER,
      Math.floor((1 / (1 - ((u - env.HOUSE_EDGE) / (1 - env.HOUSE_EDGE)) * 0.99)) * 100) / 100));
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
// Capability-scoped lifecycle API (used by operators / smoke tests)
// ---------------------------------------------------------------------------

app.post("/internal/crash/rounds", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.CRASH_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  return ok(reply, 201, { round: publicRound(await createRound()) });
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
  await serialized(() => createRound());
  const ticker = setInterval(() => void serialized(tick), 100);
  ticker.unref?.();
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
