# Aviator reference layout

This directory is the **standalone reference map** for the Aviator-style crash
game described in the five design documents. It is deliberately documentation
and verification tooling, not a second runtime: the live platform continues to
run the authoritative services in `services/`, `packages/` and `frontend/`.

Nothing in this tree is executed by Compose or imported by the browser bundle.
The vendored third-party projects under `integrations/aviator/` are also
reference-only.

## Layout → live implementation

| Reference component | Live implementation |
| --- | --- |
| `apps/web-client` | `frontend/src/components/crash/AviatorStage.tsx` + `aviator.scss` (canvas curve, two bet panels, auto tabs, fairness/rules modals), `frontend/src/i18n/aviator.ts` (locales/formatters), `frontend/src/hooks/useSound.ts` (opt-in cues) |
| `apps/admin` | `frontend/src/components/admin` and the operator REST surface in `services/crash/index.js` |
| `services/gateway` | `services/gateway/index.js` (JWT, rate limits, CORS) and `services/gateway/aviator-ws.js` (protocol v1 socket) |
| `services/game-engine` | `services/crash/index.js` round lifecycle (`WAITING → BETTING → FLYING → CRASHED → SETTLING`) |
| `services/fairness` | `packages/aviator/index.js` (`commitment`, `crashPoint`, `verifyFairness`) |
| `services/wallet` | `services/wallet/index.js` (idempotent debit/credit ledger) |
| `services/social` | `services/chat`, `services/realtime`, `services/leaderboard` |
| `packages/protocol` | `packages/aviator/index.js` (message vocabulary) + `aviator-reference/packages/protocol/messages.schema.json` |
| `packages/common` | `packages/config`, `packages/shared-types` |
| `infra/*` | root `docker-compose.yml`, Dockerfiles, `.github/workflows` |
| `tests/unit` | `packages/aviator/test/aviator.test.mjs`, `aviator-ws.test.mjs`, `frontend-i18n.test.mjs` (`node --test packages/aviator/test`) |
| `tests/simulation` | `aviator-reference/tests/simulation/rtp.mjs` |
| `tests/load` | `scripts/feature-check.mjs`, `scripts/security-suite.mjs` |
| `docs` | this README, `docs/ARCHITECTURE.md`, `docs/OPERATOR.md` |

## Design invariants

1. The crash point is committed **before** betting closes and never changes.
2. The server is the only clock. Clients interpolate the curve but never decide
   a cash-out; auto cash-out is evaluated server-side on every tick.
3. Money lives in the wallet ledger. Unique idempotency keys make ambiguous
   debit/credit responses safe to replay, and reconciliation finishes claims
   interrupted by a restart.
4. Chat, leaderboards and statistics are off the critical path.
5. Every state transition is published through the realtime hub and is therefore
   part of the durable audit trail.

## Run the simulation

```sh
npm run aviator:simulate -- 200000
npm run aviator:simulate -- 200000 0.03 3 100
```

It reports the empirical instant-crash share and effective RTP against the
declared house edge and maximum multiplier. See `docs/ARCHITECTURE.md` for the
component map and `docs/OPERATOR.md` for the signed operator contract.
