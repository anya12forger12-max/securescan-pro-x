# Roadmap — SecureScan Pro X

> Statuses were reconciled with the repository on 2026-11-22. Unchecked items
> are not yet implemented. Current verification: 325 backend tests pass with
> 89.5% coverage (85% gate); the frontend builds, lints and tests cleanly.

## Vision

Become the leading open-source, privacy-first, defensive security assessment platform trusted by security professionals worldwide.

## Phase 1: Foundation (Current)

### 1A: Architecture & Repository Setup ✅
- [x] Project structure and documentation
- [x] Architecture design and layered architecture
- [x] Design system definition
- [x] Service interfaces and scaffolding
- [x] CI/CD pipeline
- [x] Security and privacy policies

### 1B: Core Services & Data Layer
- [x] Configuration service implementation
- [x] Logging service implementation
- [x] Audit service implementation
- [x] Database migrations and seed data
- [x] Authentication and RBAC implementation
- [x] Workspace service implementation
- [ ] Backup service implementation

## Phase 2: Assessment Engine

### 2A: Check Framework
- [ ] Check interface and base classes
- [ ] Check runner and scheduler
- [ ] Result collection and storage
- [ ] Progress tracking and cancellation

### 2B: Built-in Checks
- [ ] System configuration checks
- [ ] Network security checks
- [ ] Service configuration checks
- [ ] File permission checks
- [ ] User account checks

### 2C: Correlation Engine
- [x] Finding correlation
- [ ] Deduplication
- [ ] Impact clustering

## Phase 3: User Interface

### 3A: Core UI
- [x] Dashboard
- [x] Workspace management
- [x] Asset management
- [x] Assessment management

### 3B: Visualization
- [x] Risk overview charts
- [ ] Finding detail views
- [ ] Timeline visualizations
- [ ] Network topology views

### 3C: Reporting UI
- [ ] Report builder
- [ ] Report templates
- [ ] Export options

## Phase 4: Plugin System

### 4A: Plugin Infrastructure
- [x] Plugin manager implementation
- [ ] Plugin sandbox
- [ ] Plugin marketplace UI
- [ ] Plugin configuration

### 4B: Built-in Plugins
- [ ] Nmap integration
- [ ] SSL/TLS assessment
- [ ] Web application checks
- [ ] Compliance checks (CIS, NIST)

### 4C: Plugin SDK
- [ ] Python SDK release
- [ ] TypeScript SDK release
- [ ] Plugin templates
- [ ] Documentation and tutorials

## Phase 5: Advanced Features

### 5A: Knowledge Base
- [ ] CVE database integration
- [ ] CWE mapping
- [ ] Compliance frameworks
- [ ] Hardening guides

### 5B: Risk Engine
- [ ] CVSS 3.1 scoring
- [ ] CVSS 4.0 support
- [x] Risk prioritization
- [ ] Business impact analysis

### 5C: Reporting
- [ ] PDF report generation
- [x] HTML report generation
- [ ] Custom report templates
- [ ] Executive summaries

## Phase 6: Integration & Polish

### 6A: Advanced UI
- [ ] Dark mode refinement
- [ ] Animation and transitions
- [ ] Responsive layouts
- [ ] Keyboard shortcuts

### 6B: Localization
- [ ] Spanish localization
- [ ] French localization
- [ ] German localization
- [ ] Japanese localization
- [ ] Chinese localization

### 6C: Performance
- [ ] Performance optimization
- [ ] Memory profiling
- [ ] Benchmark suite

## Phase 7: Release

### 7A: Quality
- [ ] Comprehensive test coverage (>90%)
- [ ] Security audit
- [ ] Accessibility audit
- [ ] Performance audit

### 7B: Distribution
- [ ] Windows installer
- [ ] macOS installer
- [ ] Linux packages (deb, rpm, AppImage)
- [ ] Docker images
- [ ] Homebrew formula

### 7C: Documentation
- [ ] Complete user guide
- [ ] Video tutorials
- [ ] Example assessments
- [ ] Best practices guide

## Phase 8: Gaming Platform (delivered 2026-11-22)

A separate distributed backend shipped in [`gaming-platform/`](gaming-platform/README.md).
It is independently deployable from the desktop assessment app.

- [x] Gateway plus thirteen downstream Fastify services (14 total)
- [x] Shared `@gp/config`, `@gp/shared-types` and `@gp/event-bus` packages
- [x] Six idempotent Postgres migrations and a one-shot migrate service
- [x] Fail-closed gateway identity, service-token and RBAC enforcement
- [x] Playable Codenames, Gin-rummy and Pictionary state machines
- [x] Durable realtime events with Postgres `LISTEN`/`NOTIFY`
- [x] Strict TypeScript `src/` for all seven recovered services with a verified `src/ → dist/` build
- [x] Bootstrap tooling: `env:init`, `migrate`, `smoke`, `start:all`
- [x] Production Compose stack with generated secrets and gateway-only exposure
- [x] Infrastructure hardening: bounded DB pools, graceful shutdown, container limits, `/ready` probes, advisory-locked migrations
- [x] Validation: 27/27 end-to-end checks, 7/7 service typechecks, static Compose validation, zero npm audit findings

### Remaining work

- [ ] Player-facing web/mobile client
- [ ] Gateway rate limiting and per-user quotas
- [ ] Kubernetes manifests / Helm chart
- [ ] Redis-backed realtime fan-out for multi-instance deployments
- [ ] Metrics, tracing and alerting integration
- [ ] Load and soak testing on a host with a Docker daemon

## Future Considerations

- PostgreSQL support
- Team collaboration features
- API for third-party integration
- Mobile companion app
- Cloud sync (opt-in only)
- Custom check authoring UI

## Principles

1. **No breaking changes** without major version bump
2. **Backward compatibility** for two major versions
3. **Security patches** within 48 hours for critical vulnerabilities
4. **Accessibility** maintained at WCAG 2.2 AA minimum
5. **Privacy** — all features work offline
6. **Documentation** — every feature documented before release
