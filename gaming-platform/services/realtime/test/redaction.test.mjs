import test from "node:test";
import assert from "node:assert/strict";
import { publicEvent, sanitizePayload } from "../redaction.js";

test("operator identifiers are stripped from public event payloads", () => {
  const payload = sanitizePayload({
    topic: "crash.operator_block",
    playerId: "victim",
    operatorId: "operator-1",
    grantId: "grant-1",
    blocked: true,
    nested: [{ player_id: "other", reason: "manual" }],
    marker: "kept",
  });
  assert.deepEqual(payload, {
    topic: "crash.operator_block",
    blocked: true,
    nested: [{ reason: "manual" }],
    marker: "kept",
  });
});

test("publicEvent redacts stored payloads on read", () => {
  const event = publicEvent({
    id: "e1",
    topic: "crash.operator_freebet",
    payload: { playerId: "p1", grantId: "g1", mode: "real" },
  });
  assert.deepEqual(event.payload, { mode: "real" });
});

test("session identifiers are redacted from operator launch events", () => {
  const payload = sanitizePayload({
    operatorId: "op-1",
    playerId: "victim",
    jti: "session-jti",
    token: "signed-token",
    accessToken: "another-token",
    mode: "real",
  }, "crash.operator_launch");
  assert.deepEqual(payload, { mode: "real" });
});

test("masked crash feed rows keep only their public top-level fields", () => {
  const payload = sanitizePayload({
    betId: "bet-1",
    stake: "10",
    mult: 1.5,
    payout: "15",
    user: "v***",
    nested: { payout: "secret", referenceId: "ref-1" },
  }, "crash.bet");
  assert.deepEqual(payload, {
    betId: "bet-1",
    stake: "10",
    mult: 1.5,
    payout: "15",
    user: "v***",
    nested: {},
  });
});
