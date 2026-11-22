# Deployment — SecureScan Pro X

This repository ships two independently deployed products:

| Product | Compose file | Public port | Image(s) built by CI |
| --- | --- | --- | --- |
| Desktop/API app (FastAPI + React) | `docker/compose/docker-compose.prod.yml` | `8080` (frontend), `8000` (API, loopback) | `ghcr.io/<owner>/<repo>/backend`, `.../frontend` |
| Gaming platform (14 Node services) | `gaming-platform/docker-compose.yml` | `3000` (gateway) | `ghcr.io/<owner>/<repo>/gaming-platform` |

The images are built by `.github/workflows/docker.yml`: on pull requests they
are built only (no registry login or push); on pushes to `main` they are
published to GHCR with the workflow's `GITHUB_TOKEN`. No Docker daemon is
required to inspect or edit these files; builds happen in CI or on the target
host.

## Requirements

- Docker Engine with Compose v2 on the target host.
- Ports `8080` (frontend) and, if needed for direct API access, `8000`.
- A native filesystem for any local npm work. The pendrive this repo also
  lives on is VFAT and cannot create the symlinks npm needs — copy the tree to
  a native filesystem (for example `/tmp/opencode/build`) before running
  `npm ci`, `npm run build`, `npm test` or `npm run lint` there.
- No secrets are required by the desktop/API stack today. The gaming platform
  requires its own generated secrets; see `gaming-platform/README.md`.

## Build and run the desktop/API stack

```bash
# From the repository root
cp .env.example .env                 # then review/edit values (gitignored)
docker compose -f docker/compose/docker-compose.prod.yml build
docker compose -f docker/compose/docker-compose.prod.yml up -d
docker compose -f docker/compose/docker-compose.prod.yml ps
```

`up -d --build` is a shorthand for rebuilding and starting. The frontend waits
for the backend to report healthy before it starts. Both containers use
`restart: unless-stopped`.

Images can also be built directly:

```bash
docker build -f docker/prod/Dockerfile.backend -t securescan/backend:local .
docker build -f docker/prod/Dockerfile.frontend \
  --build-arg VITE_API_URL=/api/v1 -t securescan/frontend:local .
```

### Ports and request flow

| Port | Container | Notes |
| --- | --- | --- |
| `8080` | frontend (nginx) | Public UI; `VITE_API_URL=/api/v1` calls same-origin `/api/...`, which nginx proxies to `backend:8000`. |
| `8000` | backend (uvicorn) | Published on `127.0.0.1` only for administration/debugging. In-container port is always `8000`. |
| `8080/health` | frontend | nginx liveness endpoint (`200 ok`). |
| `8000/health` | backend | FastAPI health endpoint (`{"status":"healthy", ...}`), exempt from rate limiting/audit middleware. |

Host ports are configurable with `BACKEND_PORT` and `FRONTEND_PORT` in `.env`;
container ports stay `8000`/`8080`. If you use an absolute `VITE_API_URL`
instead of `/api/v1`, add the browser origin to `_ALLOWED_ORIGINS` in
`backend/app/api/__init__.py` (the current allowlist covers only localhost
origins) and terminate TLS in front of both services.

### Environment variables

Loaded from the repository-root `.env` via `env_file:` (see `.env.example`,
which documents every key):

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | Build-time API base URL embedded in the frontend bundle. Changing it requires a frontend rebuild. |
| `BACKEND_PORT` | `8000` | Host port for the loopback-bound backend. |
| `FRONTEND_PORT` | `8080` | Host port for the frontend. |
| `SECURESCAN_HOME` | `/data` in Compose | Backend data root; backed by the `securescan_data` named volume. |
| `SECURESCAN_DEBUG` | `false` | Runtime debug flag. Keep off in production. |
| `SECURESCAN_LOGGING__LEVEL` | `info` | Backend log level (nested settings delimiter is `__`). |

No tokens, passwords or keys belong in this `.env`. The gaming platform's
generated `gaming-platform/.env` is a separate, secret-bearing file that must
not be committed.

### Volumes, health checks and security

- `securescan_data` is a named volume mounted at `/data`. It holds the SQLite
  database, logs, audits, backups and plugin state. `docker compose down`
  preserves it; `down -v` destroys it.
- Backend health: `GET /health` on port `8000`, checked every 30s (20s start
  period). Frontend health: `GET /health` on port `8080`, checked every 30s.
- The backend runs as uid/gid `10001` (`securescan`) from a non-editable wheel
  install. The frontend's nginx master and workers run as `nginx` on
  unprivileged port `8080`; pid and temp files live under `/tmp/nginx`.
- Manually verify health from the host:

  ```bash
  curl -fsS http://127.0.0.1:8080/health
  curl -fsS http://127.0.0.1:8000/health
  docker compose -f docker/compose/docker-compose.prod.yml ps
  ```

## Deploying published GHCR images

The workflow publishes on `main` with tags such as `main`, `sha-<short-sha>`
and (on the latest main commit) `latest`. To run a pinned published image
instead of a local build, replace the `build:` block for that service with an
`image:` reference to the desired tag (or add an override file that unsets
`build:`), then:

```bash
docker compose -f docker/compose/docker-compose.prod.yml pull
docker compose -f docker/compose/docker-compose.prod.yml up -d
```

Keep the same .env and named volume across image changes.

## Upgrade and rollback

Upgrade:

1. Review the new commit and `.env.example` for new variables; update `.env`.
2. Back up the `securescan_data` volume (`docker compose ... run --rm -v
   <backup-dir>:/backup backend sh -c 'tar czf /backup/securescan.tgz -C /data .'`).
3. Pull/check out the new revision and run `docker compose -f ... up -d --build`
   (or pull pinned GHCR tags as above).
4. Wait for both services to be `healthy` and check `/health` plus a UI login.

Rollback:

1. Check out the previous revision (or pin the previous GHCR `sha-` tag) and
   run `up -d --build` again. Compose keeps the named volume, so application
   data is retained.
2. If the new version changed the on-disk schema, restore the volume from the
   backup taken in step 2 of the upgrade before starting the old image.

For the gaming platform, follow the upgrade/rollback procedure in
`gaming-platform/README.md`. Its one-shot `migrate` service applies migrations
on every recreate; migrations are forward-only, so always restore `pgdata`
before rolling back to an older image. Its postgres/redis ports bind to
`127.0.0.1` and the gateway alone is published on `3000`.

## CI image builds

`.github/workflows/docker.yml` runs on pull requests to `main` and pushes to
`main`. Each job uses `docker/setup-buildx-action@v3`,
`docker/metadata-action@v5` and `docker/build-push-action@v6` with GitHub
Actions cache; `docker/login-action@v3` and `push: true` are gated to main
pushes only. Permissions are `contents: read` and `packages: write`.
