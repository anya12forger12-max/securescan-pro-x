import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  constantTimeEqualHex,
  operatorRoute,
  operatorSignature,
  verifyOperatorSignatureV2,
} from "../operator-auth.js";

const secret = "operator-secret-long-enough-for-tests";
const now = 1_800_000_000;
const request = {
  method: "POST",
  route: "/v1/operator/players/:playerId/block",
  params: { playerId: "victim" },
  query: { limit: "10" },
  body: { blocked: true },
  ts: now,
  nonce: "nonce-1234567890",
};

const headersFor = (input, overrides = {}) => ({
  "x-signature-v2": operatorSignature(secret, input),
  "x-ts": String(input.ts),
  "x-nonce": input.nonce,
  ...overrides,
});

test("canonical JSON is stable regardless of key order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test("internal operator routes are signed as their public alias", () => {
  assert.equal(
    operatorRoute("/v1/crash/operator/players/:playerId/block"),
    "/v1/operator/players/:playerId/block",
  );
  assert.equal(operatorRoute("/v1/operator/config"), "/v1/operator/config");
});

test("v2 signature verifies for the exact method, route, params, query and body", () => {
  const result = verifyOperatorSignatureV2(
    secret,
    { ...request, headers: headersFor(request) },
    now,
  );
  assert.deepEqual(result, { ok: true, ts: now, nonce: request.nonce });
});

test("captured signatures cannot be retargeted to another player or method", () => {
  const headers = headersFor(request);
  for (const changed of [
    { ...request, params: { playerId: "other" } },
    { ...request, method: "GET" },
    { ...request, route: "/v1/crash/operator/freebets" },
    { ...request, query: { limit: "50" } },
    { ...request, body: { blocked: false } },
  ]) {
    const result = verifyOperatorSignatureV2(secret, { ...changed, headers }, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad_signature");
  }
});

test("timestamps outside the skew window and malformed headers are rejected", () => {
  const stale = verifyOperatorSignatureV2(
    secret,
    { ...request, headers: headersFor(request) },
    now + 301,
  );
  assert.deepEqual(stale, { ok: false, reason: "stale_timestamp" });

  const missing = verifyOperatorSignatureV2(secret, { ...request, headers: {} }, now);
  assert.deepEqual(missing, { ok: false, reason: "missing_v2_headers" });

  const badNonce = verifyOperatorSignatureV2(
    secret,
    { ...request, headers: headersFor(request, { "x-nonce": "short" }) },
    now,
  );
  assert.deepEqual(badNonce, { ok: false, reason: "invalid_nonce" });
});

test("hex comparison rejects malformed signatures without throwing", () => {
  assert.equal(constantTimeEqualHex("abc", "abc"), false);
  assert.equal(constantTimeEqualHex("z".repeat(64), "a".repeat(64)), false);
  const sig = operatorSignature(secret, request);
  assert.equal(constantTimeEqualHex(sig.toUpperCase(), sig), true);
});
