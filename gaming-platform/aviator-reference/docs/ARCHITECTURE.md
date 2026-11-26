# Architecture map

```
browser ── HTTPS /v1/* ──┐
        ── WS /v1/ws ────┼── gateway (auth, rate limits, CORS, socket upgrade)
                         │      ├── crash (round state machine, ticks, settlement)
                         │      │      ├── @gp/aviator (commitment, crash point, verify)
                         │      │      ├── wallet (idempotent debit/credit ledger)
                         │      │      └── responsible-gaming (fail-closed wager gate)
                         │      ├── realtime (durable event hub → SSE + WS bridge)
                         │      └── chat / leaderboard (non-critical social path)
                         └── PostgreSQL (rounds, bets, auto sessions, settings, ledger)
```

## Round lifecycle

`WAITING → BETTING → FLYING → CRASHED → SETTLING → WAITING`

The authoritative columns remain the legacy `status` values
(`betting`/`running`/`finished`/`cancelled`) so in-flight and historical data
keep working. `phaseForRound()` maps them onto the canonical phase using the
persisted `created_at`, `started_at` and crash point, so a process restart can
never turn a stale round into a free win.

## Fairness

- Before betting, the service publishes `sha256(serverSeed)` as `seedHash`.
- The crash point is `crashPoint(serverSeed, clientSeed, houseEdge)` using a
  52-bit HMAC-SHA256 extraction.
- After settlement the seed is revealed; `/v1/fairness/verify` recomputes both
  the hash and the point. Any mismatch is reported as invalid.

## Money

Stakes are reserved in `crash_bets` **before** the wallet debit, with a unique
`idempotency_key` derived from the bet id. Cash-outs follow the same
claim-then-credit pattern. An ambiguous wallet response is replayed with the
same key; a definitive rejection refunds the claim. A reconciler finalises
claims left in flight by a restart.

## Scaling

One crash process owns the round clock; ticks are cheap (a pure function of
elapsed time) and are fanned out through the realtime hub. Stateless gateways
can be scaled horizontally. Chat and statistics never block a wager.
