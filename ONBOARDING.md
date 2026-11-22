# Onboarding

Welcome! This guide gets you from clone to running in minutes.

## Prerequisites

See README.md for stack-specific prerequisites.

## Setup

```bash
git clone <repo-url>
cd <repo>
./install.sh
```

## Configuration

Copy `.env.example` to `.env` (or `backend/.env`) and fill in values.

For the gaming platform, generate its separate secrets file instead:

```bash
cd gaming-platform
CORS_ORIGIN=https://play.example.com npm run env:init
```

## Running

See README.md for the desktop app commands. For the gaming platform:

```bash
cd gaming-platform
docker compose up -d --build
npm run smoke
```

## Tests

See README.md for desktop app test commands. For the gaming platform:

```bash
cd gaming-platform
npm run check
npm run typecheck
npm run validate:compose
```

## First contribution

Read CONTRIBUTING.md. Open an issue or PR; maintainers will guide you.
