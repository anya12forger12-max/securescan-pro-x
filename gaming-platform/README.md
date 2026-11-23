# Gaming platform

Backend recovered from the pendrive's `coffee/gaming-platform` tree. The seven
original game services arrived as compiled ESM JavaScript in
`services/<name>/dist`; typed TypeScript sources now live in `src/` and compile
back to that layout. This project supplies the missing bootstrap layer and the
peer services those services assume are running, so the platform can be
installed, migrated and started as one system.

All fifteen services boot, the eight migrations apply cleanly, and the main
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
  use the existing idempotent credit path with a key derived from the bet id,
  so an ambiguous response can never pay twice.
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
  limits: unauthenticated auth endpoints per source IP, all other player routes
  (including event streams) per verified user. Every limited response carries
  `X-RateLimit-*` headers and a 429 with `Retry-After`. Peer routes stay exempt
  because they are capability scoped.
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
  deployment that forgets any of them fails at startup.
- **Durable realtime** — events are persisted in `realtime_events` and published
  via `pg_notify`, so SSE polling works across process restarts.
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
- **Smaller attack surface** — the fourteen internal services are exposed only
  on the Compose network (`expose`, no host port publishing). Only the gateway
  is reachable from the host.
- **Resource limits** — every application container is capped at 512 MiB and
  1 CPU so a single leaking process cannot starve the rest of the stack.

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
`POST /v1/auth/login`, stores only the player JWT, calls `/v1/*`, and opens
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

All eight are applied by the one-shot `migrate` service before any application
starts, on first boot and on every upgrade. Applied files are checksummed, so
editing an already-applied migration fails the deploy instead of drifting.

## Deploy with Docker Compose

Requirements: Docker with Compose v2, a public browser origin, and port 3000
free on the host.

```bash
cd coffee/gaming-platform
CORS_ORIGIN=https://play.example.com npm run env:init
docker compose up -d --build
npm run smoke
```

`env:init` generates a fresh Postgres password, JWT signing key, all six
internal capability tokens and the one-time admin bootstrap token, writes a
`0600` `.env`, and refuses to replace an existing one unless `--force` is
passed. Compose fails before starting anything if any required secret or
`DATABASE_URL` / `CORS_ORIGIN` is blank.

Only the gateway is published on `0.0.0.0:3000`. Postgres and Redis bind to
`127.0.0.1` for local administration; the other fourteen services are reachable
only from inside the Compose network. All application traffic — including the
browser client — goes through `http://<host>:3000`. The Dockerfile builds the
frontend into `frontend/build`, and the gateway serves it as a same-origin SPA
with an `index.html` fallback for client-side routes. Set `CORS_ORIGIN` to that
same public origin. The image is self-contained — source, migrations and
operational scripts are baked in, with no host bind mount.

### Operations

- `docker compose ps` — container state and health.
- `docker compose logs -f gateway` — edge logs.
- `docker compose run --rm migrate` — apply migrations manually.
- `npm run smoke` — gateway liveness, aggregate readiness and auth flow.
- `docker compose down` — stop, keeping `pgdata` and `redisdata`; add `-v` to
  destroy data.

For an upgrade, refresh the tree, keep the same `.env`, and run
`docker compose up -d --build`. The one-shot `migrate` service runs before the
applications on every recreate, so an existing database volume is upgraded in
place.

## Run locally from Node

Requires Node 22+ on a native filesystem (npm workspaces create symlinks,
which FAT/exFAT USB mounts do not support), plus reachable Postgres and Redis.
The generated `.env` uses Compose hostnames, so override peer URLs for local
runs. `scripts/start-all.js` pins each service's `PORT` itself.

```bash
npm ci --omit=dev
export DATABASE_URL=postgresql://gp:<password>@127.0.0.1:5432/gaming_platform
export REDIS_URL=redis://127.0.0.1:6379
export JWT_ACCESS_SECRET='a-long-random-secret-at-least-32-chars'
# Use the distinct values from .env (or generate fresh ones for a test run).
export SERVICE_TOKEN='another-long-random-secret-at-least-32-chars'
export ADMIN_SERVICE_TOKEN='admin-service-secret-at-least-32-characters'
export WALLET_SERVICE_TOKEN='wallet-service-secret-at-least-32-characters'
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
with `Retry-After`. Tune with `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX`,
`RATE_LIMIT_USER_MAX` and `RATE_LIMIT_MUTATE_MAX`, or set
`RATE_LIMIT_ENABLED=false` for local debugging. Counters are shared through
`REDIS_URL`; if Redis is unavailable the gateway keeps local counters and
continues serving unless `RATE_LIMIT_FAIL_CLOSED=true`, in which case it returns
`429 RATE_LIMIT_UNAVAILABLE` instead of silently weakening the limit.

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
service token.

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

- The Docker daemon was unavailable in the build environment, so Compose was
  validated structurally and the same runtime was exercised directly with
  local Node, Postgres and Redis. Run `npm run smoke` on the target host.
- Realtime uses Postgres `LISTEN`/`NOTIFY` rather than Redis for fan-out; Redis
  remains available to shared packages and as a persisted Compose service.
- The recovered services ship both readable `src/*.ts` and committed
  `dist/*.js`; the container runs `dist/` unless you rebuild it explicitly.
