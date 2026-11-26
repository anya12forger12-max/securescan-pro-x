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
