import test from "node:test";
import assert from "node:assert/strict";
import {
  bearerActive,
  checkFrameRateLimit,
  decodeFrames,
  textFrame,
} from "../../../services/gateway/aviator-ws.js";

/** Build a masked client frame the way a browser does. */
function clientFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
}

test("server text frames carry an unmasked length and exact payload", () => {
  const frame = textFrame(JSON.stringify({ t: "tick", mult: "2.37" }));
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1] & 0x80, 0, "server frames must never be masked");
  assert.equal(JSON.parse(frame.subarray(2).toString("utf8")).mult, "2.37");
});

test("server frames above 125 bytes use the 16-bit length", () => {
  const frame = textFrame("x".repeat(300));
  assert.equal(frame[1], 126);
  assert.equal(frame.readUInt16BE(2), 300);
  assert.equal(frame.subarray(4).toString("utf8"), "x".repeat(300));
});

test("masked client frames decode incrementally across TCP chunks", () => {
  const first = clientFrame('{"t":"ping","ts":123}');
  const second = clientFrame('{"t":"bet","panel":2}');
  const combined = Buffer.concat([first, second]);
  const partial = decodeFrames(combined.subarray(0, first.length + 3));
  assert.equal(partial.frames.length, 1);
  assert.equal(partial.rest.length, 3);
  const complete = decodeFrames(Buffer.concat([partial.rest, combined.subarray(first.length + 3)]));
  assert.equal(complete.frames.length, 1);
  assert.deepEqual(JSON.parse(complete.frames[0].text), { t: "bet", panel: 2 });
});

test("unmasked and oversized client frames are rejected", () => {
  assert.throws(() => decodeFrames(Buffer.from([0x81, 0x02, 0x61, 0x62])), /unmasked/);
  const huge = Buffer.alloc(12);
  huge[0] = 0x81;
  huge[1] = 0xff;
  huge.writeBigUInt64BE(2n ** 40n, 2);
  assert.throws(() => decodeFrames(huge), /frame too large/);
});

test("privileged socket frames re-check token liveness", async () => {
  let active = true;
  const seen = [];
  const verifyToken = async (req) => {
    seen.push(req.headers.authorization);
    return active
      ? { status: "valid", claims: { userId: "u1" } }
      : { status: "invalid" };
  };
  assert.equal(await bearerActive(verifyToken, "jwt-1"), true);
  active = false;
  assert.equal(await bearerActive(verifyToken, "jwt-1"), false);
  assert.equal(await bearerActive(verifyToken, null), false);
  assert.deepEqual(seen, ["Bearer jwt-1", "Bearer jwt-1"]);
});

test("socket writes share the REST per-user write bucket", async () => {
  const calls = [];
  const limiter = {
    check: async (key, limit) => {
      calls.push([key, limit]);
      return { allowed: false, limit, remaining: 0, resetAt: 1 };
    },
  };
  const result = await checkFrameRateLimit(limiter, { mutateMax: 30 }, "user-1");
  assert.equal(result.allowed, false);
  assert.deepEqual(calls, [["user:user-1:write", 30]]);

  assert.deepEqual(await checkFrameRateLimit(null, {}, "user-1"), { allowed: true });
  const fallback = [];
  await checkFrameRateLimit({ check: async (key, limit) => { fallback.push([key, limit]); return { allowed: true }; } }, {}, "user-2");
  assert.deepEqual(fallback, [["user:user-2:write", 30]]);
});
