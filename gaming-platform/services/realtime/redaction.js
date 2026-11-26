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

/** Recursive, idempotent redaction for public-broadcast payloads. Dates are
 * returned untouched so JSON.stringify can serialize them normally. */
export function sanitizeEventData(value) {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeEventData);
  if (value === null || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key) || key === "__proto__") continue;
    clean[key] = sanitizeEventData(item);
  }
  return clean;
}

/** Applied on write and on every read so older rows cannot leak either. */
export const sanitizePayload = (payload) => sanitizeEventData(payload ?? {});

export function publicEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return event;
  return { ...event, payload: sanitizePayload(event.payload) };
}
