# Docker configurations

This directory holds the development containers for the desktop assessment
product. The gaming platform uses its own self-contained stack at the
repository root in [`gaming-platform/docker-compose.yml`](../gaming-platform/docker-compose.yml).

## Desktop development stack

```bash
docker compose -f docker/compose/docker-compose.dev.yml up
```

It runs the FastAPI backend on `8000` and the React dev server on `1420`, with
source directories bind-mounted for hot reload.

## Gaming platform stack

```bash
cd gaming-platform
CORS_ORIGIN=https://play.example.com npm run env:init
docker compose up -d --build
npm run smoke
```

That Compose file builds a single image used by all fourteen services, runs
six migrations before any application starts, publishes only the gateway on
port 3000, and applies CPU/memory limits. See
[`gaming-platform/README.md`](../gaming-platform/README.md) for service ports,
secrets, operations and API examples.
