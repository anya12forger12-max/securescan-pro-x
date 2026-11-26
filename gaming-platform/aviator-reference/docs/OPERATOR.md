# Operator integration contract

All operator endpoints live behind the gateway's `/v1/operator/*` alias and are
implemented in `services/crash/index.js`. They are disabled (401) unless both
`OPERATOR_API_KEY` and `OPERATOR_API_SECRET` are configured. Never reuse an
internal service token as an operator key.

## Authentication

```
x-api-key: <operator API key>
x-signature: hmac_sha256(OPERATOR_API_SECRET, canonical_json(body))
```

`canonical_json` recursively sorts object keys; arrays keep their order. GET
requests sign `{}`. Both values are compared in constant time.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/operator/launch` | Issue a short-lived launch URL/token (5 minutes) |
| GET | `/v1/operator/rounds?from=&to=&limit=` | Round report for a time range |
| GET | `/v1/operator/players/{id}/bets?limit=` | One player's settled and active bets |
| POST | `/v1/operator/limits` | Per-player or per-currency bet limits (`minBet`/`maxBet` are enforced on every wager; `maxWin` is reported to clients) |
| POST | `/v1/operator/players/{id}/block` | Operator block / self-exclusion signal |
| GET | `/v1/operator/config` | Currencies, limits, RTP, enabled features |
| POST | `/v1/operator/freebets` | Record a promotional grant (no wallet credit) |

A player blocked through the operator endpoint is rejected by the same
`wageringAllowed()` gate that enforces responsible-gaming self-exclusion, so a
blocked player cannot stake even if the RG service is briefly unavailable.

## Wallet direction

The provider calls the operator wallet only through `services/wallet`:
`POST /internal/wallet/debit` for a stake and `POST /internal/wallet/credit`
for a payout or refund. Every call carries a unique `idempotencyKey` derived
from the persisted bet claim. The operator must treat a repeated key as the
same transaction. Unresolved calls are left for the crash reconciler, never
silently reversed.

## Socket

`GET /v1/ws?token=<session token>&v=1` (trailing query `v` is advisory; the
server replies at protocol version 1). Server frames include `snapshot`,
`round_start`, `betting_closed`, `tick`, `crash`, `bet_ok`, `bet_err`,
`cashout_ok`, `cashout_err`, `balance`, `feed`, `chat_msg`, `error`, `pong`.
Client frames include `bet`, `cancel_bet`, `cashout`, `auto_start`, `auto_stop`,
`chat`, `ping`. Each request `reqId` is echoed in its reply.
