# Gaming Platform Architecture

## Overview

`gaming-platform/` is a separate, service-oriented backend in this repository.
It is independently deployable from the layered desktop assessment product and
does not affect that product's offline-first guarantees. The canonical,
service-by-service reference is [`gaming-platform/README.md`](../../gaming-platform/README.md).

## Topology

The gateway on port 3000 is the only process that publishes a host port. It
verifies player JWTs, enforces RBAC, injects trusted identity headers and
proxies to thirteen internal services on the private Compose network.

| Group | Services | Ports |
|---|---|---|
| Edge | gateway | 3000 |
| Identity and risk | auth, admin-risk | 3015, 3013 |
| Platform services | realtime, wallet, responsible-gaming, tournaments | 3010–3014 |
| Games | chat, codenames, game-engine, gin-rummy, leaderboard, pictionary, promotions | 3016–3022 |

All stateful services share one PostgreSQL database, initialised by six
migrations. Redis is available to shared packages; realtime fan-out currently
uses PostgreSQL `LISTEN`/`NOTIFY` with durable rows.

## Request flow

1. A client sends a bearer token to the gateway.
2. The gateway strips caller-supplied identity headers and verifies the HS256
   token (`{userId, username}` claims).
3. For privileged routes it additionally checks the permission against
   admin-risk. A missing token, missing permission or unreachable admin-risk
   fails closed with 401/403.
4. Peer-to-peer routes (`/internal/events`, wallet credit, promotions
   catalogue) require the configured service token instead.
5. The upstream service receives a verified `x-user-id` / `x-username` and
   performs its own validation.

## Shared packages

- `@gp/config` — environment validation, error envelopes, bounded database
  pool options (`DB_POOL_MAX`).
- `@gp/shared-types` — error codes, decimal-safe money helpers, constant-time
  service-token comparison.
- `@gp/event-bus` — best-effort Redis event publishing.

Seven recovered services keep strict TypeScript `src/` trees that compile to
the committed `dist/` runtime output used by Docker.

## Infrastructure rules

- Only the gateway is publicly reachable; Postgres and Redis bind to loopback,
  all other services use `expose` only.
- `DB_POOL_MAX` (default 5) bounds every pool. Postgres runs with
  `max_connections=200`; `npm run validate:compose` verifies that
  `13 × DB_POOL_MAX` fits the budget.
- Every service handles SIGTERM/SIGINT by calling `app.close()`, draining
  requests and closing its pool within Compose's 25-second grace period.
- Healthchecks probe `/ready` (database-backed), not just `/health`; the
  gateway publishes an aggregate `/ready` for all downstream services.
- Migrations are idempotent and serialised by a Postgres advisory lock.
- Application containers are limited to 512 MiB and 1 CPU.

## Deployment and validation

```bash
cd gaming-platform
CORS_ORIGIN=https://play.example.com npm run env:init
docker compose up -d --build
npm run smoke
```

```bash
npm run check             # JavaScript syntax
npm run typecheck         # strict TypeScript, seven services
npm run validate:compose  # paths, ports, budget, lifecycle, limits
npm audit --omit=dev      # dependency vulnerabilities
```
