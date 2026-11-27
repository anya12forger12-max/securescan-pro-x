/** Every stored event is replayed to every authenticated player, so every
 * payload is redacted on write and read. Topic-specific exceptions used to let
 * `config.updated` publish user ids and bonus amounts to the whole lobby.
 * Unknown fields (e.g. a `marker` used by tests) are preserved. */
export const SENSITIVE_KEYS = new Set([
  "userId",
  "user_id",
  "playerId",
  "player_id",
  "operatorId",
  "operator_id",
  "grantId",
  "grant_id",
  "jti",
  "token",
  "accessToken",
  "amount",
  "payout",
  "cashoutAt",
  "cashout_at",
  "autoCashout",
  "auto_cashout",
  "losers",
  "balanceAfter",
  "balance_after",
  "sessionId",
  "session_id",
  "referenceId",
  "reference_id",
  "email",
  "username",
]);

/** Crash feed rows are public by design, but only in their masked, rounded
 * form. Allowing these exact keys on these exact topics keeps the Aviator
 * history strip useful without reopening the generic payout/identity leak. */
const FEED_TOPICS = new Set(["crash.bet", "crash.cashout"]);
const FEED_PUBLIC_KEYS = new Set(["betId", "stake", "mult", "payout", "user"]);

/** Recursive, idempotent redaction for public-broadcast payloads. Dates are
 * returned untouched so JSON.stringify can serialize them normally. */
export function sanitizeEventData(value, topic, depth = 0) {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeEventData(item, topic, depth + 1));
  if (value === null || typeof value !== "object") return value;
  const feedTopic = FEED_TOPICS.has(topic);
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__") continue;
    // Feed whitelists are top-level only. A nested `user` object or `payout`
    // must not slip through just because a parent happens to be a feed row.
    if (SENSITIVE_KEYS.has(key) && !(feedTopic && depth === 0 && FEED_PUBLIC_KEYS.has(key))) continue;
    clean[key] = sanitizeEventData(item, topic, depth + 1);
  }
  return clean;
}

/** Applied on write and on every read so older rows cannot leak either. */
export const sanitizePayload = (payload, topic) => sanitizeEventData(payload ?? {}, topic);

export function publicEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return event;
  return { ...event, payload: sanitizePayload(event.payload, event.topic) };
}
