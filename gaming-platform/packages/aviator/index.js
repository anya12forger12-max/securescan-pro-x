/**
 * @gp/aviator — original reference implementation of the Aviator-style crash
 * protocol described in the five design documents. Everything here is pure:
 * the crash service owns the authoritative clock and the wallet, this package
 * only defines the maths, the state machine and the wire vocabulary shared by
 * the backend, the web client and the sandbox verifier.
 *
 * The formula is a well-known public HMAC-SHA256 crash construction, not
 * Spribe's proprietary implementation.
 */

import { createHash, createHmac } from "node:crypto";

export const PROTOCOL_VERSION = 1;
export const FAIRNESS_ALGORITHM = "hmac-sha256-v1";

/** Canonical round lifecycle. A round may never skip SETTLING. */
export const PHASES = Object.freeze([
  "WAITING",
  "BETTING",
  "FLYING",
  "CRASHED",
  "SETTLING",
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  WAITING: ["BETTING"],
  BETTING: ["FLYING"],
  FLYING: ["CRASHED"],
  CRASHED: ["SETTLING"],
  SETTLING: ["WAITING"],
});

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Throws on an illegal transition; used by the engine's own tests. */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`illegal round transition ${from} -> ${to}`);
  }
  return true;
}

/** SHA-256 commitment published before betting opens. */
export function commitment(serverSeed) {
  return createHash("sha256").update(String(serverSeed)).digest("hex");
}

/**
 * Derive a crash point from a committed seed.
 *
 *   d = HMAC-SHA256(serverSeed, clientSeed)
 *   h = first 52 bits of d
 *   e = 2^52
 *   if h % floor(1 / edge) === 0 -> 1.00   (house edge as instant crashes)
 *   otherwise (100e - h) / (e - h) / 100, clamped at >= 1.00
 *
 * BigInt keeps the division exact for the full 52-bit domain.
 */
export function crashPoint(serverSeed, clientSeed = "", edge = 0.03) {
  const digest = createHmac("sha256", String(serverSeed)).update(String(clientSeed)).digest("hex");
  const h = BigInt(`0x${digest.slice(0, 13)}`);
  const e = 1n << 52n;
  const edgeBound = Math.floor(1 / edge);
  if (edgeBound > 0 && h % BigInt(edgeBound) === 0n) return 1;
  // (100e - h) / (100 * (e - h)) rounded to the published 2dp precision.
  const numerator = 100n * e - h;
  const denominator = 100n * (e - h);
  const scaled = Number((numerator * 1000n) / denominator) / 1000;
  return Math.max(1, Math.round(scaled * 100) / 100);
}

/** Verify a revealed seed against the hash published before the round. */
export function verifyFairness({ serverSeed, clientSeed = "", seedHash, crashPoint: published, edge = 0.03 }) {
  if (typeof serverSeed !== "string" || !serverSeed) {
    return { valid: false, reason: "MISSING_SEED" };
  }
  const computedHash = commitment(serverSeed);
  const computedPoint = crashPoint(serverSeed, clientSeed, edge);
  const hashMatches = typeof seedHash !== "string" || !seedHash
    ? null
    : computedHash === seedHash.toLowerCase();
  const pointMatches = published === undefined || published === null
    ? null
    : Math.abs(Number(published) - computedPoint) < 0.001;
  return {
    valid: hashMatches !== false && pointMatches !== false,
    seedHash: computedHash,
    crashPoint: computedPoint,
    hashMatches,
    pointMatches,
    algorithm: FAIRNESS_ALGORITHM,
  };
}

/** Server-clock multiplier. The client may interpolate, never decide. */
export function multiplierAt(elapsedMs, doublingSeconds = 3) {
  const seconds = Math.max(0, Number(elapsedMs) || 0) / 1000;
  return Math.pow(2, seconds / Math.max(0.001, Number(doublingSeconds) || 3));
}

export function durationForPoint(point, doublingSeconds = 3) {
  return Math.max(0, Math.log2(Math.max(1, Number(point) || 1)) * Math.max(0.001, Number(doublingSeconds) || 3) * 1000);
}

/**
 * Map a persisted crash round onto the canonical lifecycle. The service keeps
 * its legacy status column (`betting`/`running`/`finished`/`cancelled`) so old
 * data keeps working; deadlines make the mapping authoritative after a restart.
 */
export function phaseForRound(round, now = Date.now(), bettingWindowMs = 5000) {
  const status = round?.status;
  if (status === "cancelled") return "SETTLING";
  if (status === "finished") return "CRASHED";
  if (status === "betting") {
    const opensAt = Date.parse(round.created_at ?? round.createdAt ?? "");
    const window = Number(round.betting_window_ms ?? round.bettingWindowMs ?? bettingWindowMs) || 5000;
    const endsAt = Number.isFinite(opensAt) ? opensAt + window : NaN;
    return Number.isFinite(endsAt) && now > endsAt ? "FLYING" : "BETTING";
  }
  if (status === "running") {
    const started = Date.parse(round.started_at ?? round.startedAt ?? "");
    const point = Number(round.crash_point ?? round.crashPoint);
    const flight = Number.isFinite(started) && Number.isFinite(point) && point > 0
      ? started + durationForPoint(point, Number(round.doubling_seconds ?? round.doublingSeconds) || 3)
      : NaN;
    return Number.isFinite(flight) && now >= flight ? "CRASHED" : "FLYING";
  }
  return "WAITING";
}

/** Server -> client frame names from the realtime protocol. */
export const SERVER_MESSAGES = Object.freeze([
  "snapshot", "round_start", "betting_closed", "tick", "crash",
  "bet_ok", "bet_err", "cashout_ok", "cashout_err", "balance",
  "feed", "chat_msg", "error", "pong",
]);

/** Client -> server frame names. */
export const CLIENT_MESSAGES = Object.freeze([
  "bet", "cancel_bet", "cashout", "auto_start", "auto_stop", "chat", "ping",
]);

export const ERROR_CODES = Object.freeze({
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 422,
  NOT_IN_BETTING_PHASE: 409,
  INSUFFICIENT_FUNDS: 402,
  BET_LIMIT_EXCEEDED: 422,
  DUPLICATE_REQUEST: 200,
  ROUND_CRASHED: 409,
  PLAYER_BLOCKED: 403,
  WALLET_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
});

const PANELS = Object.freeze([1, 2]);

export function normalisePanel(panel) {
  if (panel === undefined || panel === null || panel === "") return 1;
  const value = Number(panel);
  if (!PANELS.includes(value)) {
    throw Object.assign(new Error("panel must be 1 or 2"), { code: "VALIDATION_FAILED" });
  }
  return value;
}

/** Money is handled as decimal strings/integers, never binary floats. */
export function moneyString(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("invalid money value");
  return n.toFixed(2);
}

export function maskPlayer(name) {
  const text = String(name ?? "").trim();
  if (text.length <= 2) return text ? `${text[0]}***` : "***";
  return `${text[0]}***${text[text.length - 1]}`;
}

/** Build the snapshot frame a client receives on connect / reconnect. */
export function buildSnapshot({
  round, balance, myBets = [], history = [], limits = {},
  serverTime = Date.now(), bettingWindowMs = 5000,
}) {
  // The crash point is precomputed when the round is created. It is a secret
  // until settlement: revealing it for a betting/running round lets a player
  // bet or auto-cashout with certainty. Keep it internal for phase maths and
  // only publish it once the round row is terminal.
  const status = round?.status ?? round?.state;
  const outcomeKnown = status === "finished" || status === "cancelled"
    || status === "CRASHED" || status === "SETTLING";
  return {
    t: "snapshot",
    v: PROTOCOL_VERSION,
    serverTime,
    round: round
      ? {
          id: round.id,
          state: phaseForRound(round, serverTime, bettingWindowMs),
          seedHash: round.seed_hash ?? round.seedHash ?? null,
          flightStart: round.started_at ?? round.startedAt ?? null,
          bettingEndsAt: round.betting_ends_at ?? round.bettingEndsAt ?? null,
          crashPoint: outcomeKnown ? (round.crash_point ?? round.crashPoint ?? null) : null,
        }
      : null,
    balance: balance
      ? { amount: moneyString(balance.amount), currency: balance.currency ?? "INR" }
      : null,
    myBets: myBets.map((bet) => ({
      betId: bet.id,
      panel: bet.panel ?? 1,
      amount: moneyString(bet.amount),
      autoCashout: bet.auto_cashout === null || bet.auto_cashout === undefined
        ? null
        : moneyString(bet.auto_cashout),
      status: bet.status,
    })),
    history: history.map((point) => moneyString(point)),
    limits: {
      minBet: moneyString(limits.minBet ?? 10),
      maxBet: moneyString(limits.maxBet ?? 500),
      maxWin: moneyString(limits.maxWin ?? 50000),
    },
  };
}

/** Batched live-feed frame. Identifiers are masked before fan-out. */
export function buildFeed(events) {
  return {
    t: "feed",
    list: events.map((event) => ({
      type: event.type,
      betId: event.betId,
      user: maskPlayer(event.user),
      stake: moneyString(event.stake),
      mult: event.mult === null || event.mult === undefined ? null : moneyString(event.mult),
      payout: event.payout === null || event.payout === undefined ? null : moneyString(event.payout),
    })),
  };
}
