import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
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
  parseCorsOrigins,
  jwtVerifyEnvFields,
  jwtVerifyPluginOptions,
} from "@gp/config";
import { ERROR_CODES, boundedInt, moneyMul, serviceTokenOk, toMoney } from "@gp/shared-types";
import {
  CLIENT_SEED_ALGORITHM,
  FAIRNESS_ALGORITHM,
  PHASES,
  PROTOCOL_VERSION,
  buildFeed,
  buildSnapshot,
  crashPointFromRound,
  epochMs,
  maskPlayer,
  normalisePanel,
  phaseForRound,
  pointFromUnit,
  sanitizeSnapshot,
  verifyFairness,
  verifyRoundFairness,
} from "@gp/aviator";

// Re-exported for the strategy-lab tests and for scripts that import the
// generator directly. The implementation now lives in @gp/aviator so the
// engine and the public verifier share one formula.
export { pointFromUnit };
const crashPointFor = crashPointFromRound;

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
  ...capabilityFields("AUTH_SESSION_SERVICE_TOKEN"),
  WALLET_SERVICE_TOKEN: z.string().min(32).optional(),
  WALLET_DEBIT_SERVICE_TOKEN: z.string().min(32).optional(),
  WALLET_WIN_SERVICE_TOKEN: z.string().min(32).optional(),
  PORT: z.coerce.number().int().positive().default(3023),
  DATABASE_URL: z.string().min(1).url(),
  ...jwtVerifyEnvFields,
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WALLET_INTERNAL_URL: z.string().url().default("http://wallet:3011"),
  REALTIME_INTERNAL_URL: z.string().url().default("http://realtime:3010"),
  RESPONSIBLE_GAMING_URL: z.string().url().default("http://responsible-gaming:3012"),
  AUTH_INTERNAL_URL: z.string().url().default("http://auth:3015"),
  BETTING_WINDOW_MS: z.coerce.number().int().min(1000).max(120000).default(8000),
  ROUND_GAP_MS: z.coerce.number().int().min(250).max(60000).default(2500),
  DOUBLING_SECONDS: z.coerce.number().positive().min(0.5).max(30).default(3),
  HOUSE_EDGE: z.coerce.number().min(0).max(0.5).default(0.02),
  MAX_MULTIPLIER: z.coerce.number().positive().min(2).max(1000).default(100),
  MIN_BET: z.coerce.number().positive().default(1),
  MAX_BET: z.coerce.number().positive().default(10000),
  // Operator integration credentials. Absent keys fail closed: the endpoints
  // never fall back to a shared internal token or an unsigned request.
  // Compose injects empty strings for unset optional variables; treat those
  // as absent rather than failing schema validation at startup.
  OPERATOR_API_KEY: z.preprocess((v) => v || undefined, z.string().min(32).optional()),
  OPERATOR_API_SECRET: z.preprocess((v) => v || undefined, z.string().min(32).optional()),
  OPERATOR_LAUNCH_URL: z.preprocess((v) => v || undefined, z.string().url().optional()),
  // Optional replay window. Strict mode requires fresh x-timestamp/x-nonce
  // headers on every signed operator call; legacy deployments keep working
  // until they opt in. Nonces are also tracked when headers are supplied.
  OPERATOR_TIMESTAMP_REQUIRED: z.preprocess(
    (v) => v === true || v === "true" || v === "1", z.boolean(),
  ).default(false),
  OPERATOR_TIMESTAMP_SKEW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300_000),
  // Optional IP/CIDR allow-list. Empty means no network restriction; when set,
  // the gateway-forwarded client IP must match one entry.
  OPERATOR_IP_ALLOWLIST: z.preprocess((v) => v || undefined, z.string().max(2048).optional()),
  // External operator wallet. Both values are required or neither is used;
  // a single configured value is rejected at boot so calls cannot fall back to
  // the internal ledger with an unsigned request.
  OPERATOR_WALLET_URL: z.preprocess((v) => v || undefined, z.string().url().optional()),
  OPERATOR_WALLET_SECRET: z.preprocess((v) => v || undefined, z.string().min(32).optional()),
});
const env = loadEnv(envSchema);
if (Boolean(env.OPERATOR_WALLET_URL) !== Boolean(env.OPERATOR_WALLET_SECRET)) {
  throw new Error("OPERATOR_WALLET_URL and OPERATOR_WALLET_SECRET must be configured together");
}
if (env.OPERATOR_WALLET_URL && new URL(env.OPERATOR_WALLET_URL).protocol !== "https:") {
  throw new Error("OPERATOR_WALLET_URL must use https");
}
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));

// Deadlines are derived from persisted timestamps, never from process timers
// alone. A restart must not turn a stale round into a max-multiplier cash-out.
const BETTING_TOLERANCE_MS = 1000;
const UNSETTLED_RECONCILE_MS = 2000;

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: parseCorsOrigins(env.CORS_ORIGIN) });
await app.register(jwt, jwtVerifyPluginOptions(env));

// Keep the exact JSON bytes for operator signature verification. The spec
// signs the raw body; the local canonical form remains accepted for clients
// that already use it. An empty body is treated as `{}` rather than a parse
// error so optional-body routes keep working.
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  req.rawBody = body;
  if (!body.trim()) { done(null, {}); return; }
  try { done(null, JSON.parse(body)); } catch (err) { done(err); }
});

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
const deny = (reply, status, code, message, details) => {
  const requestId = String(reply.getHeader("x-request-id") ?? "");
  return reply.code(status).send({
    request_id: requestId,
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  });
};

/** Money-affecting requests carry a client reqId. Persisting the first
 * response lets a retry after a lost HTTP reply return the original result
 * instead of a misleading "already bet"/"already cashed out" error. */
async function replayRequest(userId, requestId, kind) {
  if (!requestId || !userId) return null;
  const result = await pool.query(
    `SELECT status, body FROM crash_requests
      WHERE user_id = $1 AND req_id = $2 AND kind = $3`,
    [userId, requestId, kind],
  );
  if (!result.rowCount) return null;
  // Status 0 is a committed placeholder written before any wallet call. A
  // retry must continue into the existing claim, never short-circuit on it.
  if (result.rows[0].status === 0) return { pending: true };
  return { status: result.rows[0].status, body: result.rows[0].body };
}

/** Claim the reqId before moving money. If the process dies after a wallet
 * debit/credit but before the success response is cached, a retry sees the
 * placeholder and replays the same persisted claim instead of a fresh wager. */
async function markRequestPending(userId, requestId, kind) {
  if (!requestId || !userId) return;
  await pool.query(
    `INSERT INTO crash_requests (user_id, req_id, kind, status, body)
      VALUES ($1, $2, $3, 0, '{}'::jsonb) ON CONFLICT (user_id, req_id, kind) DO NOTHING`,
    [userId, requestId, kind],
  );
}

async function rememberRequest(userId, requestId, kind, status, body) {
  if (!requestId || !userId) return;
  await pool.query(
    `INSERT INTO crash_requests (user_id, req_id, kind, status, body)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, req_id, kind) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body`,
    [userId, requestId, kind, status, JSON.stringify(body)],
  );
}

/** Aviator protocol error vocabulary from the API design document. Shared
 * ERROR_CODES stay in place for non-game routes and for backwards compatibility. */
const AV = Object.freeze({
  NOT_IN_BETTING_PHASE: "NOT_IN_BETTING_PHASE",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  BET_LIMIT_EXCEEDED: "BET_LIMIT_EXCEEDED",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  ROUND_CRASHED: "ROUND_CRASHED",
  PLAYER_BLOCKED: "PLAYER_BLOCKED",
  WALLET_UNAVAILABLE: "WALLET_UNAVAILABLE",
  VALIDATION_FAILED: "VALIDATION_FAILED",
});

/** Operator calls carry an API key and a body signature. Canonicalising the
 * parsed body means the signature does not depend on JSON key order. Both
 * comparisons are constant time, and a missing credential fails closed. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

/** IP/CIDR matching is deliberately dependency-free. IPv4-mapped IPv6 peers
 * are normalised to IPv4 so a gateway on ::ffff:127.0.0.1 still matches a
 * plain 127.0.0.1 allow-list entry. */
function ipToBigInt(ip, version) {
  if (version === 4) {
    return ip.split(".").reduce((value, part) => (value << 8n) | BigInt(part), 0n);
  }
  const [left = "", right = ""] = ip.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0) return null;
  return [...leftParts, ...Array(missing).fill("0"), ...rightParts]
    .reduce((value, group) => (value << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

function normaliseIp(raw) {
  let ip = String(raw ?? "").trim().replace(/^\[|\]$/g, "");
  if (/^::ffff:/i.test(ip) && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const version = isIP(ip);
  if (!version) return null;
  const value = ipToBigInt(ip, version);
  return value === null ? null : { version, value };
}

function parseOperatorAllowlist(raw) {
  if (!raw) return [];
  const entries = raw.split(",").map((item) => item.trim()).filter(Boolean).flatMap((entry) => {
    const [address, bitsRaw] = entry.split("/");
    const parsed = normaliseIp(address);
    if (!parsed) return [];
    const width = parsed.version === 4 ? 32 : 128;
    const bits = bitsRaw === undefined ? width : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) return [];
    return [{ ...parsed, bits, width }];
  });
  if (!entries.length) throw new Error("OPERATOR_IP_ALLOWLIST contains no valid IP or CIDR entry");
  return entries;
}

const OPERATOR_IP_ALLOWLIST = parseOperatorAllowlist(env.OPERATOR_IP_ALLOWLIST);

function operatorIpAllowed(req) {
  if (!OPERATOR_IP_ALLOWLIST.length) return true;
  const forwarded = headerString(req.headers, "x-forwarded-for");
  const candidate = forwarded?.split(",")[0]?.trim() || req.ip;
  const peer = normaliseIp(candidate);
  if (!peer) return false;
  return OPERATOR_IP_ALLOWLIST.some((entry) => {
    if (entry.version !== peer.version) return false;
    const shift = BigInt(entry.width - entry.bits);
    return (entry.value >> shift) === (peer.value >> shift);
  });
}

// Nonces are bounded and short-lived. A retry after a lost HTTP reply within
// the replay window is rejected rather than moving money twice; retries after
// the window must be signed again with a fresh timestamp.
const operatorNonces = new Map();
function pruneOperatorNonces(now) {
  for (const [nonce, expires] of operatorNonces) {
    if (expires <= now) operatorNonces.delete(nonce);
  }
}
function reserveOperatorNonce(nonce, now) {
  pruneOperatorNonces(now);
  if (operatorNonces.has(nonce)) return false;
  operatorNonces.set(nonce, now + env.OPERATOR_TIMESTAMP_SKEW_MS + 1000);
  return true;
}

function operatorAuthorised(req) {
  // The PDF sends `Authorization: Bearer <key>`; older deployments used
  // `x-api-key`. Accept both, but never a wrong key under either header.
  const bearer = typeof req.headers.authorization === "string"
    && req.headers.authorization.startsWith("Bearer ")
    ? req.headers.authorization.slice(7).trim() : null;
  const key = headerString(req.headers, "x-api-key") ?? bearer;
  const signature = headerString(req.headers, "x-signature");
  if (!env.OPERATOR_API_KEY || !env.OPERATOR_API_SECRET) return false;
  if (!key || !signature || !operatorIpAllowed(req)) return false;
  const keyA = Buffer.from(key);
  const keyB = Buffer.from(env.OPERATOR_API_KEY);
  if (keyA.length !== keyB.length || !timingSafeEqual(keyA, keyB)) return false;

  // A timestamp/nonce pair turns the body HMAC into a replay-proof signature.
  // Deployments opt into strict mode with OPERATOR_TIMESTAMP_REQUIRED=true;
  // once either header appears it is validated even in legacy mode, so a
  // stale timestamp can never be passed through as an unsigned body.
  const timestampRaw = headerString(req.headers, "x-timestamp");
  const nonce = headerString(req.headers, "x-nonce");
  const suppliedReplayHeaders = Boolean(timestampRaw || nonce);
  const now = Date.now();
  let fresh = false;
  if (timestampRaw && nonce && /^\d{1,16}$/.test(timestampRaw) && nonce.length <= 128) {
    const timestamp = Number(timestampRaw);
    if (Math.abs(now - timestamp) <= env.OPERATOR_TIMESTAMP_SKEW_MS
      && reserveOperatorNonce(nonce, now)) fresh = true;
  }
  if (suppliedReplayHeaders && !fresh) return false;
  if (env.OPERATOR_TIMESTAMP_REQUIRED && !fresh) return false;

  // Raw-body HMAC is the documented contract. Canonical/compact JSON are also
  // accepted for existing integrators; all comparisons are constant time.
  const bodies = [
    typeof req.rawBody === "string" ? req.rawBody : null,
    canonical(req.body ?? {}),
    JSON.stringify(req.body ?? {}),
  ].filter((body) => body !== null);
  const prefix = fresh ? `${timestampRaw}\n${nonce}\n` : "";
  const candidates = fresh
    ? [...bodies.map((body) => `${prefix}${body}`), ...bodies]
    : bodies;
  for (const body of candidates) {
    const expected = createHmac("sha256", env.OPERATOR_API_SECRET).update(body).digest("hex");
    const sigA = Buffer.from(signature.toLowerCase());
    const sigB = Buffer.from(expected);
    if (sigA.length === sigB.length && timingSafeEqual(sigA, sigB)) return true;
  }
  // A bad signature must not burn a nonce permanently inside the window.
  if (fresh) operatorNonces.delete(nonce);
  return false;
}

const requireOperator = (req, reply) => {
  if (!operatorAuthorised(req)) {
    deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid operator credentials");
    return false;
  }
  return true;
};

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

/**
 * A running round without a revealed, finite crash point has no provable
 * outcome. Legacy rows can have NULL here; treating that as 0x would settle
 * every active bet as a loss. Such rounds must be cancelled and refunded.
 */
function roundLacksProof(round) {
  if (round?.status !== "running") return false;
  if (!round.started_at || Number.isNaN(Date.parse(round.started_at))) return true;
  if (!round.server_seed) return true;
  const crashPoint = Number(round.crash_point);
  return !Number.isFinite(crashPoint) || crashPoint <= 0;
}

/** Absolute, DB-derived deadline for a round. Timers are only an optimisation;
 * this timestamp is the authoritative answer after a restart. */
function roundDeadline(round) {
  if (round.status === "running" && round.started_at && !roundLacksProof(round)) {
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
  const crashPoint = Number(round.crash_point);
  if (!round.server_seed || !Number.isFinite(crashPoint) || crashPoint <= 0) return null;
  const { houseEdge, maxMultiplier } = roundConfig(round);
  const proof = verifyRoundFairness({
    serverSeed: round.server_seed,
    roundId: round.id,
    seedHash: round.seed_hash,
    crashPoint,
    houseEdge,
    maxMultiplier,
  });
  return {
    serverSeed: round.server_seed,
    seedHash: proof.seedHash,
    crashPoint: proof.crashPoint,
    houseEdge,
    maxMultiplier,
    valid: proof.valid,
    algorithm: proof.algorithm,
  };
}

function publicRound(row) {
  const out = {
    id: row.id,
    // Legacy status stays for existing clients; `state` is the canonical
    // WAITING/BETTING/FLYING/CRASHED/SETTLING lifecycle from the spec.
    status: row.status,
    state: phaseForRound(row, Date.now(), env.BETTING_WINDOW_MS),
    seedHash: row.seed_hash,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    bettingEndsAt: row.status === "betting" && row.created_at
      ? new Date(new Date(row.created_at).getTime() + env.BETTING_WINDOW_MS).toISOString()
      : null,
    // Protocol v1 uses epoch milliseconds. ISO fields stay for older clients.
    createdAtMs: epochMs(row.created_at),
    startedAtMs: epochMs(row.started_at),
    bettingEndsAtMs: row.status === "betting" && row.created_at
      ? epochMs(row.created_at) + env.BETTING_WINDOW_MS
      : null,
    flightStart: row.started_at ?? null,
    flightStartMs: epochMs(row.started_at),
    // The client renders the same exponential curve the server pays.
    doublingSeconds: roundConfig(row).doublingSeconds,
    maxMultiplier: roundConfig(row).maxMultiplier,
    houseEdge: roundConfig(row).houseEdge,
    phases: PHASES,
  };
  // A cancelled round was never played. Its committed point and seed stay
  // sealed forever: publishing them would disclose an outcome no player could
  // ever have bet on and would let a client replay it against another round.
  if (row.status === "finished") {
    Object.assign(out, {
      crashPoint: row.crash_point === null ? null : Number(row.crash_point),
      finishedAt: row.finished_at ?? null,
      finishedAtMs: epochMs(row.finished_at),
      proof: verifyRound(row),
    });
  } else if (row.status === "cancelled") {
    Object.assign(out, { finishedAt: row.finished_at ?? null, finishedAtMs: epochMs(row.finished_at) });
  }
  return out;
}

/** Internal settlement value: capped at the actual crash point. Never expose
 * this on a public route — see publicMultiplier below. */
function liveMultiplier(row) {
  if (row.status !== "running" || !row.started_at || roundLacksProof(row)) return null;
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
  // An operator block is a second, independent gate. It is stored with the
  // player's other operator-side settings and checked before any stake leaves
  // the wallet; clearing it is an explicit operator action.
  try {
    const policy = await operatorPolicy(userId);
    if (policy.blocked) return false;
    const stake = Number(amount);
    if (Number.isFinite(Number(policy.limits.minBet)) && stake < Number(policy.limits.minBet)) return false;
    if (Number.isFinite(Number(policy.limits.maxBet)) && stake > Number(policy.limits.maxBet)) return false;
  } catch (err) {
    app.log.warn({ err, userId }, "operator policy lookup failed; blocking wager");
    return false;
  }
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

/** Optional external operator wallet. When configured, the operator holds the
 * funds and the provider signs every callback with the shared secret. The
 * deterministic txId is the same claim key already used for the internal
 * ledger, so a replay after a timeout cannot move money twice. */
function operatorWalletCall(path, body) {
  if (!env.OPERATOR_WALLET_URL || !env.OPERATOR_WALLET_SECRET) return null;
  const txId = body.idempotencyKey;
  const playerId = body.userId;
  const currency = "INR";
  if (path === "/internal/wallet/balance") {
    return { endpoint: "/wallet/balance", payload: { txId, playerId, currency } };
  }
  if (path === "/internal/wallet/debit") {
    return {
      endpoint: "/wallet/debit",
      payload: {
        txId, playerId, currency,
        roundId: body.referenceId,
        betId: body.betId ?? txId,
        amount: toMoney(body.amount),
      },
    };
  }
  if (path === "/internal/wallet/credit" && body.referenceType === "crash_refund") {
    return {
      endpoint: "/wallet/rollback",
      payload: {
        txId, originalTxId: body.originalTxId, reason: "ROUND_VOIDED", currency,
      },
    };
  }
  if (path === "/internal/wallet/credit") {
    return {
      endpoint: "/wallet/credit",
      payload: {
        txId, playerId, currency,
        roundId: body.roundId ?? body.referenceId,
        betId: body.referenceId,
        amount: toMoney(body.amount),
      },
    };
  }
  return null;
}

async function operatorWalletRequest(path, body) {
  const call = operatorWalletCall(path, body);
  if (!call) throw new WalletRequestError("unsupported operator wallet call", 400, "VALIDATION_FAILED");
  // The timestamp and nonce travel both as headers and inside the signed
  // body. The operator can reject stale callbacks without sharing replay
  // state with us, and the deterministic txId still governs money movement.
  const timestamp = String(Date.now());
  const nonce = String(body.idempotencyKey ?? randomUUID());
  const raw = JSON.stringify({ ...call.payload, timestamp, nonce });
  const signature = createHmac("sha256", env.OPERATOR_WALLET_SECRET).update(raw).digest("hex");
  let response;
  try {
    response = await fetchWithTimeout(
      `${env.OPERATOR_WALLET_URL.replace(/\/$/, "")}${call.endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": timestamp,
          "x-nonce": nonce,
          "x-signature": signature,
        },
        body: raw,
      },
      5000,
    );
  } catch (err) {
    // Same ambiguity rule as the internal ledger: the operator may have
    // committed before the socket died, so replay the same txId.
    throw new WalletAmbiguousError(`operator wallet request failed: ${err.message}`, 0, err.code);
  }
  const text = await response.text();
  if (!response.ok) {
    const ErrorClass = response.status >= 500 ? WalletAmbiguousError : WalletRequestError;
    throw new ErrorClass(`operator wallet returned ${response.status}`, response.status);
  }
  const responseTime = response.headers.get("x-timestamp");
  if (responseTime
    && (!/^\d{1,16}$/.test(responseTime)
      || Math.abs(Date.now() - Number(responseTime)) > env.OPERATOR_TIMESTAMP_SKEW_MS)) {
    throw new WalletRequestError("operator wallet response timestamp is stale", 400, "STALE_TIMESTAMP");
  }
  const supplied = response.headers.get("x-signature");
  if (supplied) {
    const expected = createHmac("sha256", env.OPERATOR_WALLET_SECRET).update(text).digest("hex");
    const a = Buffer.from(supplied.toLowerCase());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new WalletRequestError("operator wallet response signature invalid", 400, "INVALID_SIGNATURE");
  }
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new WalletAmbiguousError("operator wallet returned invalid JSON", 502); }
  if (payload.status && payload.status !== "OK")
    throw new WalletRequestError(payload.message ?? "operator wallet rejected the request", 409, payload.code);
  return {
    transaction: { idempotency_key: payload.txId ?? body.idempotencyKey },
    balance: payload.balance ?? null,
  };
}

async function walletRequest(path, body, scopedTokenValue) {
  if (env.OPERATOR_WALLET_URL && env.OPERATOR_WALLET_SECRET)
    return operatorWalletRequest(path, body);
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
    betId: bet.id,
    idempotencyKey: debitKey(bet),
  }, debitToken()));

const walletCredit = (bet, payout = Number(bet.payout)) =>
  walletIdempotent(() => walletRequest("/internal/wallet/credit", {
    userId: bet.user_id,
    amount: payout,
    type: "win",
    referenceType: "crash_bet",
    referenceId: bet.id,
    roundId: bet.round_id,
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
    roundId: bet.round_id,
    originalTxId: debitKey(bet),
    idempotencyKey: refundKey(bet),
  }, winToken()));

/** Read-only balance lookup used by snapshots and balance events. A wallet
 * outage must not break the game protocol, so failures return null here. */
async function walletBalance(userId, authorization) {
  try {
    if (env.OPERATOR_WALLET_URL && env.OPERATOR_WALLET_SECRET) {
      const result = await operatorWalletRequest("/internal/wallet/balance", {
        idempotencyKey: randomUUID(), userId,
      });
      const source = result.balance;
      const amount = Number(source?.amount ?? source?.balance ?? source);
      const currency = String(source?.currency ?? "INR").slice(0, 8);
      return Number.isFinite(amount) ? { amount: toMoney(amount), currency } : null;
    }
    const response = await fetchWithTimeout(
      `${env.WALLET_INTERNAL_URL}/v1/wallet/balance`,
      {
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
          "x-user-id": userId,
        },
      },
      3000,
    );
    if (!response.ok) return null;
    const account = (await response.json())?.data?.account;
    if (!account) return null;
    const amount = Number(account.balance);
    if (!Number.isFinite(amount)) return null;
    return { amount: amount.toFixed(2), currency: account.currency ?? "INR" };
  } catch {
    return null;
  }
}

/** Ask auth (the sole holder of the signing key) for a real access token that
 * the gateway already trusts. The operator never supplies identity claims. */
async function mintOperatorSession(userId, metadata) {
  try {
    const response = await fetchWithTimeout(
      `${env.AUTH_INTERNAL_URL}/internal/auth/session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": env.AUTH_SESSION_SERVICE_TOKEN,
        },
        body: JSON.stringify({ userId, ttlSeconds: 300, metadata }),
      },
      5000,
    );
    if (!response.ok) {
      // Auth denies non-player targets. Surface that refusal to the operator
      // instead of hiding it behind a generic upstream failure; all other
      // upstream errors remain opaque and fail closed.
      if (response.status === 403) {
        return { error: [403, ERROR_CODES.FORBIDDEN, "operator sessions cannot target a privileged account"] };
      }
      return null;
    }
    return (await response.json())?.data ?? null;
  } catch {
    return null;
  }
}

/** One deterministic policy read: currency defaults first, player overrides
 * second, independent of SQL row order. Both the wager gate and the advertised
 * limits use this so the UI never shows stakes the API will reject. */
async function operatorPolicy(userId) {
  const stored = await pool.query(
    `SELECT user_id, settings FROM crash_player_settings WHERE user_id = $1 OR user_id = $2`,
    [userId, "currency:INR"],
  );
  const player = stored.rows.find((row) => row.user_id === userId)?.settings ?? {};
  const currency = stored.rows.find((row) => row.user_id === "currency:INR")?.settings ?? {};
  return {
    blocked: player.blocked === true || currency.blocked === true,
    limits: { ...(currency.limits ?? {}), ...(player.limits ?? {}) },
  };
}

/** Operator-configured limits override the global defaults for the player. */
async function effectiveLimits(userId) {
  const defaultLimits = {
    minBet: env.MIN_BET,
    maxBet: env.MAX_BET,
    maxWin: env.MAX_BET * env.MAX_MULTIPLIER,
  };
  if (!userId) return defaultLimits;
  try {
    const { limits: merged } = await operatorPolicy(userId);
    return {
      minBet: Number.isFinite(Number(merged.minBet)) && Number(merged.minBet) > 0
        ? Number(merged.minBet) : defaultLimits.minBet,
      maxBet: Number.isFinite(Number(merged.maxBet)) && Number(merged.maxBet) > 0
        ? Number(merged.maxBet) : defaultLimits.maxBet,
      maxWin: Number.isFinite(Number(merged.maxWin)) && Number(merged.maxWin) > 0
        ? Number(merged.maxWin) : defaultLimits.maxWin,
    };
  } catch {
    return defaultLimits;
  }
}

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
  // A reused row may already be `running`. Scheduling startRound unconditionally
  // would be a no-op and leave the round with no finish timer at all; derive
  // the next deadline from the persisted status instead.
  scheduleRoundDeadlines(round);
  if (round.status === "betting") {
    try {
      await placeAutoBets(round);
    } catch (err) {
      // Auto-bet is an optional convenience. A failure here must never stop
      // the round lifecycle or affect a manual player's bet.
      app.log.warn({ err, roundId: round.id }, "auto-bet placement failed");
    }
  }
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

async function reserveBet(roundId, userId, amount, autoCashout, sessionId, panel = 1) {
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
      return { error: [409, AV.NOT_IN_BETTING_PHASE, "betting is closed for this round"] };
    }
    // A retry after an ambiguous response must reuse the original claim (and
    // therefore its wallet keys). Never DELETE and re-INSERT here: a fresh bet
    // id would give the wallet a fresh key and could book a second wager for
    // a debit that had already committed.
    const existing = await client.query(
      `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 AND panel = $3 FOR UPDATE`,
      [roundId, userId, panel],
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
        (id, round_id, session_id, user_id, panel, amount, auto_cashout, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (round_id, user_id, panel) DO NOTHING RETURNING *`,
      [betId, roundId, sessionId ?? null, userId, panel, toMoney(amount),
        autoCashout === undefined ? null : autoCashout.toFixed(2), `crash-bet-${betId}`],
    );
    if (!inserted.rowCount) {
      // A concurrent request won the insert race; read its committed claim.
      const winner = await client.query(
        `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 AND panel = $3 FOR UPDATE`,
        [roundId, userId, panel],
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

const SETTLED_BET_STATUSES = new Set(["active", "cashing_out", "cashed_out", "lost"]);

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
  const status = fresh.rows[0]?.status;
  // A concurrent duplicate already moved the same claim into a live or settled
  // state. That is an idempotent replay of the winning request, NOT a failed
  // debit: refunding here would return the stake on a perfectly valid bet and
  // could stack a refund on top of a cash-out payout.
  if (SETTLED_BET_STATUSES.has(status)) return { bet: fresh.rows[0], replay: true };
  // A claim already being refunded must not be activated again; reconciliation
  // owns its credit. Any other terminal row must not be credited a second time.
  if (status === "refunding" || status === "refunded" || status === "cancelled") {
    return { error: [409, ERROR_CODES.CONFLICT, "bet is already settled"], refund: false };
  }
  // Still pending: the debit succeeded but the round stopped accepting bets
  // before activation. This one genuinely owes the player their stake back.
  return {
    error: [409, AV.NOT_IN_BETTING_PHASE, "betting is closed for this round"],
    refund: status === "pending",
  };
}

/**
 * Claim a refund under a conditional status write BEFORE touching the wallet.
 * The new `refunding` state makes the claim visible to recovery, so a process
 * that dies between the claim and the credit still replays the same idempotent
 * keys. A caller that lost the claim returns without minting another credit.
 */
async function refundBet(bet, { ensureDebit = true, claimed = false } = {}) {
  let claim = bet;
  if (!claimed) {
    const taken = await pool.query(
      `UPDATE crash_bets SET status = 'refunding', settled_at = now()
        WHERE id = $1 AND status IN ('pending','active','cancelled')
        RETURNING *`,
      [bet.id],
    );
    if (!taken.rowCount) {
      const fresh = await pool.query(`SELECT status FROM crash_bets WHERE id = $1`, [bet.id]);
      return { alreadyClaimed: true, status: fresh.rows[0]?.status ?? null };
    }
    claim = taken.rows[0];
  }
  try {
    if (ensureDebit) {
      // A pending bet may have been abandoned before the wallet call. Replay
      // the debit with this bet's deterministic key first so a refund can
      // never mint new credits or create a second net-zero tx pair on retry.
      try {
        await walletDebit(claim);
      } catch (debitErr) {
        // Definitive insufficient-balance means no debit was recorded for this
        // claim. Minting a refund credit would create money from nothing, so
        // the bet is closed as a no-debit cancellation instead.
        if (definitiveWalletRejection(debitErr) && debitErr.status === 409) {
          await pool.query(
            `UPDATE crash_bets SET status = 'cancelled', settled_at = now()
              WHERE id = $1 AND status = 'refunding'`,
            [claim.id],
          );
          return { cancelled: true, reason: "debit-not-recorded" };
        }
        throw debitErr;
      }
    }
    await walletRefund(claim);
    await pool.query(
      `UPDATE crash_bets SET status = 'refunded', settled_at = now()
        WHERE id = $1 AND status = 'refunding'`,
      [claim.id],
    );
    return { refunded: true };
  } catch (err) {
    // Keep the refunding claim: boot/periodic recovery replays the same keys.
    app.log.error({ err, betId: claim.id }, "crash stake refund failed; bet stays reconcilable");
    throw err;
  }
}

/** Retry interrupted stake moves and replay in-flight win credits. Everything
 * here is idempotent, so it is safe on boot and on a periodic timer. */
async function reconcileUnsettled() {
  const pending = await pool.query(
    `SELECT b.*, r.status AS round_status, r.created_at AS round_created_at
       FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE b.status IN ('pending','refunding')`,
  );
  for (const bet of pending.rows) {
    try {
      // A claim already in `refunding` is owned by the refund path. Calling
      // refundBet(bet) without `claimed` can never re-claim the row, so a
      // process that died after the claim but before the wallet credit would
      // leave this bet stuck forever. Replaying the debit is safe: its
      // idempotency key is derived from the stored bet, not the request.
      if (bet.status === "refunding") {
        await refundBet(bet, { claimed: true });
        continue;
      }
      if (bettingDeadlinePassed({ status: bet.round_status, created_at: bet.round_created_at })) {
        await refundBet(bet);
        continue;
      }
      await walletDebit(bet);
      const activation = await activateReservedBet(bet);
      if (activation.error) {
        // The activation guard reports whether compensation is actually owed;
        // an idempotent replay of a live/settled claim must never be refunded.
        if (activation.refund) await refundBet(bet, { ensureDebit: false });
      }
    } catch (err) {
      if (definitiveWalletRejection(err) && err.status === 409) {
        // Definitive "insufficient balance": no debit was recorded.
        await pool.query(
          `UPDATE crash_bets SET status = 'cancelled', settled_at = now()
            WHERE id = $1 AND status IN ('pending','refunding')`, [bet.id]);
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
  // Only masked/public fields are broadcast. Realtime has a narrow allowlist
  // for these exact keys on feed topics; everything else stays redacted.
  await publish("crash.cashout", {
    id: bet.id,
    betId: bet.id,
    roundId: bet.round_id,
    stake: Number(bet.amount).toFixed(2),
    mult: multiplier.toFixed(2),
    payout: payout.toFixed(2),
    user: maskPlayer(bet.user_id),
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
    // configured trigger. Never pay more than the live value or crash point,
    // and honour the operator's per-player/per-currency maxWin cap.
    const requested = requestedMultiplier === undefined ? live : Number(requestedMultiplier);
    const limits = await effectiveLimits(userId ?? current.user_id);
    const winCapMultiplier = Math.floor(
      (Number(limits.maxWin) / Math.max(Number(current.amount), 0.01)) * 100,
    ) / 100;
    multiplier = Math.round(
      Math.min(requested, live, Number(round.crash_point), winCapMultiplier) * 100,
    ) / 100;
    if (multiplier < 1) {
      await client.query("ROLLBACK");
      return { error: [422, AV.BET_LIMIT_EXCEEDED, "max win limit reached"] };
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
    // Keep the committed cashing_out claim, including its payout and
    // idempotency key. Reverting to `active` here lets finishRound settle the
    // bet as a loss and destroys the only record needed to replay the win.
    // Definitive or ambiguous, reconciliation owns this bet now.
    app.log.error({ err, betId: claim.id }, "cash-out claim kept for reconciliation after wallet rejection");
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
    // A legacy NULL/invalid crash point is not a 0x crash. Never book debited
    // bets as losses for a round that has no provable outcome.
    if (roundLacksProof(round)) {
      await client.query("ROLLBACK");
      app.log.warn({ roundId: id }, "incomplete crash round cancelled instead of settled");
      await cancelRound(id, { allowRunning: true });
      return;
    }
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
  // Canonical lifecycle: CRASHED -> SETTLING -> WAITING. Publishing settlement
  // as its own event lets clients show the phase without changing the ledger
  // status that all existing reconciliation queries rely on.
  await publish("crash.round_settling", { id: round.id, status: "settling" });
  if (scheduleNext) later(() => createRound(), env.ROUND_GAP_MS);
}

/** Cancel an invalid/stale round and refund its open stakes. Running rounds are
 * only cancellable when the caller proves the round has no usable outcome. */
async function cancelRound(id, { allowRunning = false } = {}) {
  const result = await pool.query(
    `UPDATE crash_rounds SET status = 'cancelled', finished_at = now()
      WHERE id = $1 AND (status = 'betting' OR ($2 AND status = 'running'))
      RETURNING *`, [id, allowRunning]);
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
    // A voided round has no public outcome: never expose its seed or point and
    // never let a client render it as an ordinary crash/loss.
    crashPoint: null,
    voided: true,
    reason: "round_cancelled",
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
    if (roundLacksProof(round)) {
      // No seed/crash point means there is nothing to reveal and no fair loss
      // to settle. Refund through the same deterministic keys as any cancel.
      await cancelRound(round.id, { allowRunning: true });
      continue;
    }
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
    if (roundLacksProof(round) || roundHasCrashed(round)) continue;
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
// Auto-bet sessions. A session never bypasses the manual bet path: at the
// start of every BETTING phase we reserve, debit and activate exactly as a
// player click would. Stop rules are evaluated from settled bets, and a
// definitive wallet rejection stops the session immediately.
// ---------------------------------------------------------------------------

async function stopAutoSession(session, reason) {
  await pool.query(
    `UPDATE crash_auto_sessions SET status = 'stopped', stop_reason = $2, updated_at = now()
      WHERE id = $1 AND status = 'active'`, [session.id, reason]);
  await publish("crash.auto_stopped", { userId: session.user_id, panel: session.panel, reason });
}

async function placeAutoBets(round) {
  const sessions = await pool.query(
    `SELECT * FROM crash_auto_sessions
      WHERE status = 'active' AND rounds_left > 0
        AND (last_round_id IS NULL OR last_round_id <> $1)`, [round.id],
  );
  for (const session of sessions.rows) {
    const rules = typeof session.stop_rules === "string"
      ? JSON.parse(session.stop_rules) : (session.stop_rules ?? {});
    const performance = await pool.query(
      `SELECT COALESCE(SUM(CASE
          WHEN status = 'cashed_out' THEN payout - amount
          WHEN status IN ('lost','refunded') THEN -amount
          ELSE 0 END), 0) AS profit,
        COALESCE(MAX(CASE WHEN status = 'cashed_out' THEN payout - amount ELSE 0 END), 0) AS best
        FROM crash_bets WHERE user_id = $1 AND created_at >= $2`,
      [session.user_id, session.created_at],
    );
    const profit = Number(performance.rows[0]?.profit ?? 0);
    const best = Number(performance.rows[0]?.best ?? 0);
    if (Number.isFinite(Number(rules.totalLossLimit)) && profit <= -Number(rules.totalLossLimit)) {
      await stopAutoSession(session, "total_loss_limit");
      continue;
    }
    if (Number.isFinite(Number(rules.singleWinAbove)) && best >= Number(rules.singleWinAbove)) {
      await stopAutoSession(session, "single_win_above");
      continue;
    }
    if (Number.isFinite(Number(rules.balanceBelow)) && Number(rules.balanceBelow) > 0) {
      const balance = await walletBalance(session.user_id, null);
      if (balance && Number(balance.amount) < Number(rules.balanceBelow)) {
        await stopAutoSession(session, "balance_below");
        continue;
      }
    }
    if (!(await wageringAllowed(session.user_id, Number(session.stake)))) {
      await stopAutoSession(session, "player_blocked");
      continue;
    }
    let reserved;
    try {
      reserved = await reserveBet(
        round.id, session.user_id, Number(session.stake),
        session.auto_cashout === null ? undefined : Number(session.auto_cashout),
        undefined, session.panel,
      );
    } catch (err) {
      app.log.warn({ err, sessionId: session.id }, "auto-bet reservation failed");
      continue;
    }
    if (reserved.error) continue;
    try {
      await walletDebit(reserved.bet);
    } catch (err) {
      if (definitiveWalletRejection(err)) await stopAutoSession(session, "wallet_rejected");
      else app.log.warn({ err, sessionId: session.id }, "auto-bet debit is ambiguous");
      continue;
    }
    const activation = await activateReservedBet(reserved.bet);
    if (activation.error) {
      if (activation.refund) await refundBet(reserved.bet, { ensureDebit: false }).catch(() => undefined);
      continue;
    }
    await pool.query(
      `UPDATE crash_auto_sessions SET rounds_left = rounds_left - 1,
        last_round_id = $2, updated_at = now() WHERE id = $1`,
      [session.id, round.id],
    );
    await publish("crash.bet", {
      id: activation.bet.id, betId: activation.bet.id, roundId: round.id, panel: session.panel,
      stake: Number(activation.bet.amount).toFixed(2),
      user: maskPlayer(activation.bet.user_id),
      status: activation.bet.status, auto: true,
    });
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
  const limit = boundedInt(req.query.limit, 20, 1, 100);
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
  let myBets = [];
  if (userId) {
    const bet = await pool.query(
      `SELECT id, panel, amount, auto_cashout, cashout_at, payout, status, created_at
        FROM crash_bets WHERE round_id = $1 AND user_id = $2 ORDER BY panel`,
      [id, userId],
    );
    myBets = bet.rows;
    myBet = bet.rows[0] ?? null;
  }
  return ok(reply, 200, { round, myBet, myBets });
});

const BetSchema = z.object({
  amount: z.coerce.number().positive().finite(),
  autoCashout: z.coerce.number().min(1.01).max(1000).optional(),
  // Double bet: two independent panels, one shared round and crash point.
  panel: z.coerce.number().int().min(1).max(2).optional().default(1),
  // Client idempotency key echoed in bet_ok / bet_err frames.
  requestId: z.string().max(128).optional(),
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
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  const { amount, autoCashout, sessionId, panel, requestId } = parsed.data;
  const prior = await replayRequest(userId, requestId, "bet");
  if (prior && !prior.pending) {
    reply.header("x-idempotent-replay", "1");
    return reply.code(prior.status).send(prior.body);
  }
  const limits = await effectiveLimits(userId);
  if (amount < limits.minBet || amount > limits.maxBet)
    return deny(reply, 422, AV.BET_LIMIT_EXCEEDED, "bet amount out of range");

  // The two panels share a combined per-player stake limit for the round.
  const committed = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM crash_bets
      WHERE round_id = $1 AND user_id = $2 AND panel <> $3
        AND status IN ('pending','active','cashing_out','cashed_out')`,
    [req.params.id, userId, panel],
  );
  if (Number(committed.rows[0]?.total ?? 0) + amount > limits.maxBet)
    return deny(reply, 422, AV.BET_LIMIT_EXCEEDED, "combined stake exceeds the round limit");

  // Fail-closed self-exclusion gate: no stake may be reserved for a player the
  // RG service has excluded (or cannot confirm is eligible).
  if (!(await wageringAllowed(userId, amount)))
    return deny(reply, 403, AV.PLAYER_BLOCKED, "wagering is not allowed for this player");

  const roundResult = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
  const round = roundResult.rows[0];
  if (!round) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "round not found");
  if (round.status !== "betting")
    return deny(reply, 409, AV.NOT_IN_BETTING_PHASE, "betting is closed for this round");

  // Claim the request before any money moves so an interrupted reply can be
  // reconciled against the same bet claim on retry.
  await markRequestPending(userId, requestId, "bet");
  // Reservation and status guard are one DB transaction; the wallet debit
  // follows only once the bet row is durably committed as `pending`.
  const reserved = await reserveBet(round.id, userId, amount, autoCashout, sessionId, panel);
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
      return deny(reply, 402, AV.INSUFFICIENT_FUNDS, "insufficient balance");
    }
    req.log.error({ err, betId: bet.id }, "crash bet debit is ambiguous");
    return deny(
      reply,
      503,
      AV.WALLET_UNAVAILABLE,
      "bet is pending; retry this request to reconcile",
      { idempotencyKey: debitKey(bet), betId: bet.id, ambiguous: err instanceof WalletAmbiguousError },
    );
  }

  const activation = await activateReservedBet(bet);
  if (activation.error) {
    // Only a genuinely pending claim after a failed debit needs compensation.
    // A concurrent duplicate that already activated the same bet is reported
    // as a successful idempotent replay instead of refunding a live stake.
    if (!activation.refund) return deny(reply, ...activation.error);
    try {
      await refundBet(bet, { ensureDebit: false });
    } catch {
      // The error is logged in refundBet; reconciliation will retry.
    }
    return deny(reply, ...activation.error);
  }
  bet = activation.bet;
  if (!activation.replay) {
    await publish("crash.bet", {
      id: bet.id,
      betId: bet.id,
      roundId: round.id,
      panel: bet.panel,
      stake: Number(bet.amount).toFixed(2),
      user: maskPlayer(bet.user_id),
      status: bet.status,
    });
  }
  const body = {
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    success: true,
    data: {
      bet: {
        betId: bet.id,
        id: bet.id,
        reqId: requestId ?? null,
        panel: bet.panel,
        amount: toMoney(bet.amount),
        autoCashout: bet.auto_cashout === null ? null : toMoney(bet.auto_cashout),
        status: bet.status,
      },
    },
  };
  const responseStatus = activation.replay ? 200 : 201;
  await rememberRequest(userId, requestId, "bet", responseStatus, body);
  return reply.code(responseStatus).send(body);
});

const CashoutSchema = z.object({
  panel: z.coerce.number().int().min(1).max(2).optional().default(1),
  betId: z.string().uuid().optional(),
  requestId: z.string().max(128).optional(),
});

app.post("/v1/crash/rounds/:id/cashout", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const requested = CashoutSchema.safeParse(req.body ?? {});
  if (!requested.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(requested.error.flatten()));
  const { panel, betId, requestId } = requested.data;
  const prior = await replayRequest(userId, requestId, "cashout");
  if (prior && !prior.pending) {
    reply.header("x-idempotent-replay", "1");
    return reply.code(prior.status).send(prior.body);
  }
  await markRequestPending(userId, requestId, "cashout");
  let payout;
  let pendingBet = null;
  try {
    payout = await serialized(async () => {
      const roundResult = await pool.query(`SELECT * FROM crash_rounds WHERE id = $1`, [req.params.id]);
      const round = roundResult.rows[0];
      if (!round) return { error: [404, ERROR_CODES.NOT_FOUND, "round not found"] };
      const betResult = betId
        ? await pool.query(
            `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 AND id = $3`,
            [round.id, userId, betId],
          )
        : await pool.query(
            `SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 AND panel = $3`,
            [round.id, userId, panel],
          );
      const bet = betResult.rows[0];
      if (!bet) return { error: [404, ERROR_CODES.NOT_FOUND, "no bet on this round"] };
      pendingBet = bet;
      // An interrupted credit can be finalized even after the round ends.
      if (bet.status === "cashing_out") {
        const value = await finalizeCashout(bet);
        return { value, multiplier: Number(bet.cashout_at), betId: bet.id, panel: bet.panel };
      }
      if (bet.status === "cashed_out")
        return { error: [409, ERROR_CODES.CONFLICT, "already cashed out"] };
      // Status, deadline and bet state are re-checked under Postgres row locks
      // inside cashoutBet; these reads only shape the user-facing error.
      if (round.status !== "running")
        return { error: [409, AV.ROUND_CRASHED, "round is not running"] };
      const multiplier = liveMultiplier(round);
      if (multiplier === null || multiplier < 1.01)
        return { error: [409, AV.ROUND_CRASHED, "cash-out is not available"] };
      const outcome = await cashoutBet(bet, undefined, { userId });
      if (outcome?.error) return { error: outcome.error };
      if (!outcome || outcome.pending)
        return { error: [409, ERROR_CODES.CONFLICT, "bet is no longer active"] };
      return {
        value: outcome.payout, multiplier: outcome.multiplier,
        betId: bet.id, panel: bet.panel,
      };
    });
  } catch (err) {
    req.log.error({ err }, "crash cash-out is ambiguous");
    return deny(
      reply,
      503,
      AV.WALLET_UNAVAILABLE,
      "cash-out could not be confirmed; retry this request to reconcile",
      {
        idempotencyKey: pendingBet ? creditKey(pendingBet) : null,
        betId: pendingBet?.id ?? null,
        ambiguous: err instanceof WalletAmbiguousError,
      },
    );
  }
  if (payout.error) return deny(reply, payout.error[0], payout.error[1], payout.error[2]);
  const body = {
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    success: true,
    data: {
      payout: toMoney(payout.value), multiplier: toMoney(payout.multiplier),
      betId: payout.betId ?? null,
      panel: payout.panel === 1 || payout.panel === 2 ? payout.panel : null,
      reqId: requestId ?? null,
    },
  };
  await rememberRequest(userId, requestId, "cashout", 200, body);
  return reply.code(200).send(body);
});

app.get("/v1/crash/me/bets", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const limit = boundedInt(req.query.limit, 50, 1, 100);
  const result = await pool.query(
    `SELECT id, round_id, panel, amount, auto_cashout, cashout_at, payout, status, created_at, settled_at
      FROM crash_bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return ok(reply, 200, { items: result.rows });
});

// ---------------------------------------------------------------------------
// Aviator reference API: snapshot, history, fairness, leaderboards, settings.
// These paths mirror the player REST surface in the API design document while
// the older /crash/... aliases keep existing clients working.
// ---------------------------------------------------------------------------

app.get("/v1/crash/snapshot", async (req, reply) => {
  const userId = await requestUserId(req);
  const current = await pool.query(
    `SELECT * FROM crash_rounds WHERE status IN ('betting','running')
      ORDER BY created_at DESC LIMIT 1`,
  );
  const history = await pool.query(
    `SELECT crash_point FROM crash_rounds WHERE status = 'finished'
        AND crash_point IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT $1`,
    [boundedInt(req.query.limit, 20, 1, 100)],
  );
  let myBets = [];
  if (userId && current.rows[0]) {
    const bets = await pool.query(
      `SELECT id, panel, amount, auto_cashout, status FROM crash_bets
        WHERE round_id = $1 AND user_id = $2 AND status IN ('pending','active','cashing_out')
        ORDER BY panel`,
      [current.rows[0].id, userId],
    );
    myBets = bets.rows;
  }
  const [balance, limits] = await Promise.all([
    userId ? walletBalance(userId, req.headers.authorization) : Promise.resolve(null),
    effectiveLimits(userId),
  ]);
  return ok(reply, 200, {
    // The socket boundary applies sanitizeSnapshot again; keeping the filter
    // here too means REST clients cannot read a committed outcome early.
    snapshot: sanitizeSnapshot(buildSnapshot({
      round: current.rows[0] ?? null,
      balance,
      myBets,
      history: history.rows.map((row) => Number(row.crash_point)),
      limits,
      serverTime: Date.now(),
      bettingWindowMs: env.BETTING_WINDOW_MS,
    })),
  });
});

const FairnessSchema = z.object({
  serverSeed: z.string().min(1).max(256),
  // Live rounds are committed from (serverSeed, roundId). The client-seed
  // construction is still accepted for clients verifying older proofs.
  roundId: z.string().max(128).optional(),
  clientSeed: z.string().max(256).optional().default(""),
  seedHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  crashPoint: z.coerce.number().positive().optional(),
  // `edge` is the legacy client-seed parameter. Live rounds use the persisted
  // house edge from /v1/crash/rules, exposed here as `houseEdge`.
  edge: z.coerce.number().min(0).max(0.5).optional(),
  houseEdge: z.coerce.number().min(0).max(0.5).optional(),
  maxMultiplier: z.coerce.number().positive().max(10000).optional(),
  algorithm: z.enum([FAIRNESS_ALGORITHM, CLIENT_SEED_ALGORITHM]).optional(),
});

app.post("/v1/crash/fairness/verify", async (req, reply) => {
  const parsed = FairnessSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  const input = parsed.data;
  // Without a roundId (and without an explicit live algorithm) the caller is
  // verifying a legacy client-seed proof. An empty clientSeed is valid for
  // those rounds, so it must not silently route the call into the live path.
  const useClientSeed = input.algorithm === CLIENT_SEED_ALGORITHM
    || (!input.roundId && input.algorithm !== FAIRNESS_ALGORITHM);
  let persistedConfig = null;
  if (!useClientSeed && input.roundId) {
    const round = await pool.query(
      `SELECT * FROM crash_rounds WHERE id = $1`, [input.roundId],
    );
    if (round.rowCount) persistedConfig = roundConfig(round.rows[0]);
  }
  const verification = useClientSeed
    ? verifyFairness({ ...input, edge: input.edge ?? 0.03 })
    : verifyRoundFairness({
        serverSeed: input.serverSeed,
        roundId: input.roundId,
        seedHash: input.seedHash,
        crashPoint: input.crashPoint,
        // A round's committed configuration wins over current env values and
        // caller overrides: old proofs stay verifiable after a config change.
        houseEdge: persistedConfig?.houseEdge ?? input.houseEdge ?? input.edge ?? env.HOUSE_EDGE,
        maxMultiplier: persistedConfig?.maxMultiplier ?? input.maxMultiplier ?? env.MAX_MULTIPLIER,
      });
  // Documented fields live at the top level of `data`; `verification` is kept
  // as an alias for clients built against the previous envelope.
  return ok(reply, 200, { ...verification, verification });
});

// Spec-aligned aliases over the same authoritative ledger.
app.get("/v1/crash/rounds", async (req, reply) => {
  const limit = boundedInt(req.query.limit, 20, 1, 100);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  const params = [limit];
  let where = `WHERE status IN ('finished','cancelled')`;
  if (cursor) {
    const parsed = Buffer.from(cursor, "base64url").toString("utf8");
    const before = Date.parse(parsed);
    if (Number.isFinite(before)) {
      params.push(new Date(before).toISOString());
      where += ` AND finished_at < $2`;
    }
  }
  const result = await pool.query(
    `SELECT * FROM crash_rounds ${where}
      ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT $1`, params,
  );
  const items = result.rows.map(publicRound);
  const last = result.rows[result.rows.length - 1];
  return ok(reply, 200, {
    items,
    nextCursor: last?.finished_at
      ? Buffer.from(new Date(last.finished_at).toISOString()).toString("base64url")
      : null,
  });
});

app.get("/v1/crash/bets", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const limit = boundedInt(req.query.limit, 50, 1, 100);
  const params = [userId, limit];
  let where = `WHERE user_id = $1`;
  if (typeof req.query.cursor === "string" && req.query.cursor) {
    let cursor = null;
    try { cursor = JSON.parse(Buffer.from(req.query.cursor, "base64url").toString("utf8")); } catch { /* legacy form below */ }
    const legacy = typeof req.query.cursor === "string" ? Date.parse(req.query.cursor) : NaN;
    const at = cursor?.createdAt ?? (Number.isFinite(legacy) ? new Date(legacy).toISOString() : null);
    if (at) {
      params.push(at, cursor?.id ?? "00000000-0000-0000-0000-000000000000");
      where += ` AND (created_at < $3 OR (created_at = $3 AND id < $4))`;
    }
  }
  const result = await pool.query(
    `SELECT id, round_id, panel, amount, auto_cashout, cashout_at, payout, status, created_at, settled_at
      FROM crash_bets ${where} ORDER BY created_at DESC, id DESC LIMIT $2`, params,
  );
  const last = result.rows[result.rows.length - 1];
  return ok(reply, 200, {
    items: result.rows.map((bet) => ({
      ...bet,
      betId: bet.id,
      roundId: bet.round_id,
      stake: toMoney(bet.amount),
      cashedAt: bet.cashout_at === null ? null : toMoney(bet.cashout_at),
      payout: bet.payout === null ? null : toMoney(bet.payout),
      createdAt: bet.created_at,
    })),
    nextCursor: last && result.rows.length === limit
      ? Buffer.from(JSON.stringify({
          createdAt: last.created_at.toISOString(),
          id: last.id,
        })).toString("base64url")
      : null,
  });
});

app.get("/v1/crash/bets/:id", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const result = await pool.query(
    `SELECT b.*, r.seed_hash, r.server_seed, r.crash_point, r.finished_at,
            r.house_edge, r.max_multiplier, r.doubling_seconds
      FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE b.id = $1 AND b.user_id = $2`,
    [req.params.id, userId],
  );
  if (!result.rowCount) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "bet not found");
  const bet = result.rows[0];
  return ok(reply, 200, {
    bet: {
      ...bet,
      betId: bet.id,
      proof: verifyRound({ ...bet, id: bet.round_id }),
    },
  });
});

app.get("/v1/crash/stats/top", async (req, reply) => {
  const period = ["day", "month", "year"].includes(req.query.period) ? req.query.period : "day";
  const interval = period === "day" ? "24 hours" : period === "month" ? "30 days" : "365 days";
  const limit = boundedInt(req.query.limit, 10, 1, 50);
  const wins = await pool.query(
    `SELECT b.user_id, b.payout, b.cashout_at, b.round_id
      FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE b.status = 'cashed_out' AND b.created_at > now() - ($2 * INTERVAL '1 hour')
      ORDER BY b.payout DESC LIMIT $1`,
    [limit, period === "day" ? 24 : period === "month" ? 720 : 8760],
  );
  const multipliers = await pool.query(
    `SELECT b.user_id, b.cashout_at, b.round_id
      FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE b.status = 'cashed_out' AND b.created_at > now() - ($2 * INTERVAL '1 hour')
      ORDER BY b.cashout_at DESC LIMIT $1`,
    [limit, period === "day" ? 24 : period === "month" ? 720 : 8760],
  );
  return ok(reply, 200, {
    period,
    interval,
    topWins: wins.rows.map((row) => ({
      user: maskPlayer(row.user_id), payout: Number(row.payout), roundId: row.round_id,
    })),
    topMultipliers: multipliers.rows.map((row) => ({
      user: maskPlayer(row.user_id), mult: Number(row.cashout_at), roundId: row.round_id,
    })),
  });
});

app.get("/v1/crash/rules", async (req, reply) => {
  const limits = await effectiveLimits(await requestUserId(req));
  return ok(reply, 200, {
    rules: {
      houseEdge: env.HOUSE_EDGE,
      minBet: limits.minBet,
      maxBet: limits.maxBet,
      maxWin: limits.maxWin,
      maxMultiplier: env.MAX_MULTIPLIER,
      doublingSeconds: env.DOUBLING_SECONDS,
      bettingWindowMs: env.BETTING_WINDOW_MS,
      algorithm: FAIRNESS_ALGORITHM,
      currency: "INR",
      text: "Bet during BETTING. Cash out before the server crash to win stake × multiplier. Auto cash-out is evaluated server-side on every tick.",
    },
  });
});

app.get("/v1/crash/settings", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const result = await pool.query(
    `SELECT settings FROM crash_player_settings WHERE user_id = $1`, [userId]);
  return ok(reply, 200, {
    settings: result.rows[0]?.settings ?? {
      sound: false, animations: true, theme: "dark", language: "en", currency: "INR",
    },
  });
});

app.put("/v1/crash/settings", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const parsed = z.object({
    sound: z.boolean().optional(),
    animations: z.boolean().optional(),
    theme: z.enum(["dark", "light"]).optional(),
    language: z.string().max(16).optional(),
    currency: z.string().max(8).optional(),
  }).safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  await pool.query(
    `INSERT INTO crash_player_settings (user_id, settings) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET settings = crash_player_settings.settings || $2`,
    [userId, JSON.stringify(parsed.data)],
  );
  return ok(reply, 200, { settings: parsed.data });
});

app.post("/v1/crash/rounds/:id/bets/:betId/cancel", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const requestId = typeof req.body?.requestId === "string"
    ? req.body.requestId.slice(0, 128) : null;
  const prior = await replayRequest(userId, requestId, "cancel");
  if (prior && !prior.pending) {
    reply.header("x-idempotent-replay", "1");
    return reply.code(prior.status).send(prior.body);
  }
  await markRequestPending(userId, requestId, "cancel");
  const outcome = await serialized(async () => {
    const round = await pool.query(`SELECT status FROM crash_rounds WHERE id = $1`, [req.params.id]);
    if (!round.rowCount) return { error: [404, ERROR_CODES.NOT_FOUND, "round not found"] };
    if (round.rows[0].status !== "betting")
      return { error: [409, ERROR_CODES.CONFLICT, "betting is closed for this round"] };
    const bet = await pool.query(
      `SELECT * FROM crash_bets WHERE id = $1 AND round_id = $2 AND user_id = $3`,
      [req.params.betId, req.params.id, userId],
    );
    if (!bet.rowCount) return { error: [404, ERROR_CODES.NOT_FOUND, "bet not found"] };
    if (!["pending", "active"].includes(bet.rows[0].status))
      return { error: [409, ERROR_CODES.CONFLICT, "bet can no longer be cancelled"] };
    await refundBet(bet.rows[0]);
    return { cancelled: true, betId: req.params.betId };
  });
  if (outcome.error) return deny(reply, ...outcome.error);
  const body = {
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    success: true,
    data: outcome,
  };
  await rememberRequest(userId, requestId, "cancel", 200, body);
  return reply.code(200).send(body);
});

// ---------------------------------------------------------------------------
// Auto-bet session management
// ---------------------------------------------------------------------------

const AutoSchema = z.object({
  panel: z.coerce.number().int().min(1).max(2).optional().default(1),
  amount: z.coerce.number().positive().finite(),
  autoCashout: z.coerce.number().min(1.01).max(1000).optional(),
  rounds: z.coerce.number().int().min(1).max(1000).default(1),
  stopRules: z.object({
    balanceBelow: z.coerce.number().min(0).optional(),
    singleWinAbove: z.coerce.number().min(0).optional(),
    totalLossLimit: z.coerce.number().min(0).optional(),
  }).default({}),
});

app.get("/v1/crash/auto", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const result = await pool.query(
    `SELECT id, panel, stake, auto_cashout, rounds_left, stop_rules, stop_reason, status,
       last_round_id, created_at
      FROM crash_auto_sessions WHERE user_id = $1 ORDER BY panel`, [userId]);
  return ok(reply, 200, { sessions: result.rows });
});

app.post("/v1/crash/auto", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const parsed = AutoSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  const { panel, amount, autoCashout, rounds, stopRules } = parsed.data;
  const limits = await effectiveLimits(userId);
  if (amount < limits.minBet || amount > limits.maxBet)
    return deny(reply, 422, "BET_LIMIT_EXCEEDED", "bet amount out of range");
  await pool.query(
    `INSERT INTO crash_auto_sessions
       (user_id, panel, stake, auto_cashout, rounds_left, stop_rules, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (user_id, panel) DO UPDATE SET
       stake = EXCLUDED.stake, auto_cashout = EXCLUDED.auto_cashout,
       rounds_left = EXCLUDED.rounds_left, stop_rules = EXCLUDED.stop_rules,
       status = 'active', last_round_id = NULL, updated_at = now()`,
    [userId, panel, toMoney(amount), autoCashout?.toFixed(2) ?? null, rounds, JSON.stringify(stopRules)],
  );
  return ok(reply, 201, {
    session: {
      panel, stake: amount, autoCashout: autoCashout ?? null,
      rounds, stopRules, status: "active",
    },
  });
});

app.post("/v1/crash/auto/:panel/stop", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const panel = normalisePanel(req.params.panel);
  const result = await pool.query(
    `UPDATE crash_auto_sessions SET status = 'stopped', updated_at = now()
      WHERE user_id = $1 AND panel = $2 AND status = 'active' RETURNING id`,
    [userId, panel],
  );
  await publish("crash.auto_stopped", { userId, panel, reason: "player" });
  return ok(reply, 200, { stopped: result.rowCount > 0 });
});

/** The gateway calls this when the player's last live socket closes. Auto-bet
 * sessions are engine-side state, so a disconnect must stop them explicitly
 * instead of letting them keep staking after the client has gone away. */
app.post("/internal/crash/auto/:userId/stop", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.CRASH_SERVICE_TOKEN)) {
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  }
  const result = await pool.query(
    `UPDATE crash_auto_sessions SET status = 'stopped',
       stop_reason = 'disconnected', updated_at = now()
      WHERE user_id = $1 AND status = 'active'`, [req.params.userId],
  );
  if (result.rowCount) {
    await publish("crash.auto_stopped", {
      userId: req.params.userId, panel: null, reason: "disconnected",
    });
  }
  return ok(reply, 200, { stopped: result.rowCount });
});

// ---------------------------------------------------------------------------
// Spec player/operator surface. These paths are reached through the gateway's
// /v1/me, /v1/operator/... aliases; they reuse the same ledger as /v1/crash/*.
// ---------------------------------------------------------------------------

app.get("/v1/crash/me", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
  const [balance, limits] = await Promise.all([
    walletBalance(userId, req.headers.authorization),
    effectiveLimits(userId),
  ]);
  return ok(reply, 200, {
    userId,
    username: req.headers["x-username"] ?? null,
    currency: "INR",
    balance,
    limits: {
      minBet: toMoney(limits.minBet),
      maxBet: toMoney(limits.maxBet),
      maxWin: toMoney(limits.maxWin),
    },
  });
});

app.post("/v1/crash/operator/launch", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  const parsed = z.object({
    operatorId: z.string().min(1).max(64),
    // The operator's player ID is the platform user ID: auth resolves it and
    // mints the session, so no untrusted identity claim enters the gateway.
    playerId: z.string().min(1).max(128),
    currency: z.string().max(8).optional().default("INR"),
    mode: z.enum(["real", "demo"]).optional().default("real"),
    language: z.string().max(16).optional().default("en"),
    returnUrl: z.string().url().optional(),
  }).safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  const input = parsed.data;
  // A demo session must never move real money. This deployment has no separate
  // play-money ledger, so fail closed instead of pretending the mode isolates
  // the wallet. Operators needing demo play must integrate one first.
  if (input.mode === "demo")
    return deny(reply, 403, AV.PLAYER_BLOCKED, "demo sessions are not enabled on this deployment");
  const session = await mintOperatorSession(input.playerId, {
    operatorId: input.operatorId,
    playerId: input.playerId,
    currency: input.currency,
    mode: input.mode,
    language: input.language,
  });
  if (session?.error) return deny(reply, ...session.error);
  if (!session?.token || !session?.expiresAt)
    return deny(reply, 503, ERROR_CODES.SERVICE_UNAVAILABLE, "operator session could not be issued");
  const base = env.OPERATOR_LAUNCH_URL ?? `http://${req.headers.host ?? "localhost:3000"}/`;
  const launch = new URL(base);
  launch.searchParams.set("token", session.token);
  launch.searchParams.set("v", String(PROTOCOL_VERSION));
  launch.searchParams.set("lang", input.language);
  if (input.returnUrl) launch.searchParams.set("returnUrl", input.returnUrl);
  await publish("crash.operator_launch", {
    operatorId: input.operatorId, playerId: input.playerId, mode: input.mode,
    jti: session.jti, language: input.language,
  });
  return ok(reply, 201, {
    launchUrl: launch.toString(),
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    expiresIn: Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000)),
    userId: session.userId,
    currency: input.currency,
    mode: input.mode,
    language: input.language,
    protocol: `aviator-v${PROTOCOL_VERSION}`,
  });
});

app.get("/v1/crash/operator/rounds", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  const limit = boundedInt(req.query.limit, 50, 1, 200);
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 24 * 3600_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()))
    return deny(reply, 422, AV.VALIDATION_FAILED, "invalid time range");
  const result = await pool.query(
    `SELECT * FROM crash_rounds WHERE created_at BETWEEN $1 AND $2
      ORDER BY created_at DESC LIMIT $3`, [from.toISOString(), to.toISOString(), limit],
  );
  return ok(reply, 200, { items: result.rows.map(publicRound), from, to });
});

app.get("/v1/crash/operator/players/:playerId/bets", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  const limit = boundedInt(req.query.limit, 50, 1, 200);
  const result = await pool.query(
    `SELECT id, round_id, panel, amount, auto_cashout, cashout_at, payout, status, created_at, settled_at
      FROM crash_bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [req.params.playerId, limit],
  );
  return ok(reply, 200, { items: result.rows });
});

app.post("/v1/crash/operator/limits", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  const parsed = z.object({
    playerId: z.string().min(1).max(128).optional(),
    currency: z.string().max(8).optional(),
    minBet: z.coerce.number().positive().optional(),
    maxBet: z.coerce.number().positive().optional(),
    maxWin: z.coerce.number().positive().optional(),
  }).safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  const limits = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => ["minBet", "maxBet", "maxWin"].includes(key)),
  );
  const key = parsed.data.playerId ?? `currency:${parsed.data.currency ?? "INR"}`;
  await pool.query(
    `INSERT INTO crash_player_settings (user_id, settings) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET settings = crash_player_settings.settings || $2,
        updated_at = now()`,
    [key, JSON.stringify({ limits })],
  );
  return ok(reply, 200, { scope: key, limits });
});

app.post("/v1/crash/operator/players/:playerId/block", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  const parsed = z.object({
    blocked: z.boolean().default(true),
    reason: z.string().max(200).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  await pool.query(
    `INSERT INTO crash_player_settings (user_id, settings) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET settings = crash_player_settings.settings || $2,
        updated_at = now()`,
    [req.params.playerId, JSON.stringify({
      blocked: parsed.data.blocked,
      blockReason: parsed.data.reason ?? null,
    })],
  );
  await publish("crash.operator_block", {
    playerId: req.params.playerId, blocked: parsed.data.blocked,
  });
  return ok(reply, 200, { playerId: req.params.playerId, blocked: parsed.data.blocked });
});

app.get("/v1/crash/operator/config", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  return ok(reply, 200, {
    currencies: ["INR"],
    limits: { minBet: env.MIN_BET, maxBet: env.MAX_BET, maxWin: env.MAX_BET * env.MAX_MULTIPLIER },
    rtp: 1 - env.HOUSE_EDGE,
    houseEdge: env.HOUSE_EDGE,
    features: { doubleBet: true, autoBet: true, autoCashout: true, fairnessVerify: true, chat: true },
    protocol: "aviator-v1",
  });
});

app.post("/v1/crash/operator/freebets", async (req, reply) => {
  if (!requireOperator(req, reply)) return undefined;
  // A free bet is recorded, not silently credited: this adapter does not hold
  // player funds. The operator wallet remains the source of truth and can
  // reconcile the grant through its own promotion ledger.
  const parsed = z.object({
    playerId: z.string().min(1).max(128),
    amount: z.coerce.number().positive(),
    grantId: z.string().min(1).max(128),
  }).safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
  await publish("crash.operator_freebet", parsed.data);
  return ok(reply, 201, { ...parsed.data, credited: false, currency: "INR" });
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
    return deny(reply, 422, AV.VALIDATION_FAILED, JSON.stringify(parsed.error.flatten()));
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

// Upstream 404s reach clients through the gateway, so they need the same
// structured envelope as every other crash-service rejection.
app.setNotFoundHandler((req, reply) =>
  deny(reply, 404, ERROR_CODES.NOT_FOUND, `unknown route ${req.method} ${req.url.split(/[?#]/, 1)[0]}`));

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
