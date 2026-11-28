# Operator integration contract

All operator endpoints live behind the gateway's `/v1/operator/*` alias and are
implemented in `services/crash/index.js`. They are disabled (401) unless both
`OPERATOR_API_KEY` and `OPERATOR_API_SECRET` are configured. Never reuse an
internal service token as an operator key. Apply migration
`0021_operator_signature_nonces.sql` before enabling operator credentials; v2
verification fails closed if the nonce table is missing.

## Authentication

The operator API key is accepted as `x-api-key` or as
`Authorization: Bearer <operator API key>`; both must match the configured
key. New deployments must use v2 signatures:

```
x-ts: <unix seconds, ±300>
x-nonce: <random 16-128 char string, unique per request>
x-signature-v2: <hex hmac_sha256(OPERATOR_API_SECRET, signed_material)>
```

`signed_material` is newline-joined:

```
gp-operator-v2
<METHOD>
<route pattern, e.g. /v1/operator/players/:playerId/block>
canonical_json(req.params)
canonical_json(req.query)
<ts>
<nonce>
canonical_json(req.body or {})
```

`canonical_json` recursively sorts object keys; arrays keep their order. The
signature binds the player id, method, query and body, so a captured request
cannot be replayed against a different target. Nonces are single-use per API
key (migration `0021`) and timestamps outside the five-minute window are
rejected. All comparisons are constant time. A request that presents v2 headers
but gets the signature or timestamp wrong is rejected outright; it is never
downgraded to v1.

Legacy `x-signature: hmac_sha256(OPERATOR_API_SECRET, canonical_json(body))`
is accepted only when the deployment explicitly sets
`OPERATOR_ALLOW_LEGACY_SIGNATURES=true` as a temporary migration step. Raw-body
and compact-JSON signatures from older integrators are accepted in that window.
To make the replayable v1 scheme safer during migration, add `X-Timestamp`
(epoch milliseconds) and `X-Nonce` and sign the envelope
`"<timestamp>\n<nonce>\n<body>"`; a stale timestamp or reused nonce is then
rejected. Set `OPERATOR_TIMESTAMP_REQUIRED=true` to require that envelope for
legacy calls. This setting does not weaken v2, which always carries its own
fresh timestamp and single-use nonce.

Set `OPERATOR_IP_ALLOWLIST` to a comma-separated list of IPs/CIDRs to restrict
operator calls; the gateway forwards the proxy-resolved client IP and strips
any client-supplied value. Operator calls also have their own
`RATE_LIMIT_OPERATOR_MAX` quota at the gateway.

Upgrading an existing deployment requires a new scoped credential,
`AUTH_SESSION_SERVICE_TOKEN`, in `.env`. Generate it with `openssl rand -hex 32`
(or re-run `npm run env:init` and merge the new value); Compose intentionally
refuses to start if it is missing. Crash receives this token only for operator
session minting, and auth refuses to mint a session for an admin, risk,
support or other privileged account.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/operator/launch` | Issue a short-lived launch URL/token (5 minutes) that the gateway accepts as a real session |
| GET | `/v1/operator/rounds?from=&to=&limit=` | Round report for a time range |
| GET | `/v1/operator/players/{id}/bets?limit=` | One player's settled and active bets |
| POST | `/v1/operator/limits` | Per-player or per-currency bet limits (`minBet`/`maxBet` gate every wager; `maxWin` caps every cash-out) |
| POST | `/v1/operator/players/{id}/block` | Operator block / self-exclusion signal |
| GET | `/v1/operator/config` | Currencies, limits, RTP, enabled features |
| POST | `/v1/operator/freebets` | Record a promotional grant (no wallet credit) |

A player blocked through the operator endpoint is rejected by the same
`wageringAllowed()` gate that enforces responsible-gaming self-exclusion, so a
blocked player cannot stake even if the RG service is briefly unavailable.

## Launch sessions

`playerId` is the platform user UUID. The crash service verifies the operator
credential, then asks auth (the only holder of `JWT_PRIVATE_KEY`) to mint a
normal RS256 access token. That token is registered with a `jti` and generation
and is accepted by the gateway exactly like a login token, so it can also be
revoked. Requests carry `mode`, `currency` and `language`; the reply echoes them
and returns `expiresAt`. The browser strips `token`, `v` and `lang` from the
address bar after consuming the launch URL. `mode: demo` is rejected unless a
separate play-money ledger is configured: a demo launch must never silently
stake real funds.

## Wallet direction

With no operator wallet configured, the provider calls its own ledger through
`services/wallet`: `POST /internal/wallet/debit` for a stake and
`POST /internal/wallet/credit` for a payout or refund. Every call carries a
unique `idempotencyKey` derived from the persisted bet claim. The operator must
treat a repeated key as the same transaction. Unresolved calls are left for the
crash reconciler, never silently reversed.

To let the operator hold funds, set `OPERATOR_WALLET_URL` (HTTPS) and
`OPERATOR_WALLET_SECRET`. The crash service then calls:

| Path | Body (signed with `X-Signature`) |
| --- | --- |
| `/wallet/balance` | `txId`, `playerId`, `currency`, `timestamp`, `nonce` |
| `/wallet/debit` | `txId`, `playerId`, `roundId`, `betId`, `amount`, `currency`, `timestamp`, `nonce` |
| `/wallet/credit` | `txId`, `playerId`, `roundId`, `betId`, `amount`, `currency`, `timestamp`, `nonce` |
| `/wallet/rollback` | `txId`, `originalTxId`, `reason`, `currency`, `timestamp`, `nonce` |

The same values are sent as `X-Timestamp` and `X-Nonce` headers. `X-Signature`
is `hmac_sha256(raw body, OPERATOR_WALLET_SECRET)`; the operator can reject a
stale timestamp using the same `OPERATOR_TIMESTAMP_SKEW_MS` window. A response
signature, when present, is checked against the same secret, and a response
`X-Timestamp`, when present, must be fresh. `txId` is the
existing deterministic claim key, so retries never move money twice. A debit
that times out is replayed with the same `txId`; a refund uses rollback rather
than a fresh credit so a late debit cannot be applied afterwards.

## Socket

`GET /v1/ws?token=<session token>&v=1`. A `v` other than 1 is rejected during
the handshake. All protocol timestamps are epoch milliseconds; money fields in
socket frames are two-decimal strings. Server frames include `snapshot`,
`round_start`, `betting_closed`, `tick`, `crash`, `round_settling`,
`round_voided`, `bet_ok`, `bet_err`, `cashout_ok`, `cashout_err`, `balance`,
`feed`, `chat_msg`, `error`, `pong`. Client frames include `bet`, `cancel_bet`,
`cashout` (by `betId` or `panel`), `auto_start`, `auto_stop`, `chat`, `ping`.
Each request `reqId` is echoed in its reply, and a repeated `reqId` returns the
original result. Clients should ping every 15 seconds; a silent socket is
closed after 45 seconds. Fragmented RFC 6455 frames are reassembled. A snapshot
never contains the hidden crash point or server seed.

## Embedding in an operator site

The stage can be served in an iframe using the launch URL from
`POST /v1/operator/launch`. Add the embedding origin to the build-time
`REACT_APP_OPERATOR_ORIGINS` list (comma separated) **and** to the gateway's
runtime `FRAME_ANCESTORS_ORIGINS` list, otherwise the browser will refuse to
frame the page because the shell sends `frame-ancestors 'none'`. Same-origin
parents are always accepted; every other parent is rejected unless listed in
both places. The game never sends an access or refresh token over `postMessage`.

Every message is an envelope `{ gp: 1, type, payload? }`. Replies are addressed
to the exact verified `event.origin`, never to `*`.

| Direction | `type` | Payload / reply |
| --- | --- | --- |
| game → parent | `ready` | `{ game: 'aviator', version: 1 }` |
| parent → game | `balance-refresh` | replies `balance` with `{ balance, currency }` |
| parent → game | `close` | replies `closed` with `{ reason: 'operator' }` |
| parent → game | `limits` | `{ minBet, maxBet }`, replies `limits-applied` or `error` (`VALIDATION_FAILED`) |
| parent → game | `theme` | `{ primaryColor?, logo?, language? }`, replies `theme-applied` |
| parent → game | `language` | `{ language }`, replies `language-applied` |
| game → parent | `error` | `{ code: 'UNKNOWN_MESSAGE' \| 'VALIDATION_FAILED' }` |

Themes are deliberately narrow: `primaryColor` must be a six-digit hex colour,
`logo` must be a same-origin absolute path or an `https://` URL, and `language`
must be one of the bundled locales. Layout, CSS and game logic cannot be
changed from a message. Use a restrictive `Content-Security-Policy` on the
shell page (`frame-src` limited to the game origin) and validate `event.source`
on the parent side as well.

Player-facing preferences (language, sound, animations) are persisted through
`PUT /v1/crash/settings` when signed in; operator overrides are session-scoped
and never overwrite the player's saved settings.
