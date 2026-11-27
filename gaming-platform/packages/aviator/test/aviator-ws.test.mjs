import test from "node:test";
import assert from "node:assert/strict";
import { decodeFrames, textFrame } from "../../../services/gateway/aviator-ws.js";

/** Build a masked client frame the way a browser does. */
function maskedFrame(payload, opcode = 1, fin = true) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const first = (fin ? 0x80 : 0) | opcode;
  let header;
  if (bytes.length < 126) {
    header = Buffer.from([first, 0x80 | bytes.length]);
  } else if (bytes.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(bytes.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(bytes.length), 2);
  }
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) masked[i] = bytes[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}
const clientFrame = (text) => maskedFrame(text);

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

test("fragmented text messages are reassembled up to a bounded size", () => {
  const first = maskedFrame(Buffer.from('{"t":"ping",'), 1, false);
  const second = maskedFrame(Buffer.from('"ts":123}'), 0, true);
  const decoded = decodeFrames(Buffer.concat([first, second]));
  assert.equal(decoded.frames.length, 1);
  assert.deepEqual(JSON.parse(decoded.frames[0].text), { t: "ping", ts: 123 });

  const largeFirst = maskedFrame(Buffer.alloc(600_000, 0x61), 1, false);
  const largeSecond = maskedFrame(Buffer.alloc(600_000, 0x62), 0, true);
  assert.throws(
    () => decodeFrames(Buffer.concat([largeFirst, largeSecond])),
    /message too large/,
  );
});

test("invalid frame shapes are rejected", () => {
  assert.throws(() => decodeFrames(Buffer.from([0x81, 0x02, 0x61, 0x62])), /unmasked/);
  const huge = Buffer.alloc(12);
  huge[0] = 0x81;
  huge[1] = 0xff;
  huge.writeBigUInt64BE(2n ** 40n, 2);
  assert.throws(() => decodeFrames(huge), /frame too large/);
  assert.throws(() => decodeFrames(maskedFrame("x", 0)), /unexpected continuation/);
  assert.throws(() => decodeFrames(maskedFrame("x", 8, false)), /invalid control frame/);
  assert.throws(() => decodeFrames(Buffer.from([0xb1, 0x80, 0x00, 0x00, 0x00, 0x00])), /reserved/);
  assert.throws(() => decodeFrames(maskedFrame(Buffer.from([0xff]))), /utf-8/i);
});
