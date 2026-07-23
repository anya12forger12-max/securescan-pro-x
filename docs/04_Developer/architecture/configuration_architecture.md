# Configuration Architecture

> Configuration management, validation, environment overrides, and migration.

---

## 1. Configuration Schema

MHCP uses a schema-driven configuration system. Every configuration value is declared with a type, default, description, and optional validators.

### Schema Structure

```
ConfigSchema
  |
  +-- Section: "logging"
  |     +-- Field: "level"           (STRING, default="INFO")
  |     +-- Field: "max_file_size_mb" (INTEGER, default=10)
  |     +-- Field: "redact_sensitive" (BOOLEAN, default=True)
  |     +-- Field: "categories"      (LIST, default=["application"])
  |
  +-- Section: "security"
  |     +-- Field: "verify_hashes"    (BOOLEAN, default=True)
  |     +-- Field: "hash_algorithms"  (LIST, default=["sha256"])
  |     +-- Field: "api_timeout_seconds" (INTEGER, default=30)
  |     +-- Field: "allowed_paths"    (LIST, default=[])
  |
  +-- Section: "database"
  |     +-- Field: "engine"           (STRING, default="sqlite")
  |     +-- Field: "pool_size"        (INTEGER, default=5)
  |     +-- Field: "path"             (STRING, default="~/.local/share/mhcp/hashes.db")
  |     +-- Field: "wal_mode"         (BOOLEAN, default=True)
  |
  +-- Section: "scanner"
  |     +-- Field: "chunk_size"       (INTEGER, default=8192)
  |     +-- Field: "max_file_size_mb" (INTEGER, default=1024)
  |     +-- Field: "timeout_seconds"  (INTEGER, default=300)
  |     +-- Field: "parallel_workers" (INTEGER, default=4)
  |
  +-- Section: "reports"
  |     +-- Field: "default_format"   (STRING, default="json")
  |     +-- Field: "output_dir"       (STRING, default="./reports")
  |     +-- Field: "include_metadata" (BOOLEAN, default=True)
  |
  +-- Section: "providers"
        +-- Field: "external_enabled" (BOOLEAN, default=False)
        +-- Field: "api_url"          (STRING, default="")
        +-- Field: "api_key"          (STRING, default="")
        +-- Field: "timeout_seconds"  (INTEGER, default=10)
        +-- Field: "cache_ttl_seconds" (INTEGER, default=300)
```

### Field Types

| Type | Python Type | Validation |
|---|---|---|
| `STRING` | `str` | Type check |
| `INTEGER` | `int` | Type check |
| `BOOLEAN` | `bool` | Type check (rejects int 0/1) |
| `LIST` | `list` | Type check |

### Default Configuration

The default configuration is defined in `mhcp_config.defaults.DEFAULT_CONFIG`:

```python
DEFAULT_CONFIG = {
    "logging": {
        "level": "INFO",
        "max_file_size_mb": 10,
        "redact_sensitive": True,
        "categories": ["application"],
    },
    "security": {
        "verify_hashes": True,
        "hash_algorithms": ["sha256"],
        "api_timeout_seconds": 30,
        "allowed_paths": [],
    },
    "database": {
        "engine": "sqlite",
        "pool_size": 5,
        "path": "~/.local/share/mhcp/hashes.db",
        "wal_mode": True,
    },
    "scanner": {
        "chunk_size": 8192,
        "max_file_size_mb": 1024,
        "timeout_seconds": 300,
        "parallel_workers": 4,
    },
    "reports": {
        "default_format": "json",
        "output_dir": "./reports",
        "include_metadata": True,
    },
    "providers": {
        "external_enabled": False,
        "api_url": "",
        "api_key": "",
        "timeout_seconds": 10,
        "cache_ttl_seconds": 300,
    },
}
```

---

## 2. Environment Variables

Environment variables override configuration file values. The override follows a predictable naming convention.

### Naming Convention

```
MCP_<SECTION>__<KEY>
```

- Prefix: `MCP_`
- Separator: Double underscore `__`
- All uppercase
- Nested keys use additional double underscores

### Override Table

| Environment Variable | Config Path | Type | Example |
|---|---|---|---|
| `MCP_LOGGING__LEVEL` | `logging.level` | string | `DEBUG` |
| `MCP_LOGGING__MAX_FILE_SIZE_MB` | `logging.max_file_size_mb` | int | `50` |
| `MCP_LOGGING__REDACT_SENSITIVE` | `logging.redact_sensitive` | bool | `false` |
| `MCP_SECURITY__VERIFY_HASHES` | `security.verify_hashes` | bool | `false` |
| `MCP_SECURITY__HASH_ALGORITHMS` | `security.hash_algorithms` | list | `sha256,md5` |
| `MCP_SECURITY__API_TIMEOUT_SECONDS` | `security.api_timeout_seconds` | int | `60` |
| `MCP_DATABASE__ENGINE` | `database.engine` | string | `sqlite` |
| `MCP_DATABASE__POOL_SIZE` | `database.pool_size` | int | `10` |
| `MCP_DATABASE__PATH` | `database.path` | string | `/data/hashes.db` |
| `MCP_DATABASE__WAL_MODE` | `database.wal_mode` | bool | `true` |
| `MCP_SCANNER__CHUNK_SIZE` | `scanner.chunk_size` | int | `16384` |
| `MCP_SCANNER__MAX_FILE_SIZE_MB` | `scanner.max_file_size_mb` | int | `4096` |
| `MCP_SCANNER__TIMEOUT_SECONDS` | `scanner.timeout_seconds` | int | `600` |
| `MCP_SCANNER__PARALLEL_WORKERS` | `scanner.parallel_workers` | int | `8` |
| `MCP_REPORTS__DEFAULT_FORMAT` | `reports.default_format` | string | `csv` |
| `MCP_REPORTS__OUTPUT_DIR` | `reports.output_dir` | string | `/reports` |
| `MCP_REPORTS__INCLUDE_METADATA` | `reports.include_metadata` | bool | `false` |
| `MCP_PROVIDERS__EXTERNAL_ENABLED` | `providers.external_enabled` | bool | `true` |
| `MCP_PROVIDERS__API_URL` | `providers.api_url` | string | `https://...` |
| `MCP_PROVIDERS__API_KEY` | `providers.api_key` | string | `sk-...` |
| `MCP_PROVIDERS__TIMEOUT_SECONDS` | `providers.timeout_seconds` | int | `20` |
| `MCP_PROVIDERS__CACHE_TTL_SECONDS` | `providers.cache_ttl_seconds` | int | `600` |

### Override Priority

```
1. Command-line arguments     (highest priority)
2. Environment variables
3. Configuration file
4. Built-in defaults          (lowest priority)
```

### Environment Variable Parsing Rules

| Type | Parsing |
|---|---|
| string | Used as-is |
| integer | `int(value)` |
| boolean | `"true"`, `"1"`, `"yes"` -> `True`; `"false"`, `"0"`, `"no"` -> `False` |
| list | Comma-separated: `"sha256,md5"` -> `["sha256", "md5"]` |

---

## 3. Configuration Profiles

MHCP supports named configuration profiles for different deployment scenarios.

### Built-in Profiles

| Profile | Description | Key Differences |
|---|---|---|
| `default` | Standard desktop usage | Balanced settings |
| `server` | Headless server deployment | Larger pool, no UI features |
| `minimal` | Resource-constrained systems | Smaller chunk size, fewer algorithms |
| `security-high` | Maximum security posture | All algorithms, strict validation |
| `development` | Development/debugging | DEBUG logging, verbose output |

### Profile Loading

```toml
# mhcp.toml
[profile]
active = "security-high"
```

Profile-specific overrides are merged on top of the base configuration:

```toml
# profiles/security-high.toml
[scanner]
chunk_size = 16384
timeout_seconds = 600

[security]
hash_algorithms = ["sha256", "sha384", "sha512"]
verify_hashes = true
api_timeout_seconds = 60

[logging]
level = "WARNING"
redact_sensitive = true
```

### Custom Profiles

Create custom profiles by adding TOML files to the profiles directory:

```
~/.config/mhcp/profiles/
  my-profile.toml
```

Reference in the main config:

```toml
[profile]
active = "my-profile"
```

---

## 4. Configuration Migration

When configuration schema changes between versions, automatic migration ensures backward compatibility.

### Migration Flow

```
Load config file
        |
        v
+-------------------------------------------+
|  1. Read config_version from file         |
|     (default: "0.0.0" if absent)         |
|                                           |
|  2. Compare with current schema version   |
|                                           |
|  3. If versions match:                    |
|       -> Apply and validate               |
|                                           |
|  4. If config is older:                   |
|       -> Run migration chain:             |
|          v0.0.0 -> v0.1.0 -> v0.2.0      |
|       -> Each migration:                  |
|          - Renames keys                   |
|          - Restructures sections          |
|          - Adds default values            |
|          - Removes deprecated keys        |
|       -> Validate migrated config         |
|                                           |
|  5. Write migrated config back to disk    |
+-------------------------------------------+
```

### Migration Registry

```python
MIGRATIONS = {
    ("0.0.0", "0.1.0"): migrate_0_0_0_to_0_1_0,
    ("0.1.0", "0.2.0"): migrate_0_1_0_to_0_2_0,
    ("0.2.0", "1.0.0"): migrate_0_2_0_to_1_0_0,
}
```

### Migration Example

```python
def migrate_0_1_0_to_0_2_0(config: dict) -> dict:
    """Migrate from v0.1.0 to v0.2.0.

    Changes:
    - Renamed 'db_path' to 'database.path'
    - Renamed 'log_level' to 'logging.level'
    - Added 'scanner.parallel_workers' with default
    """
    # Rename database path
    if "db_path" in config:
        config.setdefault("database", {})["path"] = config.pop("db_path")

    # Rename log level
    if "log_level" in config:
        config.setdefault("logging", {})["level"] = config.pop("log_level")

    # Add new field with default
    config.setdefault("scanner", {})["parallel_workers"] = 4

    return config
```

### Backup Before Migration

The configuration manager automatically creates a backup before applying migrations:

```
~/.config/mhcp/
  mhcp.toml              # Current config
  mhcp.toml.backup       # Backup of pre-migration config
  mhcp.toml.migrated     # Post-migration config (renamed after verification)
```

---

## 5. Configuration Validation

Configuration is validated at multiple points.

### Validation Points

| Point | When | What |
|---|---|---|
| Schema definition | At startup | Schema structure itself |
| File load | On `ConfigurationManager.load()` | Full config against schema |
| Environment override | On `_apply_env_overrides()` | Type coercion and range |
| Runtime set | On `ConfigurationManager.set()` | Single value against field definition |
| Plugin config | On plugin load | Plugin-specific schema |

### Validation Rules

1. **Type checking:** Each field's value must match its declared `FieldType`.
2. **Required fields:** Fields marked `required=True` must be present.
3. **Custom validators:** Lambda validators in `FieldDefinition.validators` are executed sequentially.
4. **Section structure:** Sections must be `dict` objects (not lists, strings, etc.).
5. **Unknown sections:** Unknown sections are silently accepted (forward compatibility).

### Validation Error Format

```
[
    "logging.level: expected string, got int",
    "security.api_timeout_seconds: validation failed — must be > 0",
    "database: must be a mapping, got str"
]
```

### Validation Example

```python
schema = ConfigSchema()
schema.add_section("security")
schema.add_field("security", FieldDefinition(
    name="api_timeout_seconds",
    field_type=FieldType.INTEGER,
    default=30,
    validators=[
        lambda v: None if v > 0 else (_ for _ in ()).throw(
            ValueError("must be > 0")
        ),
    ],
))

errors = schema.validate({"security": {"api_timeout_seconds": -1}})
# errors = ["security.api_timeout_seconds: validation failed — must be > 0"]
```

### Fail-Safe Behavior

- If configuration validation fails, the application logs all errors and falls back to `DEFAULT_CONFIG`.
- Invalid values from environment variables are logged as warnings and skipped.
- The application never crashes due to a bad configuration value — it degrades gracefully.
