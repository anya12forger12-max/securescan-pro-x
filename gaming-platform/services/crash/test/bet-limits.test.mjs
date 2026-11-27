import test from "node:test";
import assert from "node:assert/strict";
import { combinedStakeExceeded } from "../bet-limits.js";

test("two auto panels respect an operator's per-player maxBet, not just the global cap", () => {
  // The global env.MAX_BET may be 10000 while the player is limited to 1000.
  assert.equal(combinedStakeExceeded(900, 900, 1000), true);
  assert.equal(combinedStakeExceeded(900, 100, 1000), false);
  assert.equal(combinedStakeExceeded(0, 1000, 1000), false);
  assert.equal(combinedStakeExceeded(0, 1001, 1000), true);
});

test("malformed stake or ceiling fails closed", () => {
  assert.equal(combinedStakeExceeded(0, "abc", 1000), true);
  assert.equal(combinedStakeExceeded("abc", 10, 1000), true);
  assert.equal(combinedStakeExceeded(10, 10, undefined), true);
});
