import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Operator request signatures.
 *
 * The legacy `x-signature` header signed only the JSON body, so any captured
 * signature could be replayed against a different method/path/player and never
 * expired. v2 binds the exact route, path/query parameters, timestamp and
 * nonce to the signature. Callers must still present `x-api-key`.
 */

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;

export const SIGNATURE_SKEW_SECONDS = 300;
export const NONCE_TTL_SECONDS = 600;
export const SIGNATURE_VERSION = 2;

/** Canonical JSON: object keys are sorted recursively so whitespace and key
 * order cannot change the signature. Arrays keep their order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The exact material an operator signs. `route` is the Fastify route pattern
 * (including `:playerId` under the public `/v1/operator/*` alias) and `params`
 * carries its concrete values, so a captured signature cannot be retargeted to
 * another player. */
export function operatorSignedMaterial({
  method, route, params = {}, query = {}, body = {}, ts, nonce,
}) {
  return [
    `gp-operator-v${SIGNATURE_VERSION}`,
    String(method ?? "").toUpperCase(),
    String(route ?? ""),
    canonicalJson(params),
    canonicalJson(query),
    String(ts),
    String(nonce),
    canonicalJson(body ?? {}),
  ].join("\n");
}

export function operatorSignature(secret, input) {
  return createHmac("sha256", secret).update(operatorSignedMaterial(input)).digest("hex");
}

/** The gateway rewrites `/v1/operator/*` to `/v1/crash/operator/*`; sign the
 * public alias so operators never have to know the internal prefix. */
export function operatorRoute(route) {
  return String(route ?? "").replace(/^\/v1\/crash\/operator/, "/v1/operator");
}

export function constantTimeEqualHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (!HEX_SHA256.test(left) || !HEX_SHA256.test(right)) return false;
  return timingSafeEqual(
    Buffer.from(left.toLowerCase(), "hex"),
    Buffer.from(right.toLowerCase(), "hex"),
  );
}

/** Verify v2 headers and clock skew. Nonce replay is enforced by the caller
 * with an atomic database insert. */
export function verifyOperatorSignatureV2(
  secret,
  { headers = {}, method, route, params, query, body },
  nowSeconds = Date.now() / 1000,
) {
  const signature = headers["x-signature-v2"];
  const tsRaw = headers["x-ts"];
  const nonce = headers["x-nonce"];
  if (
    typeof signature !== "string" || !signature ||
    typeof tsRaw !== "string" || !tsRaw ||
    typeof nonce !== "string" || !nonce
  ) {
    return { ok: false, reason: "missing_v2_headers" };
  }
  const ts = Number(tsRaw);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(nowSeconds) - ts) > SIGNATURE_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, reason: "invalid_nonce" };

  const expected = operatorSignature(secret, { method, route, params, query, body, ts, nonce });
  if (!constantTimeEqualHex(signature, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true, ts, nonce };
}
