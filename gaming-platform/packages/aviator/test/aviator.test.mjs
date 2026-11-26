import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASES, assertTransition, canTransition, commitment, crashPoint,
  verifyFairness, multiplierAt, durationForPoint, phaseForRound,
  buildSnapshot, buildFeed, maskPlayer, normalisePanel, moneyString,
} from "../index.js";

test("commitment is sha256 of the server seed", () => {
  assert.equal(
    commitment("a81b"),
    "fa7d110b564640427209a673d1c298706cc96c9a972dd860a6643b846254f61c",
  );
});

test("crash point is deterministic and verifiable", () => {
  const seed = "server-seed-42";
  const client = "x1y2z3";
  const point = crashPoint(seed, client);
  assert.equal(crashPoint(seed, client), point);
  const verified = verifyFairness({
    serverSeed: seed,
    clientSeed: client,
    seedHash: commitment(seed),
    crashPoint: point,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.algorithm, "hmac-sha256-v1");
  assert.equal(verified.hashMatches, true);
  assert.equal(verified.pointMatches, true);
});

test("tampering with the revealed seed or point fails verification", () => {
  const seed = "server-seed-42";
  const hash = commitment(seed);
  const point = crashPoint(seed, "client");
  assert.equal(verifyFairness({ serverSeed: seed, seedHash: hash, crashPoint: point + 1 }).valid, false);
  assert.equal(verifyFairness({ serverSeed: "other", seedHash: hash, crashPoint: point }).valid, false);
});

test("house edge produces instant crashes near the declared rate", () => {
  let instant = 0;
  const rounds = 100000;
  for (let i = 0; i < rounds; i++) if (crashPoint(`seed-${i}`, "client") === 1) instant++;
  const rate = instant / rounds;
  assert.ok(rate > 0.025 && rate < 0.045, `instant crash rate ${rate}`);
});

test("round lifecycle only allows ordered transitions", () => {
  assert.deepEqual([...PHASES], ["WAITING", "BETTING", "FLYING", "CRASHED", "SETTLING"]);
  for (let i = 0; i < PHASES.length; i++) {
    const from = PHASES[i];
    const to = PHASES[(i + 1) % PHASES.length];
    assert.equal(canTransition(from, to), true);
    assert.equal(canTransition(from, PHASES[(i + 2) % PHASES.length]), false);
    assert.equal(assertTransition(from, to), true);
  }
  assert.throws(() => assertTransition("WAITING", "CRASHED"));
});

test("multiplier matches the doubling curve and crash duration", () => {
  assert.equal(multiplierAt(0, 3), 1);
  assert.equal(multiplierAt(3000, 3), 2);
  assert.equal(multiplierAt(6000, 3), 4);
  assert.equal(durationForPoint(4, 3), 6000);
});

test("phase mapping respects server deadlines", () => {
  const now = 1_800_000_000_000;
  const base = { created_at: new Date(now - 1000).toISOString(), doubling_seconds: 3 };
  assert.equal(phaseForRound({ ...base, status: "betting" }, now), "BETTING");
  assert.equal(phaseForRound({ ...base, status: "betting", created_at: new Date(now - 9000).toISOString() }, now), "FLYING");
  assert.equal(phaseForRound({ ...base, status: "running", started_at: new Date(now - 1000).toISOString(), crash_point: 4 }, now), "FLYING");
  assert.equal(phaseForRound({ ...base, status: "running", started_at: new Date(now - 9000).toISOString(), crash_point: 4 }, now), "CRASHED");
  assert.equal(phaseForRound({ status: "finished" }, now), "CRASHED");
  assert.equal(phaseForRound(null, now), "WAITING");
});

test("snapshot and feed frames use protocol fields and masked names", () => {
  const snapshot = buildSnapshot({
    round: { id: "r1", status: "running", seed_hash: "abc", started_at: "2026-01-01T00:00:00Z" },
    balance: { amount: 1500, currency: "INR" },
    myBets: [{ id: "b1", panel: 1, amount: 100, auto_cashout: 1.5, status: "placed" }],
    history: ["1.23", 4.8],
    limits: { minBet: 10, maxBet: 500, maxWin: 50000 },
    serverTime: 1_800_000_000_000,
  });
  assert.equal(snapshot.t, "snapshot");
  assert.equal(snapshot.v, 1);
  assert.equal(snapshot.round.state, "FLYING");
  assert.equal(snapshot.balance.amount, "1500.00");
  assert.equal(snapshot.myBets[0].autoCashout, "1.50");
  assert.equal(snapshot.history[0], "1.23");
  assert.equal(snapshot.limits.maxBet, "500.00");

  const feed = buildFeed([{
    type: "cashout", betId: "b1", user: "alice", stake: 100,
    mult: 1.94, payout: 194,
  }]);
  assert.equal(feed.t, "feed");
  assert.equal(feed.list[0].user, "a***e");
  assert.equal(feed.list[0].payout, "194.00");
});

test("panel and money helpers reject invalid values", () => {
  assert.equal(normalisePanel(undefined), 1);
  assert.equal(normalisePanel(2), 2);
  assert.throws(() => normalisePanel(3));
  assert.equal(moneyString(100), "100.00");
  assert.equal(maskPlayer("bob"), "b***b");
});
