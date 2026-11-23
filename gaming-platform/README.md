# Gaming platform

Backend recovered from the pendrive's `coffee/gaming-platform` tree. The seven
original game services arrived as compiled ESM JavaScript in
`services/<name>/dist`; typed TypeScript sources now live in `src/` and compile
back to that layout. This project supplies the missing bootstrap layer and the
peer services those services assume are running, so the platform can be
installed, migrated and started as one system.

All fifteen application services boot, the thirteen migrations apply cleanly, and the main
auth / RBAC / wallet / chat / realtime / promotions / Codenames / Gin-rummy /
crash / audit flows pass end to end through the gateway (a separate 20-flow
integration run; `npm run smoke` covers the deploy-critical subset). The four
formerly separate Aviator repositories are merged into `integrations/aviator/`
and unified behind the new crash service; see below.

## Services

| Service | Port | Origin | Purpose |
| --- | --- | --- | --- |
| gateway | 3000 | new | Single entry point; JWT identity, RBAC-aware reverse proxy, SSE streaming |
| realtime | 3010 | new | Durable event hub: Postgres-backed events, `pg_notify`/`LISTEN`, HTTP publish + SSE/polling |
| wallet | 3011 | new | Idempotent bonus crediting, balances, transaction history |
| responsible-gaming | 3012 | new | Self-exclusion checks and audit log |
| admin-risk | 3013 | new | RBAC roles/permissions, hash-chained admin audit |
| tournaments | 3014 | new | Tournament catalogue and registration |
| auth | 3015 | new | Registration, login, refresh, logout, `me`; mints HS256 `{userId,username}` tokens |
| chat | 3016 | recovered | Rooms and messages; publishes `chat.*` events to realtime |
| codenames | 3017 | recovered | Games, shuffled 25-word board, clues, guesses, winner |
| game-engine | 3018 | recovered | Game sessions and players |
| gin-rummy | 3019 | recovered | Games, shuffled deck/deal, draw, discard, meld |
| leaderboard | 3020 | recovered | Verified score submission and rankings |
| pictionary | 3021 | recovered | Rounds, guesses, random word selection |
| promotions | 3022 | recovered | Catalogue, claims, wallet/RG integration |
| crash | 3023 | new | Unified Aviator game: provably-fair rounds, staking, cash-out, strategy lab |

## Aviator unification

`integrations/aviator/` archives four repositories that were merged here:
the betting bot, the React/Unity crash client, the BBC Micro 6502 source and a
PHP casino game catalogue. They are untrusted reference code and are never
executed by the platform. Their playable ideas are now implemented natively:

* `services/crash` replaces the missing scoring backend that previously forced
  `game-engine` to reject `crash` sessions. Rounds commit to a seed hash before
  betting and reveal the seed and crash point afterwards; `GET
  /v1/crash/rounds/:id` includes a verification proof.
* Stakes use the new atomic `POST /internal/wallet/debit` endpoint. Cash-outs
  use the existing idempotent credit path with keys derived from the persisted
  bet claim, so an ambiguous response replays the original wallet transaction
  instead of booking a duplicate net-zero pair.
* The browser stage renders the multiplier curve locally from the server's
  `startedAt`, while all outcomes, settlement and auto cash-outs stay
  authoritative in the service.
* The bot's strategies live on as `POST /v1/crash/strategy-lab/run`, a
  deterministic **paper-only** simulator that uses our own provably-fair
  generator and never contacts an external betting site.
* Tournaments and the leaderboard now include `crash` (plus `dice`, `flip`,
  `jackpot` and `wheel` from the Win2x catalogue). Leaderboard points require
  a verified cash-out at 2x or better in that exact game session.

## Architecture fixes

The recovered code plus its bootstrap layer had several structural defects.
These are fixed here (each fix is commented inline at the site):

- **Gateway proxying in containers** — upstreams are selected per service by
  `UPSTREAM_MODE` (`docker` uses Compose service names, `local` uses loopback).
  The previous hard-coded `127.0.0.1` broke every proxied route in Compose.
- **Identity spoofing at the edge** — the gateway strips caller-supplied
  `x-user-id`, `x-username` and `x-service-token`, asserts identity only from a
  verified player JWT, and injects only the capability token that route is
  allowed to use. Previously any caller could set `x-user-id: <victim>` and gain
  full impersonation against wallet, promotions, RG and tournaments.
- **Abuse control at the edge** — the gateway applies Redis-backed sliding-window
  limits: unauthenticated auth endpoints per source IP and all ordinary player
  routes per verified user. Every limited response carries `X-RateLimit-*`
  headers and a 429 with `Retry-After`. Event streams are sockets, not requests:
  they are exempt from the request window and counted by a separate live-socket
  cap that is released when the connection closes. Peer routes stay exempt
  because they are capability scoped. The CSP `connect-src` allow-list expands
  `CORS_ORIGIN` into exact origins, so an externally built client can reach the
  gateway without a wildcard policy.
- **Privileged route gating / audit prefix** — admin routes require a verified
  player token plus an admin-risk RBAC permission; peer-to-peer routes require
  the matching capability token. A failed RBAC check fails closed. The gateway route and
  permission lookup for the audit API were corrected to `/v1/internal/audit`,
  so `GET /v1/internal/audit/verify` now proxies correctly. The old arbitrary
  token dev-login shim is gone; `/v1/auth/*` is served by the auth service.
- **Playable game state** — `createGame` in both recovered services now seeds
  state that was previously left empty: Codenames generates the standard
  25-word board (9 red / 8 blue / 7 neutral / 1 assassin, cryptographically
  shuffled), and Gin-rummy builds a 52-card deck and deals 10 cards per player,
  one upcard and a 31-card stock. Without this, guesses had no words to match
  and every draw returned `EMPTY_PILE`.
- **Pictionary state machine** — rounds are created directly in `drawing`
  state, the drawer cannot guess their own word, and round closure is a
  conditional update so concurrent correct guesses cannot overwrite the winner.
- **Promotions/wallet consistency** — the wallet client throws on non-2xx and
  transport errors, so the claim rollback in `app.js` runs instead of leaving a
  claim with no wallet credit.
- **Leaderboard integrity** — scores are derived from authoritative game state,
  bound to one verified session via `UNIQUE (user_id, session_id)`; replays
  return the existing entry.
- **Chat and Codenames URL authority** — the URL `:room` / `:id` is authoritative
  over conflicting body fields; chat also ignores a body `room` mismatch.
- **Capability-scoped credentials** — admin, wallet, realtime, promotions and crash
  internal APIs each have a distinct token with no shared default; a
  deployment that forgets any of them fails at startup. Wallet capabilities are
  further split so promotions can only credit bonuses and crash can only debit
  stakes or credit wins/crash refunds.
- **Durable realtime** — events are persisted in `realtime_events` and published
  via `pg_notify`, so SSE polling works across process restarts. Every payload
  is recursively redacted on write and replay, so no topic can broadcast user
  ids, balances or promotion amounts to the whole lobby.
- **Readiness** — every stateful service, including promotions, exposes
  `/ready` backed by a database query. The gateway adds an aggregate `/ready`
  that reports healthy only when all fourteen downstream services are ready.
- **Migration idempotency** — `npm run migrate` records applied files in
  `schema_migrations` and skips them on subsequent runs, and now takes a
  Postgres advisory lock so two simultaneous migrators cannot race.
- **Database connection budget** — every service used a private `max: 20` pool,
  allowing roughly 270 connections against Postgres's default ceiling of 100.
  `@gp/config/dbPoolOptions` is now the single source of truth: `DB_POOL_MAX`
  (default 5) sizes every pool, with idle/connection timeouts, and Compose
  raises `max_connections` to 200. `npm run validate:compose` proves the budget.
- **Graceful shutdown** — all fifteen services now handle SIGTERM/SIGINT by
  calling `app.close()`, which drains requests and runs each service's
  `onClose` pool teardown. Compose allows 25s before a hard kill.
- **Smaller attack surface** — the fourteen internal services, Postgres and
  Redis are on a dedicated internal Compose network with no host ports; only
  the gateway is published (and must sit behind TLS in production). Redis
  requires a password, and the migrator receives only `DATABASE_URL`.
- **Container hardening** — app containers use a non-root user,
  `no-new-privileges`, `cap_drop: ALL`, a read-only root filesystem with
  `tmpfs /tmp`, and PID limits. Redis runs as its unprivileged image user;
  Postgres has bounded PID/memory/CPU usage. All containers have memory/CPU
  caps so a leaking process cannot starve the stack.

## Browser client

`frontend/` is a CRA 5 + React 18 + Sass client shaped like the reference
Aviator app, not a new UI architecture. The same module-level context,
header/board/stage/control composition and `BrowserRouter` wildcard route are
present; Socket.IO and Unity WebGL are omitted from the runtime: the crash backend now
exists as `services/crash`, the flight curve is rendered natively, and the
original Unity bundle is preserved in `integrations/aviator/crash-client/`.
Gateway-authenticated SSE carries the live `crash.*` events.

| Aviator source | Gaming-platform counterpart |
| --- | --- |
| `src/index.tsx` / `src/app.tsx` | unchanged route and provider entry shape |
| `src/context.tsx` | one `Provider` for auth, wallet, live events and actions |
| `src/config.ts` | one gateway origin, defaulting to same-origin `/v1` |
| `src/components/header.tsx` | auth, balance, audit-verification badge |
| `src/components/bet-users/*` | live events, wallet activity, leaderboard/tournaments |
| `src/components/Main/*` | history, stage and Aviator-named `Bet` control panel |
| `src/components/crash/*` | live crash stage, multiplier curve, cash-out and round proof |

The browser never sees a service token. It signs in through
`POST /v1/auth/login`, keeps the short-lived player JWT only in memory, and
receives the rotating refresh token in an `HttpOnly; SameSite=Strict` cookie
scoped to `/v1/auth`. No credential is written to `localStorage` or
`sessionStorage`; older token keys are deleted on session start and sign-out.
The client calls `/v1/*` with the in-memory token and opens
`GET /v1/events/stream?since=0` with `fetch` streaming because `EventSource`
cannot send the required `Authorization` header. The gateway injects all
identity and capability headers.

## Shared packages

- `packages/config` — `baseEnvSchema`, `loadEnv`, `registerErrorHandler`,
  `fetchWithTimeout`, and `dbPoolOptions` (the fleet-wide connection budget).
- `packages/event-bus` — Redis-backed `EventBus.publish`/`close`. Publish
  failures are logged and swallowed so a committed claim never fails the user.
- `packages/shared-types` — shared error codes, decimal-safe `toMoney`/
  `moneyMul`, and constant-time `serviceTokenOk`.

## Migrations

| File | Contents |
| --- | --- |
| `0001_init.sql` | tables used by the recovered services, Pictionary word seed, promotions schema |
| `0002_peer_services.sql` | wallet, responsible-gaming and tournament tables |
| `0003_gameplay.sql` | Codenames guesses/revealed words, Gin-rummy move columns |
| `0004_auth.sql` | users, refresh tokens, session metadata |
| `0005_admin_risk.sql` | RBAC roles/assignments, hash-chained admin audit |
| `0006_realtime.sql` | durable `realtime_events` table |
| `0007_promotions_idempotency.sql` | stable wallet idempotency key for claims |
| `0008_crash.sql` | crash rounds/bets, wager support, extended game catalogue |
| `0009_crash_recovery.sql` | `pending`/`cashing_out` bet states and persisted round deadlines |
| `0010_crash_state_guards.sql` | idempotent state guards and Gin Rummy win attribution |
| `0011_gin_rummy_win_type.sql` | neutral `completed` default for unverifiable historical wins |
| `0012_refresh_token_family.sql` | token families so logout revokes already-rotated refresh siblings |

All thirteen are applied by the one-shot `migrate` service before any application
starts, on first boot and on every upgrade. Applied files are checksummed, so
editing an already-applied migration fails the deploy instead of drifting.

## Deploy with Docker Compose

Requirements: Docker with Compose v2, a public browser origin, and port 3000
free on the host.

**TLS is mandatory in production.** The gateway itself speaks plain HTTP on
port 3000. Never expose that port directly to browsers: put a TLS-terminating
reverse proxy / load balancer in front of it, redirect HTTP to HTTPS, set HSTS
at the terminator, and firewall 3000 so only that proxy can reach it. Use an
`https://` origin in `CORS_ORIGIN`. The example values in `.env.example` and in
the local-run section below are **non-production placeholders**; generate real
secrets with `npm run env:init`.

```bash
cd coffee/gaming-platform
CORS_ORIGIN=https://play.example.com npm run env:init
docker compose up -d --build
npm run smoke
```

`env:init` generates a fresh Postgres password, a Redis password, a JWT signing
key, nine internal capability tokens (including the three wallet-scoped ones)
and the one-time admin bootstrap token, writes a `0600` `.env`, and refuses to
replace an existing one unless `--force` is passed. Compose fails before
starting anything if any required secret, `DATABASE_URL`, `REDIS_URL` or
`CORS_ORIGIN` is blank. On an existing deployment, `npm run env:init -- --force`
keeps the current `POSTGRES_PASSWORD`/`DATABASE_URL` and
`REDIS_PASSWORD`/`REDIS_URL` from the old `.env` so the reused `pgdata` and
`redisdata` volumes still authenticate; only application and capability secrets
are rotated. If an older `.env` predates the Redis password, add a matching
`REDIS_PASSWORD` and embedded `REDIS_URL` credential manually before upgrading.

Only the gateway is published on `0.0.0.0:3000` (intended to be reachable only
from the TLS proxy). Postgres, Redis and all fourteen peer services sit on a
dedicated internal Compose network with no host ports and no route to the
internet. Redis requires `REDIS_PASSWORD`; `REDIS_URL` embeds the same password
and is the only way clients (including the gateway rate limiter) connect.
`RATE_LIMIT_FAIL_CLOSED=true` makes the gateway reject traffic if Redis is
unavailable instead of weakening limits. For administration use
`docker compose exec redis redis-cli` (the container sets `REDISCLI_AUTH`) or
`docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"`.

CORS is **exact-origin**: the gateway compares the browser's whole `Origin`
value (scheme, host and port) with the entries in `CORS_ORIGIN`; it never
returns `*` for a credentialed request, emits `Vary: Origin`, applies the same
check to SSE event streams, and does not do suffix or prefix matching. Keep one
exact `https://` origin in production; a comma-separated list is an allow-list
of complete origins, not a pattern.

All application traffic — including the browser client — goes through the
gateway. The Dockerfile builds the frontend into `frontend/build`, and the
gateway serves it as a same-origin SPA with an `index.html` fallback for
client-side routes. The image is self-contained — source, migrations and
operational scripts are baked in, with no host bind mount. App containers run
as the non-root `node` user with `no-new-privileges`, all capabilities dropped,
a read-only root filesystem with `tmpfs /tmp`, and PID/memory/CPU limits. Redis
runs as the non-root `redis` user and writes only to the `redisdata` volume;
Postgres has bounded PID/memory/CPU usage and keeps its capabilities only for
the entrypoint's volume ownership hand-off. Base images are pinned to exact
patch tags and published multi-arch digests, so rebuilds cannot silently pick
up a newer base.

### Operations

- `docker compose ps` — container state and health.
- `docker compose logs -f gateway` — edge logs.
- `docker compose exec redis redis-cli ping` — authenticated Redis health.
- `docker compose run --rm migrate` — apply migrations manually.
- `npm run smoke` — gateway liveness, aggregate readiness and auth flow.
- `docker compose down` — stop, keeping `pgdata` and `redisdata`; add `-v` to
  destroy data.

For an upgrade, refresh the tree, keep the same `.env`, and run
`docker compose up -d --build`. The one-shot `migrate` service runs before the
applications on every recreate, so an existing database volume is upgraded in
place. It receives only `DATABASE_URL`, not the fleet's capability tokens.

## Run locally from Node

Requires Node 22+ on a native filesystem (npm workspaces create symlinks,
which FAT/exFAT USB mounts do not support), plus reachable Postgres and Redis.
The generated `.env` uses Compose hostnames, so override peer URLs for local
runs. `scripts/start-all.js` pins each service's `PORT` itself.

```bash
npm ci --omit=dev
export DATABASE_URL=postgresql://gp:<password>@127.0.0.1:5432/gaming_platform
# Local Redis may be unauthenticated on loopback; a generated .env instead
# uses redis://:<REDIS_PASSWORD>@redis:6379 with --requirepass on the server.
export REDIS_URL=redis://127.0.0.1:6379
# EXAMPLE-ONLY, NON-PRODUCTION SECRETS BELOW. Never reuse these values; copy
# the distinct generated values from .env or mint fresh ones for a test run.
export JWT_ACCESS_SECRET='a-long-random-secret-at-least-32-chars'
export SERVICE_TOKEN='another-long-random-secret-at-least-32-chars'
export ADMIN_SERVICE_TOKEN='admin-service-secret-at-least-32-characters'
# Full wallet capability: gateway/test/admin only (a local-only fallback for peers).
export WALLET_SERVICE_TOKEN='wallet-service-secret-at-least-32-characters'
# Scoped peer tokens; Compose injects only these into crash and promotions.
export WALLET_DEBIT_SERVICE_TOKEN='wallet-debit-secret-at-least-32-characters'
export WALLET_BONUS_SERVICE_TOKEN='wallet-bonus-secret-at-least-32-characters'
export WALLET_WIN_SERVICE_TOKEN='wallet-win-secret-at-least-32-characters'
export REALTIME_SERVICE_TOKEN='realtime-service-secret-at-least-32-characters'
export PROMOTIONS_SERVICE_TOKEN='promotions-service-secret-at-least-32-characters'
export CRASH_SERVICE_TOKEN='crash-service-secret-at-least-32-characters'
export ADMIN_BOOTSTRAP_TOKEN='bootstrap-secret-at-least-32-characters'
export REALTIME_URL=http://127.0.0.1:3010
export WALLET_URL=http://127.0.0.1:3011
export RESPONSIBLE_GAMING_URL=http://127.0.0.1:3012
export ADMIN_RISK_URL=http://127.0.0.1:3013
export WALLET_INTERNAL_URL=http://127.0.0.1:3011
export REALTIME_INTERNAL_URL=http://127.0.0.1:3010
export UPSTREAM_MODE=local
npm run migrate
npm run check
npm run start:all
```

The compiled service output is committed, so no compiler is needed to run the
platform. The seven recovered services also keep a typed `src/*.ts` tree and
per-service `tsconfig.json` extending `tsconfig.base.json`; shared packages
ship `index.d.ts` declarations.

```bash
npm run typecheck                # type-check all seven services, no output
npm run build                    # compile src/ -> dist/ for all seven services
npm run build -w @gp/codenames   # compile a single service
npm run validate:compose         # static Compose path/port validation
```

Add `npm run build` to your workflow after editing a recovered service's
`src/`.

### Frontend development

The client is a separate npm project so CRA's peer-dependency policy does not
leak into the backend workspaces. Its `.npmrc` mirrors the reference app's
legacy-peer resolution, and `package.json` proxies `/v1` to the gateway during
development.

```bash
npm run frontend:install
npm run frontend:typecheck
npm run frontend:build
npm start --prefix frontend       # http://localhost:4000, proxying to :3000
```

`REACT_APP_API_URL` may be set at build time to an absolute gateway origin;
leave it blank for the published Docker image. Copy `frontend/.env.example` if
you need local overrides. Frontend dependencies and `frontend/build` are not
committed; the Dockerfile reproduces both from `frontend/package-lock.json`.

## Calling the API

### Rate limits

Player traffic is counted before proxying. Unauthenticated auth endpoints
(register, login, refresh, logout) are limited per source IP (10 requests per
60s by default); every other `/v1/*` request - including `/v1/auth/me` and SSE
stream establishment - is limited per verified JWT subject (120 reads and 30
writes per 60s). Responses include `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `X-RateLimit-Reset`; exceeding a limit returns `429`
with `Retry-After`; event streams additionally default to 20 per user
(`RATE_LIMIT_STREAM_MAX`) within a 500-stream / 168-hour retention budget
(`MAX_STREAMS`, `EVENT_RETENTION_HOURS`). Tune with `RATE_LIMIT_WINDOW_MS`,
`RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_USER_MAX`, `RATE_LIMIT_MUTATE_MAX` and
`RATE_LIMIT_STREAM_MAX`, or set `RATE_LIMIT_ENABLED=false` for local debugging.
Counters are shared through the password-protected `REDIS_URL`; Compose defaults
`RATE_LIMIT_FAIL_CLOSED=true`, so an unavailable Redis returns
`429 RATE_LIMIT_UNAVAILABLE` instead of silently weakening the limit. Only an
explicit `RATE_LIMIT_FAIL_CLOSED=false` keeps local fallback counters.

### Auth

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"Ada","email":"ada@example.com","password":"correct horse battery staple"}'

TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"Ada","password":"correct horse battery staple"}' | jq -r .data.token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/auth/me
```

### RBAC and internal routes

Privileged routes need a player token **and** a permission granted through
admin-risk. `/internal/events` and `/internal/wallet` are exceptions: they are
capability-token-only. Each internal API has its own token, so a compromised
service cannot reuse its own credential to mint credits or admin roles.

Wallet credentials are scoped further:

| Token | Holder | Authorizes |
| --- | --- | --- |
| `WALLET_SERVICE_TOKEN` | gateway, tests/admin | any wallet credit type or debit; this is the internal-route capability the gateway injects for `/internal/wallet/*` |
| `WALLET_DEBIT_SERVICE_TOKEN` | crash | `/internal/wallet/debit` only |
| `WALLET_BONUS_SERVICE_TOKEN` | promotions | `/internal/wallet/credit` with `type=bonus` only |
| `WALLET_WIN_SERVICE_TOKEN` | crash | `/internal/wallet/credit` with `type=win` only, plus the exact crash refund shape (`type=adjustment`, `referenceType=crash_refund`, `idempotencyKey` beginning `crash-refund-`) |

A scoped token used outside its operation/type gets `403 FORBIDDEN`; an unknown
token still gets `401 UNAUTHORIZED`. Crash and promotions send only their narrow
token, in `x-service-token`; Compose does not give them the full wallet
credential at all. The gateway still injects the full token for
`/internal/wallet/*` because that route is the gateway/test/admin capability.
The wallet also accepts a token in `x-wallet-scope` as authoritative when an
older peer supplies one, but that header cannot escalate privileges. The
legacy `WALLET_SERVICE_TOKEN` env name is a local-only fallback for peers; it
is validated before use and is never injected into the scoped containers.

Claim the first admin exactly once, through the gateway, with the player token
of the account that should become admin:

```bash
curl -X POST http://localhost:3000/v1/admin-risk/bootstrap \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-bootstrap-token: $ADMIN_BOOTSTRAP_TOKEN" \
  -d "{\"userId\":\"$USER_ID\"}"

# Further grants require roles.manage (the admin role has it).
curl -X POST http://localhost:3000/v1/admin-risk/roles/grant \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"userId":"<user-id>","role":"support"}'

# Reading the audit chain also goes through the gateway.
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/internal/audit/verify

# Service-to-service event publish uses the realtime capability token.
curl -X POST http://localhost:3000/internal/events \
  -H 'content-type: application/json' -H "x-service-token: $REALTIME_SERVICE_TOKEN" \
  -d '{"topic":"chat.message","payload":{"room":"lobby","text":"hi"}}'
```

Tournament creation is an admin action (`tournaments.manage`) because it sets
entry fees and prize pools.

### Realtime

Event reads require a player JWT; clients may not subscribe globally with a
service token. Retention can prune rows behind an old `since` cursor, so both
polling and SSE replay report an explicit `gap` (`resync_required`,
`oldest_seq`) instead of silently skipping history. SSE emits an id-less
`event: gap` control frame before replaying the earliest retained rows, so the
last numeric event id is unchanged. Event topics are restricted to a safe
single-line SSE event-name pattern on both publish and replay.

```bash
curl -N -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/events/stream?since=0'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/events'
```

### Codenames

```bash
# Create (the board is generated server-side and never exposed to clients).
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"session_id":"<existing-game-session-uuid>"}' \
  http://localhost:3000/v1/codenames/games

# Host starts play.
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"status":"active"}' \
  http://localhost:3000/v1/codenames/games/<game-id>/status

# Guess a word for a team; a correct red word ends the game with red as winner.
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"word":"<word>","team":"red"}' \
  http://localhost:3000/v1/codenames/games/<game-id>/guess
```

### Gin-rummy

```bash
# Create, then join (the joiner moves first).
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"session_id":"<existing-game-session-uuid>"}' \
  http://localhost:3000/v1/gin-rummy/games
curl -X POST -H "Authorization: Bearer $TOKEN2" \
  http://localhost:3000/v1/gin-rummy/games/<game-id>/join

# Draw, discard, then declare a meld (3+ of a rank or a same-suit run).
curl -X POST -H "Authorization: Bearer $TOKEN2" -H 'content-type: application/json' \
  -d '{"source":"stock"}' http://localhost:3000/v1/gin-rummy/games/<game-id>/draw
curl -X POST -H "Authorization: Bearer $TOKEN2" -H 'content-type: application/json' \
  -d '{"card":"5H"}' http://localhost:3000/v1/gin-rummy/games/<game-id>/discard
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"melds":[["5H","5D","5C"]]}' http://localhost:3000/v1/gin-rummy/games/<game-id>/meld
```

### Crash (unified Aviator game)

```bash
# Current round, its published seed hash and (when flying) multiplier.
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/crash/rounds/current

# Optional: create a crash session first so a 2x+ cash-out can score on the
# leaderboard. Stake while the round is in `betting` (sessionId is optional).
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"game_type":"crash"}' http://localhost:3000/v1/game/sessions
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"amount":10,"autoCashout":2,"sessionId":"<session-id>"}' \
  http://localhost:3000/v1/crash/rounds/<round-id>/bets

# Withdraw before the crash; the service computes the authoritative multiplier.
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{}' http://localhost:3000/v1/crash/rounds/<round-id>/cashout

# After the round: seed, crash point and verification proof are public.
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/crash/rounds/<round-id>

# Paper-only replay of the vendored bot strategies (no real stakes).
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"seed":"demo","rounds":1000,"stake":10,"target":2}' \
  http://localhost:3000/v1/crash/strategy-lab/run
```

## Validation

- `npm run check` — syntax-checks every JavaScript file outside `node_modules`.
- `npm run typecheck` — strict type-checks all seven TypeScript services.
- `npm run validate:compose` — checks Compose paths, commands, unique host
  ports, gateway-only public exposure, the database connection budget,
  `/ready` probes, shutdown handlers and resource limits without a Docker
  daemon.
- `npm audit --omit=dev` — reports 0 vulnerabilities with the pinned
  `@fastify/jwt` 10.x and `zod` 4.x dependency set.
- `npm run smoke` — gateway liveness, aggregate `/ready`, auth flow, crash round
  feed and the paper-only strategy lab through the gateway. Run it after
  `docker compose up -d --build`.

## Known gaps

- `npm ci` cannot create npm-workspace symlinks on FAT/exFAT USB mounts. Use
  Docker Compose as the primary runnable path, or copy the tree to a native
  filesystem before installing dependencies locally.
- Realtime uses Postgres `LISTEN`/`NOTIFY` rather than Redis for fan-out; Redis
  remains available to shared packages and as a persisted Compose service.
- The recovered services ship both readable `src/*.ts` and committed
  `dist/*.js`; the container runs `dist/` unless you rebuild it explicitly.
