# Backup and Recovery — SecureScan Pro X

## Overview

SecureScan Pro X provides automatic and manual backup capabilities to protect against data loss.

## Backup Types

| Type | Contents | Frequency |
|---|---|---|
| **Full** | Database + Config + Plugins | Weekly |
| **Incremental** | Changes since last backup | Daily |
| **Snapshot** | Point-in-time database copy | On-demand |

## Automatic Backups

### Configuration

```yaml
backup:
  enabled: true
  directory: "~/.securescan/backups/"
  max_backups: 10
  auto_backup_days: 7
  compression: true
  encryption: true
```

### Schedule

- **Daily**: Incremental backup of database
- **Weekly**: Full backup of all data
- **Pre-migration**: Automatic before database migration
- **On-demand**: Manual via UI or CLI

### Retention

- Keep last 10 backups by default
- Configurable retention policy
- Oldest backups deleted automatically

## Manual Backups

### CLI

```bash
# Create full backup
securescan backup create

# Create named backup
securescan backup create --name "pre-update"

# List backups
securescan backup list

# Restore from backup
securescan backup restore <backup-id>

# Delete backup
securescan backup delete <backup-id>

# Export backup to file
securescan backup export <backup-id> --output backup.tar.gz

# Import backup from file
securescan backup import backup.tar.gz
```

### UI

1. Go to **Settings** → **Backup**
2. Click **Create Backup**
3. Optionally name the backup
4. Wait for completion

## Backup Contents

### Full Backup

```
backup/
├── metadata.json          # Backup metadata
├── securescan.db          # Database copy
├── config.yaml           # Configuration
├── plugins/              # Installed plugins
├── templates/            # Custom templates
├── themes/               # Custom themes
└── knowledgebase/        # Custom knowledge
```

### Incremental Backup

```
backup/
├── metadata.json
├── securescan.db         # WAL-only changes
└── delta.json           # Changed files
```

## Encryption

All backups are encrypted by default:

- **Algorithm**: AES-256-GCM
- **Key**: Derived from application key
- **IV**: Random per backup

### Decrypting Backups

```bash
# Decrypt for manual inspection
securescan backup decrypt <backup-file> --output decrypted/
```

## Recovery

### Full Recovery

```bash
# Stop the application first
securescan backup restore <backup-id>
# Restart the application
```

### Partial Recovery

```bash
# Restore only database
securescan backup restore <backup-id> --component database

# Restore only configuration
securescan backup restore <backup-id> --component config
```

### Disaster Recovery

1. Install SecureScan Pro X on new system
2. Copy backup file to `~/.securescan/backups/`
3. Run `securescan backup restore <backup-id>`
4. Verify data integrity

```bash
securescan backup verify <backup-id>
```

## Integrity Checking

Backups include checksums:

```bash
# Verify backup integrity
securescan backup verify <backup-id>

# Verify all backups
securescan backup verify --all
```

## Backup Locations

| Location | Path | Purpose |
|---|---|---|
| Default | `~/.securescan/backups/` | User backups |
| Pre-migration | `~/.securescan/backups/migration/` | Auto-backups |
| Export | User-specified | Exported backups |

## Best Practices

1. **Regular backups** — Enable automatic backups
2. **Test restores** — Periodically test restore process
3. **Off-site copies** — Export critical backups to external storage
4. **Naming** — Use descriptive backup names
5. **Verification** — Verify backup integrity regularly

## Troubleshooting

### Backup Fails

1. Check disk space
2. Check permissions on backup directory
3. Review logs for errors
4. Ensure database is not locked

### Restore Fails

1. Verify backup integrity
2. Check target directory permissions
3. Ensure no other instance is running
4. Review migration logs

### Corrupted Backup

```bash
# Check backup health
securescan backup health <backup-id>

# Attempt repair
securescan backup repair <backup-id>
```
