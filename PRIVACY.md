# Privacy Policy — SecureScan Pro X

## Core Principle

**Your data never leaves your machine without your explicit consent.**

SecureScan Pro X is a privacy-first application. All data processing occurs locally on your device. No telemetry, analytics, or data transmission occurs without your informed and explicit opt-in.

## Data Collection

### What We Collect

| Data Type | Collected? | Purpose |
|---|---|---|
| Assessment data | No | Stays on local device |
| Scan results | No | Stays on local device |
| Configuration | No | Stays on local device |
| User accounts | No | No user registration required |
| Usage analytics | Opt-in only | Improvement (can be disabled) |
| Error reports | Opt-in only | Bug fixing (can be disabled) |

### What We Never Collect

- Assessment targets or results
- Vulnerability findings
- Network configurations
- System information
- IP addresses
- Credentials or secrets
- File contents
- Browsing history

## Data Storage

### Local Storage

All application data is stored locally:

| Data | Location | Encryption |
|---|---|---|
| Database | `~/.securescan/data/` | AES-256-GCM |
| Configuration | `~/.securescan/config/` | Encrypted sensitive fields |
| Logs | `~/.securescan/logs/` | User-controlled |
| Backups | `~/.securescan/backups/` | User-controlled |
| Cache | `~/.securescan/cache/` | None (non-sensitive) |

### Database

- SQLite database stored locally
- Encrypted with user-provided or generated key
- No remote database connections
- PostgreSQL option requires user's own server

## Network Usage

### Default: Fully Offline

SecureScan Pro X functions entirely offline. No network calls are made during normal operation.

### Opt-In Network Features

| Feature | Data Sent | Purpose | Required? |
|---|---|---|---|
| CVE lookup | CVE IDs | Vulnerability enrichment | No |
| Update check | Version number | Security updates | No |
| Plugin download | Plugin ID | Plugin installation | No |
| Documentation | None | Online docs | No |

All network features can be individually disabled.

### Network Controls

```yaml
# Default: all network disabled
network:
  enabled: false
  features:
    cve_lookup: false
    update_check: false
    plugin_download: false
  proxy: null
  timeout: 30
```

## Data Sharing

### We Never Share

- Your assessment data
- Your configuration
- Your findings
- Your reports
- Any personally identifiable information

### Third-Party Services

SecureScan Pro X does not integrate with any third-party analytics, tracking, or data collection services.

## Data Export and Deletion

### Export

You can export all your data at any time:

```bash
securescan export --all --format json
```

### Deletion

You can delete all data at any time:

```bash
securescan reset --confirm
```

Or manually delete `~/.securescan/`.

### What Deletion Removes

- All assessment data
- All configuration
- All logs
- All backups
- All cached data
- Application preferences

## Plugin Privacy

### Plugin Data Isolation

- Each plugin has isolated storage
- Plugins cannot access other plugins' data
- Plugins cannot access application data without explicit permission
- Plugin network access requires explicit permission

### Plugin Review

- Built-in plugins reviewed by maintainers
- Community plugins flagged for manual review
- Plugin permissions declared and auditable

## Telemetry

### Default: Off

No telemetry is collected by default. You will be asked during first launch whether you wish to opt in.

### If Opted In

Collected data (minimal):
- Application version
- Operating system
- Feature usage frequency (no content)
- Error types (no details)

### What Is Never Collected

- File paths
- Assessment targets
- Vulnerability data
- User identity
- Network information
- System details beyond OS type

## Children's Privacy

SecureScan Pro X does not knowingly collect information from children under 13. The application is designed for professional use by adults.

## Changes to This Policy

Changes to this policy will be:
1. Documented in [CHANGELOG.md](CHANGELOG.md)
2. Displayed in the application on next launch
3. Requiring re-acknowledgment for significant changes

## Contact

For privacy concerns: privacy@securescan.dev

## Legal

This is not legal advice. Consult your organization's privacy officer for compliance requirements specific to your use case.

See also: [SECURITY.md](SECURITY.md), [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md)
