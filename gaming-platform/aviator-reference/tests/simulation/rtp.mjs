/**
 * Verification simulation for the published crash formula.
 *
 *   node aviator-reference/tests/simulation/rtp.mjs [rounds] [edge] [doublingSeconds] [maxMultiplier]
 *
 * This is a verification tool, not game logic: it uses the same pure functions
 * the authoritative crash service uses. No wallet or database is involved.
 *
 * The crash distribution is heavy tailed (roughly P(crash >= x) = 1/x), so the
 * *average crash point* is not the game's RTP. The meaningful check is the
 * return of a fixed cash-out target: P(crash >= target) * target.
 */

import { crashPoint, durationForPoint } from "../../../packages/aviator/index.js";

const rounds = Math.max(1, Number(process.argv[2] ?? 100000));
const edge = Number(process.argv[3] ?? 0.03);
const doubling = Number(process.argv[4] ?? 3);
const cap = Number(process.argv[5] ?? 100);
const targets = [1.5, 2, 3, 5, 10];

let instant = 0;
let capped = 0;
let sum = 0;
let longest = 0;
const survived = Object.fromEntries(targets.map((target) => [target, 0]));

for (let i = 0; i < rounds; i++) {
  const raw = crashPoint(`simulation-seed-${i}`, "client-seed", edge);
  const point = Math.min(raw, cap);
  if (raw === 1) instant++;
  if (raw > cap) capped++;
  sum += point;
  longest = Math.max(longest, durationForPoint(point, doubling));
  for (const target of targets) if (point >= target) survived[target]++;
}

console.log(JSON.stringify({
  rounds,
  houseEdge: edge,
  maxMultiplier: cap,
  doublingSeconds: doubling,
  instantCrashShare: Number((instant / rounds).toFixed(6)),
  expectedInstantShare: Number((1 / Math.floor(1 / edge)).toFixed(6)),
  cappedShare: Number((capped / rounds).toFixed(6)),
  meanCrashPoint: Number((sum / rounds).toFixed(4)),
  longestFlightMs: Math.round(longest),
  fixedTargetRtp: Object.fromEntries(targets.map((target) => [
    String(target), Number(((survived[target] / rounds) * target * 100).toFixed(2)),
  ])),
}, null, 2));
