"""Configuration example — load, validate, and manage MHCP settings.

Demonstrates:
1. Building a ConfigSchema and validating a candidate config.
2. Using ConfigurationManager to load TOML files and env overrides.
3. Reading and writing values via dot-separated keys.
4. Persisting the configuration to disk.

Usage:
    python config_manager.py
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from mhcp_config.defaults import DEFAULT_CONFIG
from mhcp_config.manager import ConfigurationManager
from mhcp_config.schema import ConfigSchema, FieldDefinition, FieldType


# ── 1. Schema definition ──────────────────────────────────────────

def build_schema() -> ConfigSchema:
    """Create a validation schema for the MHCP configuration."""
    schema = ConfigSchema()

    # -- logging section --
    schema.add_section("logging", description="Logging settings")
    schema.add_field(
        "logging",
        FieldDefinition(
            name="level",
            field_type=FieldType.STRING,
            default="INFO",
            description="Minimum log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)",
            validators=[
                lambda v: (
                    None
                    if v in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
                    else (_ for _ in ()).throw(ValueError(f"Invalid log level: {v}"))
                ),
            ],
        ),
    )
    schema.add_field(
        "logging",
        FieldDefinition(
            name="max_file_size_mb",
            field_type=FieldType.INTEGER,
            default=10,
            validators=[lambda v: None if v > 0 else (_ for _ in ()).throw(ValueError("Must be > 0"))],
        ),
    )
    schema.add_field(
        "logging",
        FieldDefinition(
            name="redact_sensitive",
            field_type=FieldType.BOOLEAN,
            default=True,
        ),
    )

    # -- security section --
    schema.add_section("security", description="Security policy settings")
    schema.add_field(
        "security",
        FieldDefinition(
            name="verify_hashes",
            field_type=FieldType.BOOLEAN,
            default=True,
        ),
    )
    schema.add_field(
        "security",
        FieldDefinition(
            name="hash_algorithms",
            field_type=FieldType.LIST,
            default=["sha256"],
        ),
    )
    schema.add_field(
        "security",
        FieldDefinition(
            name="api_timeout_seconds",
            field_type=FieldType.INTEGER,
            default=30,
            validators=[lambda v: None if v > 0 else (_ for _ in ()).throw(ValueError("Must be > 0"))],
        ),
    )

    # -- database section --
    schema.add_section("database", description="Database settings")
    schema.add_field(
        "database",
        FieldDefinition(
            name="engine",
            field_type=FieldType.STRING,
            default="sqlite",
        ),
    )
    schema.add_field(
        "database",
        FieldDefinition(
            name="pool_size",
            field_type=FieldType.INTEGER,
            default=5,
        ),
    )

    return schema


# ── 2. Validation demo ───────────────────────────────────────────

def demo_validation() -> None:
    """Show schema validation catching invalid config values."""
    print("=== Schema Validation ===\n")

    schema = build_schema()

    # Valid config.
    valid_config = {
        "logging": {"level": "DEBUG", "max_file_size_mb": 20, "redact_sensitive": False},
        "security": {"verify_hashes": True, "hash_algorithms": ["sha256", "md5"]},
        "database": {"engine": "sqlite", "pool_size": 5},
    }
    errors = schema.validate(valid_config)
    print(f"Valid config   : {len(errors)} error(s)")
    assert len(errors) == 0

    # Invalid config.
    invalid_config = {
        "logging": {"level": "VERBOSE", "max_file_size_mb": -1},
        "security": {"verify_hashes": "yes", "api_timeout_seconds": 0},
        "database": {"engine": 42},
    }
    errors = schema.validate(invalid_config)
    print(f"Invalid config : {len(errors)} error(s)")
    for err in errors:
        print(f"  - {err}")
    print()


# ── 3. ConfigurationManager demo ─────────────────────────────────

def demo_manager() -> None:
    """Show loading, reading, writing, and saving configuration."""
    print("=== ConfigurationManager ===\n")

    schema = build_schema()
    manager = ConfigurationManager(schema=schema)

    # Create a temporary TOML file to load.
    toml_content = b"""
[logging]
level = "WARNING"
max_file_size_mb = 50

[security]
verify_hashes = true
hash_algorithms = ["sha256", "sha512"]

[database]
engine = "sqlite"
pool_size = 10
"""
    tmp_dir = Path(tempfile.mkdtemp())
    config_path = tmp_dir / "mhcp.toml"
    config_path.write_bytes(toml_content)

    # Load the config file.
    manager.load(config_path)
    print(f"Loaded config version: {manager.config_version}")

    # Read values using dot-separated paths.
    log_level = manager.get("logging.level")
    print(f"logging.level = {log_level!r}")

    timeout = manager.get("security.api_timeout_seconds", default=30)
    print(f"security.api_timeout_seconds = {timeout!r}")

    pool = manager.get("database.pool_size")
    print(f"database.pool_size = {pool!r}")

    # Set a value programmatically.
    manager.set("security.api_timeout_seconds", 60)
    timeout = manager.get("security.api_timeout_seconds")
    print(f"security.api_timeout_seconds (after set) = {timeout!r}")

    # Access the full config dict.
    full = manager.as_dict()
    print(f"\nFull config keys: {list(full.keys())}")

    # Save to disk.
    save_path = tmp_dir / "mhcp_out.toml"
    manager.save(save_path)
    print(f"\nConfiguration saved to: {save_path}")
    print(f"  File exists: {save_path.exists()}")

    # Cleanup.
    config_path.unlink()
    save_path.unlink(missing_ok=True)
    tmp_dir.rmdir()
    print()


# ── 4. Environment variable overrides ────────────────────────────

def demo_env_overrides() -> None:
    """Show how MCP_ environment variables override config values."""
    print("=== Environment Variable Overrides ===\n")

    manager = ConfigurationManager()

    # Simulate setting env vars.
    os.environ["MCP_LOGGING__LEVEL"] = "DEBUG"
    os.environ["MCP_SECURITY__API_TIMEOUT_SECONDS"] = "120"

    manager._apply_env_overrides()

    log_level = manager.get("logging.level")
    timeout = manager.get("security.api_timeout_seconds")
    print(f"logging.level (from env) = {log_level!r}")
    print(f"security.api_timeout_seconds (from env) = {timeout!r}")

    # Cleanup.
    del os.environ["MCP_LOGGING__LEVEL"]
    del os.environ["MCP_SECURITY__API_TIMEOUT_SECONDS"]
    print()


# ── 5. Defaults demo ─────────────────────────────────────────────

def demo_defaults() -> None:
    """Show the built-in default configuration."""
    print("=== Default Configuration ===\n")
    print(json.dumps(DEFAULT_CONFIG, indent=2))
    print()


# ── Main ──────────────────────────────────────────────────────────

def main() -> None:
    demo_validation()
    demo_manager()
    demo_env_overrides()
    demo_defaults()
    print("All configuration demos completed.")


if __name__ == "__main__":
    main()
