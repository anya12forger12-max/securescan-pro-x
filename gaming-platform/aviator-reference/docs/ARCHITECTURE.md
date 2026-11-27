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

- Before betting, the service publishes `sha256(serverSeed)` as `seedHash`. A
  round is committed from **both** the seed and its public UUID, so the seed
  hash alone cannot be replayed against another round.
- The live crash point is
  `crashPointFromRound(serverSeed, roundId, houseEdge, maxMultiplier)`: the first
  32 bits of `HMAC-SHA256(serverSeed, roundId)` are mapped through the same
  heavy-tail curve in the engine, the public verifier and the round proof. The
  published algorithm is `hmac-sha256-v1`.
- The design document's client-seed construction is still available as
  `hmac-sha256-client-seed-v1` for manually verifying legacy proofs, but it is
  never used to generate a live round. `POST /v1/crash/fairness/verify` accepts
  an explicit `algorithm` so the two paths cannot be confused.
- After settlement the seed is revealed; `/v1/crash/fairness/verify` recomputes
  both the hash and the point. Any mismatch is reported as invalid.
- Snapshots and ticks are derived from `serverTime` and the configured ceiling,
  never from the hidden outcome. `crashPoint` only appears once a round is
  revealed, and the server seed is never part of a snapshot.

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

## Browser presentation

`frontend/src/components/crash/AviatorStage.tsx` is the only crash-specific
screen; every other game keeps its original layout. The stage draws the flight
curve on a canvas from server time, but all outcomes, cash-outs and auto-bet
stop rules stay authoritative in the crash service. REST/SSE remain the
fallback when the protocol v1 socket is unavailable.

* All player-visible strings live in `frontend/src/i18n/aviator.ts`. English is
  the base dictionary; Hindi and Arabic fall back to it for missing keys.
  `Intl.NumberFormat` and `Intl.DateTimeFormat` handle currency, number and
  date formatting, and Arabic switches the stage to `dir="rtl"`.
* Sound is off until the player opts in. `frontend/src/hooks/useSound.ts`
  creates a Web Audio context only after a user gesture. The saved server
  preference wins on load; local storage is only a fallback before sign-in.
  Every toggle is persisted via `PUT /v1/crash/settings` when signed in.
* Accessibility: buttons and inputs have visible focus rings and 44 px touch
  targets, `C` cashes out the first live panel, a polite live region announces
  phase changes (never ticks), and `prefers-reduced-motion` plus an in-game
  switch disable non-essential animation.
* Embedding is handled by a strict `postMessage` bridge (see `OPERATOR.md`):
  origin allow-list, source check, envelope marker, validated safe theme
  tokens, and no credential in either direction.
