# SecureScan Pro X — defensive security assessment platform

**A local-first desktop application for assessing systems you own or have written permission to test, with a separate service-oriented gaming subsystem archived alongside it.**

![License: MIT with defensive-use terms](https://img.shields.io/badge/license-MIT%20%2B%20defensive--use%20terms-blue)
![Python 3.13+](https://img.shields.io/badge/backend-Python%203.13%2B-blue)
![TypeScript](https://img.shields.io/badge/frontend-TypeScript-blue)
![WCAG 2.2 AA target](https://img.shields.io/badge/accessibility-WCAG%202.2%20AA%20target-orange)

## Overview

SecureScan Pro X is a privacy-first, offline-first assessment tool for defensive practitioners. Its desktop product keeps data local: FastAPI services handle authentication, assets, workspaces, assessments, scans, correlation, risk scoring and report generation; a React/TypeScript + Tauri frontend provides the UI. There is no exploit execution, payload generation, credential theft or persistence machinery in the assessment application.

This repository is maintained in this account and is not a fork of another project. It does, however, contain a **separate** distributed backend under [`gaming-platform/`](gaming-platform/README.md), including an Aviator/gaming integration archive. That subsystem is a distinct deployable and does not change the desktop application's local-first behaviour.

> **Status:** under active development. Backend services and the core UI exist and build; built-in scanner checks, a report-builder UI, localization and desktop installers are still on the [roadmap](ROADMAP.md). WCAG 2.2 AA is a target, **not** a certified result — accessibility has not been audited.

## Desktop assessment app

- **FastAPI backend** — REST endpoints for auth/session, assets, workspaces, assessments, scans and reports; SQLite by default
- **Assessment engine** — lifecycle, evidence normalization, orchestration, correlation and severity/CVSS-based risk prioritization
- **Reporting** — HTML, JSON, Markdown and CSV output with SHA-256 integrity hashes
- **Local knowledge base** — vulnerability and compliance data kept on the machine
- **Plugin interfaces** — Python plugin protocols and a manager; bundled plugins are not shipped yet
- **Security controls** — RBAC roles, secure cookie sessions, bcrypt hashing, rate limiting, security headers, input sanitization and audit logging
- **Frontend** — React/TypeScript with Tauri, pages for login, dashboard, assets, workspaces, assessments, scanner and settings

Architecture is described in [ARCHITECTURE.md](ARCHITECTURE.md); security boundaries and non-goals are in [THREAT_MODEL.md](THREAT_MODEL.md) and [NON_GOALS.md](NON_GOALS.md).

## Quick start

Prerequisites: Python 3.13+, Node.js 20+, Rust (for Tauri) and pnpm.

```bash
git clone https://github.com/anya12forger12-max/securescan-pro-x.git
cd securescan-pro-x
./install.sh

cd backend && pip install -e ".[dev]" && cd ..
cd frontend && pnpm install && cd ..
./scripts/dev/start.sh
```

The development script starts the backend API (`http://localhost:8000`, docs at `/docs`) and the Vite UI. See [docs/guides/getting-started.md](docs/guides/getting-started.md) for manual setup and [CONFIGURATION.md](CONFIGURATION.md) for settings. A containerised stack is available:

```bash
docker compose -f docker/compose/docker-compose.dev.yml up
```

Configuration is read from environment variables; [.env.example](.env.example) contains only placeholders and comments. Do not commit a populated `.env`.

## Gaming subsystem and Aviator archive (reference only)

[`gaming-platform/`](gaming-platform/README.md) is an independent Node.js/Fastify backend with a gateway, Postgres migrations, Redis-backed events and rate limits, a wallet ledger, RBAC, chat, tournaments, several board/card games, self-exclusion checks and an Aviator-style crash service. It is documented separately in [docs/architecture/gaming-platform.md](docs/architecture/gaming-platform.md) and has its own Compose deployment.

`gaming-platform/integrations/aviator/` is an **archive of four third-party projects**, kept for provenance and engineering review:

| Archived upstream | Role in the archive |
| --- | --- |
| `Raccoon254/Aviator-Automated-Betika-Bot` | Betting-strategy reference; not run against external services |
| `Casino-Crash-Game/aviator-crash` | React/Unity crash client; visual and protocol reference |
| `markmoxon/aviator-source-code-bbc-micro` | Historical 6502 source of Geoff Crammond's *Aviator* |
| `blancos13/Win2x` | PHP game-catalogue reference for dice, flip, jackpot and wheel types |

These trees are untrusted reference material: they are not linked into any build, are not executed by the platform, and retain their original READMEs, credits and licences (some licences are unspecified). The live crash implementation is written natively in `services/crash`, `packages/aviator` and `frontend/src/components/crash`; its strategy lab is a deterministic, **paper-only** simulator using a local fairness generator and no external betting site. This archive is documented factually and is not an endorsement of gambling; check local law before deploying any gaming component. See [integrations/aviator/README.md](gaming-platform/integrations/aviator/README.md) for the full provenance map.

## Documentation

| Document | Topic |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layered design and decisions |
| [CONFIGURATION.md](CONFIGURATION.md) | Settings reference |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment options |
| [TESTING.md](TESTING.md) | Test strategy |
| [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md), [SDK_GUIDE.md](SDK_GUIDE.md) | Extension development |
| [PRIVACY.md](PRIVACY.md), [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md) | Data handling and acceptable use |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting (do not open public issues) |
| [ROADMAP.md](ROADMAP.md) | Planned work |
| [gaming-platform/README.md](gaming-platform/README.md) | Gaming services, operations and archive credits |

## Responsible use

The assessment application is **defensive only**. Use it against systems you own or have explicit written authorisation to test, with a defined scope and rules of engagement. See [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md) for the full policy. Report vulnerabilities privately via [SECURITY.md](SECURITY.md).

## License

MIT © 2026 **SecureScan Pro X Contributors**, with an additional defensive-use term in [LICENSE](LICENSE); GitHub therefore reports the licence as "other". Third-party archives under `gaming-platform/integrations/aviator/` keep their own upstream licences and notices — those are preserved in place and are not relicensed by this file.

## Quick start — 1 or 2 commands

```bash
./setup.sh          # install dependencies
./setup.sh run      # start the project (when a run target exists)
```

`setup.sh` detects this repository's build system and installs the right toolchain
dependencies. Use `./setup.sh test` to run the available checks. If a project has no
standard run target, the script prints the correct command from the sections above.
