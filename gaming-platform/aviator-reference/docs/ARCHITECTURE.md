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
  creates a Web Audio context only after a user gesture and stores the
  preference locally; signed-in players also persist it via
  `PUT /v1/crash/settings`.
* Accessibility: buttons and inputs have visible focus rings and 44 px touch
  targets, `C` cashes out the first live panel, a polite live region announces
  phase changes (never ticks), and `prefers-reduced-motion` plus an in-game
  switch disable non-essential animation.
* Embedding is handled by a strict `postMessage` bridge (see `OPERATOR.md`):
  origin allow-list, source check, envelope marker, validated safe theme
  tokens, and no credential in either direction.
