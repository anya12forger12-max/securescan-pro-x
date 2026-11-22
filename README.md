# SecureScan Pro X

**Enterprise-Grade Defensive Security Assessment Platform**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)
[![TypeScript](https://img.shields.io/badge/typescript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![WCAG 2.2 AA target](https://img.shields.io/badge/WCAG-2.2%20AA%20target-orange.svg)](ACCESSIBILITY.md)
[![Security Policy](https://img.shields.io/badge/Security-Policy-red.svg)](SECURITY.md)

---

## Overview

SecureScan Pro X is a privacy-first, offline-first, desktop security assessment platform designed for defensive cybersecurity professionals. It enables organizations to assess systems they own or have explicit authorization to test.

**This software is exclusively for defensive purposes.** It never contains exploit execution, payload generation, persistence mechanisms, credential theft, or any capability intended to facilitate unauthorized access.

## Status

Active development. The backend services and the core React UI exist and build;
several roadmap items (backup service, plugin marketplace, localization, installers)
are still planned. See [ROADMAP.md](ROADMAP.md) for milestone status.

Last verified 2026-11-22: 325 backend tests pass with 89.5% coverage (gate 85%),
and the frontend builds, lints and tests cleanly. Accessibility conformance has
not yet been audited; WCAG 2.2 AA is a target, not a claim.

The repository also ships an independent distributed backend in
[`gaming-platform/`](gaming-platform/README.md): 14 Fastify services behind a
single gateway, six Postgres migrations, strict TypeScript sources and a
self-contained Compose deployment. It is a separate deployable from the desktop
assessment app and does not change that app's offline-first guarantees.

## Key Principles

| Principle | Description |
|---|---|
| **Privacy First** | All data stays local. No telemetry without consent. No cloud dependencies. |
| **Offline First** | Full functionality without internet. All assessments run locally. |
| **Accessibility First** | WCAG 2.2 AA compliant. Keyboard navigable. Screen reader supported. |
| **Secure by Default** | RBAC, encrypted storage, audit logging, secure configuration. |
| **Modular** | Plugin-driven architecture. Extend without modifying core. |
| **Cross-Platform** | Windows, Linux, macOS. Future platforms without redesign. |

## Architecture

SecureScan Pro X follows a strict layered architecture:

```
┌─────────────────────────────────────┐
│        Presentation Layer           │  React + TypeScript (Tauri)
├─────────────────────────────────────┤
│         Workspace Layer             │  Session & project management
├─────────────────────────────────────┤
│         Assessment Layer            │  Scanning orchestration
├─────────────────────────────────────┤
│         Correlation Layer           │  Cross-check analysis
├─────────────────────────────────────┤
│          Risk Engine                │  CVSS & risk scoring
├─────────────────────────────────────┤
│        Knowledge Engine             │  Vulnerability intelligence
├─────────────────────────────────────┤
│         Reporting Layer             │  Report generation
├─────────────────────────────────────┤
│        Platform Services            │  Config, logging, audit, etc.
├─────────────────────────────────────┤
│        Infrastructure Layer         │  Database, filesystem, OS
├─────────────────────────────────────┤
│        Persistence Layer            │  SQLite / PostgreSQL
└─────────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete architecture documentation.
That layered model describes the desktop assessment product. The gaming platform
is a separate service-oriented subsystem documented in
[ARCHITECTURE.md §13](ARCHITECTURE.md#13-gaming-platform-subsystem) and
[docs/architecture/gaming-platform.md](docs/architecture/gaming-platform.md).

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React, TypeScript, Tauri |
| **Backend** | Python 3.13+, FastAPI, SQLAlchemy, Alembic, Pydantic |
| **Gaming platform** | Node.js 22, Fastify 5, TypeScript, PostgreSQL, Redis, Docker Compose |
| **Database** | SQLite (default), PostgreSQL (gaming platform) |
| **CLI** | Typer |
| **Documentation** | MkDocs Material, Mermaid |
| **Testing** | pytest, Playwright, MyPy, Ruff, Coverage |
| **CI/CD** | GitHub Actions |

## Quick Start

### Prerequisites

- Python 3.13+
- Node.js 20+
- Rust (for Tauri)
- pnpm

### Development Setup

```bash
# Clone the repository
git clone https://github.com/anya12forger12-max/securescan-pro-x.git
cd securescan-pro-x

# Backend setup
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows
pip install -e ".[dev]"

# Frontend setup
cd frontend
pnpm install

# Run development environment
cd ..
./scripts/dev/start.sh
```

### Docker Setup

```bash
docker compose -f docker/compose/docker-compose.dev.yml up
```

The gaming platform has its own independent Compose stack:

```bash
cd gaming-platform
CORS_ORIGIN=https://play.example.com npm run env:init
docker compose up -d --build
npm run smoke
```

See [docs/guides/getting-started.md](docs/guides/getting-started.md) for the
desktop app and [gaming-platform/README.md](gaming-platform/README.md) for all
gaming-platform services, security and operations.

## Project Structure

```
securescan-pro-x/
├── frontend/           # React + TypeScript + Tauri UI
├── backend/            # Python FastAPI services
├── gaming-platform/    # 14-service Fastify backend, gateway, migrations, Compose
├── shared/             # Shared types and constants
├── plugins/            # Plugin ecosystem
├── sdk/                # Plugin SDK (Python + TypeScript)
├── database/           # Migrations and schemas
├── docs/               # MkDocs documentation
├── tests/              # End-to-end and integration tests
├── benchmarks/         # Performance benchmarks
├── config/             # Application configuration
├── scripts/            # Build, dev, and utility scripts
├── .github/            # CI/CD workflows
├── installer/          # Platform-specific installers
├── docker/             # Docker configurations
├── samples/            # Sample data and configurations
├── templates/          # Assessment and report templates
├── knowledgebase/      # Vulnerability and compliance data
├── policies/           # Policy templates
├── localization/       # Internationalization files
├── themes/             # UI theme definitions
├── reports/            # Report templates and samples
├── assets/             # Static assets
├── diagnostics/        # Diagnostic tools and reports
├── backups/            # Backup scripts and templates
├── tools/              # Developer tools
├── resources/          # Documentation resources
└── licenses/           # Third-party licenses
```

## Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture and design decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |
| [PRIVACY.md](PRIVACY.md) | Privacy policy and data handling |
| [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md) | Responsible use guidelines |
| [TESTING.md](TESTING.md) | Testing strategy and guidelines |
| [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) | Plugin development guide |
| [SDK_GUIDE.md](SDK_GUIDE.md) | SDK reference documentation |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Accessibility standards and practices |
| [STYLE_GUIDE.md](STYLE_GUIDE.md) | Code style and conventions |
| [ROADMAP.md](ROADMAP.md) | Development roadmap |
| [CONFIGURATION.md](CONFIGURATION.md) | Configuration reference |

## Quick Install from GitHub

```bash
git clone https://github.com/anya12forger12-max/securescan-pro-x.git
cd securescan-pro-x
bash install.sh
```

## Implemented capabilities

| Area | What exists today |
|---|---|
| **REST API** | FastAPI endpoints for auth/session, assets, workspaces, assessments, scans and reports |
| **Assessment engine** | Assessment lifecycle, evidence normalization, orchestration and scan engine |
| **Risk & correlation** | Severity/CVSS-based finding correlation and risk prioritization |
| **Reporting** | HTML, JSON, Markdown and CSV report generation with integrity hashes |
| **Knowledge base** | Local vulnerability intelligence service |
| **Plugin framework** | Python plugin interfaces and manager; built-in plugins are not shipped yet |
| **Frontend** | Login, dashboard, assets, workspaces, assessments, scanner and settings pages |

Built-in scanner checks, a report-builder UI, localization and desktop installers
are still on the [roadmap](ROADMAP.md).

## Security Features

- **Rate limiting** — Token bucket algorithm per client
- **Security headers** — CSP, HSTS, X-Frame-Options on all responses
- **Input sanitization** — XSS protection middleware
- **Audit logging** — All API requests logged with client IP
- **Session management** — Secure cookie-based auth with timeout
- **RBAC** — Admin/Operator/Viewer role hierarchy
- **Password hashing** — bcrypt with configurable rounds
- **Report integrity** — SHA-256 hashes on all generated reports
- **No telemetry** — All data stays local, no cloud dependencies

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on contributing to this project.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). **Do not** open public issues for security vulnerabilities.

## Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/anya12forger12-max/securescan-pro-x/issues)
- **Discussions**: [GitHub Discussions](https://github.com/anya12forger12-max/securescan-pro-x/discussions)
- **Security Reports**: See [SECURITY.md](SECURITY.md)

---

## Repository

- **Home:** https://github.com/anya12forger12-max/securescan-pro-x
- **License:** MIT (see `LICENSE`)
- **Issues:** https://github.com/anya12forger12-max/securescan-pro-x/issues
- **Security:** See `SECURITY.md` / `.github/SECURITY.md`
- **Contributing:** See `CONTRIBUTING.md` (or open an issue/PR)
