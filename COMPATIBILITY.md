# Compatibility — SecureScan Pro X

## Platform Compatibility

### Supported Operating Systems

| OS | Version | Architecture | Status |
|---|---|---|---|
| Windows | 10+ (21H2+) | x64, ARM64 | Supported |
| macOS | 12+ (Monterey) | x64, ARM64 | Supported |
| Linux (Ubuntu) | 22.04+ | x64 | Supported |
| Linux (Debian) | 11+ | x64 | Supported |
| Linux (Fedora) | 38+ | x64 | Supported |
| Linux (Arch) | Latest | x64 | Supported |

### Browser Compatibility (Tauri WebView)

| Engine | Minimum Version |
|---|---|
| WebView2 (Windows) | 109+ |
| WebKit (macOS) | 16.0+ |
| WebKitGTK (Linux) | 2.36+ |

## Python Compatibility

| Component | Requirement |
|---|---|
| Python | 3.13+ |
| pip | 23.0+ |
| venv | Built-in |

## Node.js Compatibility

| Component | Requirement |
|---|---|
| Node.js | 20 LTS+ |
| pnpm | 9.0+ |

## Rust Compatibility

| Component | Requirement |
|---|---|
| Rust | 1.75+ (stable) |
| Cargo | Bundled with Rust |

## Database Compatibility

| Database | Version | Status |
|---|---|---|
| SQLite | 3.35+ | Default, fully supported |
| PostgreSQL | 14+ | Future (architectural support) |

## API Compatibility

### REST API

- Content-Type: `application/json`
- API versioning via URL path (`/api/v1/`)
- Backward compatibility within major versions
- Deprecated endpoints marked with `Sunset` header

### Plugin API

- Semantic versioning for SDK
- Breaking changes only in major versions
- Deprecated methods marked with warnings
- Migration guides for breaking changes

## File Format Compatibility

### Import Formats

| Format | Version | Notes |
|---|---|---|
| JSON | RFC 8259 | Full support |
| CSV | RFC 4180 | UTF-8 required |
| XML | 1.0 | Basic support |
| Nmap XML | All | Via plugin |

### Export Formats

| Format | Version | Notes |
|---|---|---|
| JSON | RFC 8259 | Full support |
| CSV | RFC 4180 | UTF-8 |
| HTML | 5 | Report format |
| PDF | 1.7 | Via PDF library |
| Markdown | CommonMark | Report format |

## Backward Compatibility

### Data Migration

- Database migrations via Alembic
- Automatic migration on startup
- Rollback support for failed migrations
- Backup before migration

### Configuration Migration

- Configuration versioning
- Automatic upgrade of legacy configs
- Deprecation warnings for old formats

### Plugin Compatibility

- Plugin API versioning
- Backward compatible plugin loading
- Deprecated plugin warnings
- Migration documentation

## Hardware Requirements

### Minimum

| Component | Requirement |
|---|---|
| CPU | Dual-core 1GHz |
| RAM | 4GB |
| Storage | 500MB + data |
| Display | 1280x720 |

### Recommended

| Component | Requirement |
|---|---|
| CPU | Quad-core 2GHz+ |
| RAM | 8GB+ |
| Storage | 2GB+ SSD |
| Display | 1920x1080+ |

## Network Requirements

- **Offline**: Full functionality (default)
- **Online**: Optional features (CVE lookup, updates, plugin downloads)
- **Bandwidth**: Minimal (HTTP requests only)
- **Proxy**: Supported via configuration
