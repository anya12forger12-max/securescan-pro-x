# Configuration Reference — SecureScan Pro X

## Overview

SecureScan Pro X uses a three-tier configuration system:

1. **Defaults** — Built-in sensible defaults
2. **System** — Installed configuration (`/etc/securescan/` or equivalent)
3. **User** — Per-user overrides (`~/.securescan/config/`)

Later tiers override earlier tiers.

## Configuration File

**Location**: `~/.securescan/config/config.yaml`

```yaml
# SecureScan Pro X Configuration
# See docs/guides/configuration.md for full reference

version: "1.0"

# Application settings
app:
  name: "SecureScan Pro X"
  language: "en"
  first_launch_complete: false

# UI settings
ui:
  theme: "dark"  # light, dark, high-contrast, colorblind, minimal, professional
  font_size: "medium"  # small, medium, large, extra-large
  reduce_motion: false
  sidebar_collapsed: false

# Logging
logging:
  level: "info"  # debug, info, warning, error, critical
  format: "json"  # json, text
  file: true
  file_path: "~/.securescan/logs/"
  max_file_size_mb: 100
  retention_days: 30

# Audit
audit:
  enabled: true
  immutable: true
  path: "~/.securescan/audit/"

# Database
database:
  type: "sqlite"  # sqlite, postgresql
  path: "~/.securescan/data/securescan.db"
  # postgresql:
  #   host: "localhost"
  #   port: 5432
  #   database: "securescan"
  #   username: ""
  #   password: ""
  encryption: true
  backup_on_migration: true

# Security
security:
  encryption:
    algorithm: "AES-256-GCM"
    at_rest: true
  session:
    timeout_minutes: 30
    max_failed_attempts: 5
  authentication:
    method: "local"  # local, keychain

# Network
network:
  enabled: false
  proxy: null
  timeout: 30
  features:
    cve_lookup: false
    update_check: false
    plugin_download: false

# Plugins
plugins:
  enabled: true
  directory: "~/.securescan/plugins/"
  sandbox: true
  signature_verification: true
  resource_limits:
    memory_mb: 512
    cpu_percent: 50
    timeout_seconds: 300

# Assessment
assessment:
  max_concurrent: 3
  default_timeout: 600
  save_progress: true
  auto_correlate: true

# Reporting
reporting:
  default_format: "html"
  output_directory: "~/.securescan/reports/"
  templates_directory: "~/.securescan/templates/"
  include_evidence: true

# Backup
backup:
  enabled: true
  directory: "~/.securescan/backups/"
  max_backups: 10
  auto_backup_days: 7

# Notifications
notifications:
  enabled: true
  desktop: true
  sound: false

# Search
search:
  index_path: "~/.securescan/index/"
  auto_reindex: true

# Diagnostics
diagnostics:
  enabled: true
  auto_report: false
  path: "~/.securescan/diagnostics/"
```

## Environment Variables

All configuration can be overridden via environment variables:

| Variable | Description | Default |
|---|---|---|
| `SECURESCAN_HOME` | Application home directory | `~/.securescan` |
| `SECURESCAN_CONFIG` | Configuration file path | `$SECURESCAN_HOME/config/config.yaml` |
| `SECURESCAN_DB` | Database path | `$SECURESCAN_HOME/data/securescan.db` |
| `SECURESCAN_LOG_LEVEL` | Logging level | `info` |
| `SECURESCAN_THEME` | UI theme | `dark` |
| `SECURESCAN_LANGUAGE` | Language | `en` |
| `SECURESCAN_NETWORK` | Enable network features | `false` |
| `SECURESCAN_DEBUG` | Enable debug mode | `false` |

## CLI Configuration

```bash
# View current configuration
securescan config show

# Get a specific value
securescan config get ui.theme

# Set a value
securescan config set ui.theme light

# Reset to defaults
securescan config reset

# Export configuration
securescan config export config.yaml

# Import configuration
securescan config import config.yaml
```

## Configuration Validation

Configuration is validated on load using Pydantic schemas:

```python
from pydantic import BaseModel, Field
from typing import Optional

class UIConfig(BaseModel):
    theme: str = Field(default="dark", pattern="^(light|dark|high-contrast|colorblind|minimal|professional)$")
    font_size: str = Field(default="medium", pattern="^(small|medium|large|extra-large)$")
    reduce_motion: bool = False

class AppConfig(BaseModel):
    ui: UIConfig = UIConfig()
    # ... other sections
```

## Secure Configuration

Sensitive values are encrypted:

```yaml
# Stored as encrypted
security:
  encryption_key: "ENC[aes256:...]"  # Auto-encrypted

# Or use OS keychain
security:
  credential_store: "keychain"  # Uses OS keychain
```

## Configuration Profiles

```bash
# Switch profiles
securescan profile set work
securescan profile set personal

# List profiles
securescan profile list
```

## Per-Assessment Configuration

Assessments can override global configuration:

```yaml
assessment:
  name: "Quarterly Assessment"
  config:
    timeout: 1200
    max_concurrent: 5
    checks:
      - name: "network-scan"
        enabled: true
      - name: "web-scan"
        enabled: true
```

## See Also

- [CONFIGURATION.md](CONFIGURATION.md) — User-friendly guide
- [docs/guides/configuration.md](docs/guides/configuration.md) — Detailed guide
- [docs/api/configuration.md](docs/api/configuration.md) — API reference
