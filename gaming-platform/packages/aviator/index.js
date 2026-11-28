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
/** Live rounds are committed from (serverSeed, roundId) with the platform's
 * house edge / ceiling. This is the algorithm published in /rules and verified
 * by the public fairness endpoint. */
export const FAIRNESS_ALGORITHM = "hmac-sha256-v1";
/** Legacy/client-seed construction from the design document. Kept for clients
 * that still supply an explicit client seed; it is NOT the live round algorithm. */
export const CLIENT_SEED_ALGORITHM = "hmac-sha256-client-seed-v1";

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

/**
 * The live round construction. HMAC-SHA256(serverSeed, roundId) supplies a
 * uniform 32-bit value; the same heavy-tail curve is then applied with the
 * round's persisted house edge and ceiling. Keeping this here (rather than in
 * the crash service alone) means the public verifier and the engine can never
 * drift apart again.
 */
export function hmacUnit(serverSeed, roundId) {
  return createHmac("sha256", String(serverSeed)).update(String(roundId)).digest().readUInt32BE(0) / 0x100000000;
}

export function pointFromUnit(u, houseEdge = 0.02, maxMultiplier = 100) {
  const unit = Number(u);
  if (!Number.isFinite(unit)) throw new Error("invalid fairness unit");
  if (unit < houseEdge) return 1;
  const normalised = (unit - houseEdge) / (1 - houseEdge);
  const raw = Math.min(maxMultiplier, 1 / (1 - normalised * 0.99));
  return Math.max(1, Math.floor(raw * 100) / 100);
}

export function crashPointFromRound(serverSeed, roundId, houseEdge = 0.02, maxMultiplier = 100) {
  return pointFromUnit(hmacUnit(serverSeed, roundId), houseEdge, maxMultiplier);
}

/** Verify a revealed live round against its pre-committed hash and point. */
export function verifyRoundFairness({
  serverSeed, roundId, seedHash, crashPoint: published,
  houseEdge = 0.02, maxMultiplier = 100,
}) {
  if (typeof serverSeed !== "string" || !serverSeed || !roundId) {
    return { valid: false, reason: "MISSING_SEED_OR_ROUND" };
  }
  const computedHash = commitment(serverSeed);
  const computedPoint = crashPointFromRound(serverSeed, roundId, houseEdge, maxMultiplier);
  const hashMatches = typeof seedHash !== "string" || !seedHash
    ? null
    : computedHash === seedHash.toLowerCase();
  const pointMatches = published === undefined || published === null
    ? null
    : Math.abs(Number(published) - computedPoint) < 0.001;
  // Both the pre-committed hash and the published point must be checked. A
  // partial verifier would give false assurance with nothing to compare.
  const valid = hashMatches === true && pointMatches === true;
  return {
    valid,
    reason: valid ? undefined : hashMatches === null ? "MISSING_SEED_HASH"
      : pointMatches === null ? "MISSING_CRASH_POINT" : "MISMATCH",
    seedHash: computedHash,
    crashPoint: computedPoint,
    hashMatches,
    pointMatches,
    algorithm: FAIRNESS_ALGORITHM,
    inputs: { roundId: String(roundId), houseEdge, maxMultiplier },
  };
}

/** Verify a client-seed round using the construction from the design docs. */
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
  const valid = hashMatches === true && pointMatches === true;
  return {
    valid,
    reason: valid ? undefined : hashMatches === null ? "MISSING_SEED_HASH"
      : pointMatches === null ? "MISSING_CRASH_POINT" : "MISMATCH",
    seedHash: computedHash,
    crashPoint: computedPoint,
    hashMatches,
    pointMatches,
    algorithm: CLIENT_SEED_ALGORITHM,
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
  "round_settling", "round_voided",
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
  if (text === "***" || text === "") return "***";
  if (text.length <= 2) return `${text[0]}***`;
  return `${text[0]}***${text[text.length - 1]}`;
}

/** Protocol timestamps are epoch milliseconds, matching `serverTime`. Accept
 * already-numeric values and ISO strings so callers can pass either form. */
export function epochMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Build the snapshot frame a client receives on connect / reconnect.
 *
 * A snapshot may arrive while betting is still open, so it must never carry
 * the committed outcome: including `crashPoint` before reveal lets a client
 * bet at the exact peak. Only explicitly revealed/finished rounds expose their
 * point; cancelled rounds stay sealed, and the server seed is never part of a
 * snapshot at all.
 */
export function buildSnapshot({
  round, balance, myBets = [], history = [], limits = {},
  serverTime = Date.now(), bettingWindowMs = 5000,
}) {
  // The crash point is precomputed when the round is created. It is a secret
  // until settlement. A cancelled round was never played, so its committed
  // point stays sealed too and must not be treated as revealed anywhere in the
  // protocol.
  const status = round?.status ?? round?.state ?? null;
  const revealed = round?.revealed === true || status === "finished"
    || (["CRASHED", "SETTLING"].includes(status) && round?.crashPoint !== null
      && round?.crashPoint !== undefined);
  const start = epochMs(round?.created_at ?? round?.createdAt);
  const endsAt = round?.betting_ends_at ?? round?.bettingEndsAt
    ?? (status === "betting" && start !== null ? start + bettingWindowMs : null);
  const roundFrame = round
    ? {
        id: round.id,
        state: phaseForRound(round, serverTime, bettingWindowMs),
        seedHash: round.seed_hash ?? round.seedHash ?? null,
        flightStart: epochMs(round.started_at ?? round.startedAt),
        bettingEndsAt: epochMs(endsAt),
        // Configuration, not outcome: clients need these to render the curve.
        doublingSeconds: Number(round.doubling_seconds ?? round.doublingSeconds ?? 3),
        maxMultiplier: Number(round.max_multiplier ?? round.maxMultiplier ?? 100),
        ...(revealed
          ? { crashPoint: round.crash_point === null || round.crash_point === undefined
              ? null : Number(round.crash_point ?? round.crashPoint) }
          : {}),
      }
    : null;
  return {
    t: "snapshot",
    v: PROTOCOL_VERSION,
    serverTime,
    round: roundFrame,
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

/**
 * Defensive filter applied again at the socket boundary. Even if an upstream
 * snapshot accidentally includes a proof field, it must never reach a client
 * before the outcome is revealed.
 */
export function sanitizeSnapshot(frame) {
  if (!frame || frame.t !== "snapshot") return frame;
  const out = { ...frame };
  for (const field of ["seed", "serverSeed", "proof"]) delete out[field];
  if (out.round && typeof out.round === "object") {
    out.round = { ...out.round };
    for (const field of ["seed", "serverSeed", "proof"]) delete out.round[field];
    const revealed = out.round.revealed === true
      || ["CRASHED", "SETTLING"].includes(out.round.state)
      || out.round.status === "finished";
    if (!revealed) delete out.round.crashPoint;
  }
  return out;
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
