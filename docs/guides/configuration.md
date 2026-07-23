# Configuration Guide

## Configuration File

**Location**: `~/.securescan/config/config.yaml`

## Three-Tier Configuration

Configuration is loaded from (in order of precedence):

1. **Environment variables** — `SECURESCAN_*`
2. **User config** — `~/.securescan/config/config.yaml`
3. **System config** — `/etc/securescan/config.yaml`
4. **Defaults** — Built-in

Later tiers override earlier tiers.

## Key Settings

### UI

```yaml
ui:
  theme: "dark"  # light, dark, high-contrast, colorblind
  font_size: "medium"  # small, medium, large, extra-large
  reduce_motion: false
  language: "en"
```

### Logging

```yaml
logging:
  level: "info"  # debug, info, warning, error
  format: "json"  # json, text
  file: true
```

### Security

```yaml
security:
  encryption_at_rest: true
  session_timeout_minutes: 30
  max_failed_attempts: 5
```

### Network

```yaml
network:
  enabled: false  # Default: offline
  cve_lookup: false
  update_check: false
```

### Plugins

```yaml
plugins:
  enabled: true
  sandbox: true
  signature_verification: true
  memory_limit_mb: 512
```

## CLI Configuration

```bash
securescan config show           # Show configuration
securescan config set ui.theme light  # Set a value
securescan config reset         # Reset to defaults
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SECURESCAN_HOME` | Home directory | `~/.securescan` |
| `SECURESCAN_LOG_LEVEL` | Log level | `info` |
| `SECURESCAN_THEME` | UI theme | `dark` |
| `SECURESCAN_DEBUG` | Debug mode | `false` |

## See Also

- [CONFIGURATION.md](../../CONFIGURATION.md) — Full reference
- [Security Architecture](../architecture/security.md) — Security settings
