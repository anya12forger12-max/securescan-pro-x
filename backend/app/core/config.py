"""Application configuration management.

Three-tier configuration system:
1. Defaults — Built-in sensible defaults
2. System — Installed configuration
3. User — Per-user overrides (highest priority)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class LoggingConfig(BaseSettings):
    """Logging configuration."""

    level: str = "info"
    format: str = "json"
    file: bool = True
    file_path: str = "~/.securescan/logs/"
    max_file_size_mb: int = 100
    retention_days: int = 30


class AuditConfig(BaseSettings):
    """Audit logging configuration."""

    enabled: bool = True
    immutable: bool = True
    path: str = "~/.securescan/audit/"


class DatabaseConfig(BaseSettings):
    """Database configuration."""

    type: str = "sqlite"
    path: str = "~/.securescan/data/securescan.db"
    encryption: bool = True
    backup_on_migration: bool = True


class SecurityConfig(BaseSettings):
    """Security configuration."""

    encryption_algorithm: str = "AES-256-GCM"
    encryption_at_rest: bool = True
    session_timeout_minutes: int = 30
    max_failed_attempts: int = 5
    authentication_method: str = "local"


class NetworkConfig(BaseSettings):
    """Network configuration."""

    enabled: bool = False
    proxy: Optional[str] = None
    timeout: int = 30
    cve_lookup: bool = False
    update_check: bool = False
    plugin_download: bool = False


class PluginConfig(BaseSettings):
    """Plugin configuration."""

    enabled: bool = True
    directory: str = "~/.securescan/plugins/"
    sandbox: bool = True
    signature_verification: bool = True
    memory_limit_mb: int = 512
    cpu_limit_percent: int = 50
    timeout_seconds: int = 300


class UIConfig(BaseSettings):
    """UI configuration."""

    theme: str = "dark"
    font_size: str = "medium"
    reduce_motion: bool = False
    sidebar_collapsed: bool = False
    language: str = "en"


class BackupConfig(BaseSettings):
    """Backup configuration."""

    enabled: bool = True
    directory: str = "~/.securescan/backups/"
    max_backups: int = 10
    auto_backup_days: int = 7
    compression: bool = True
    encryption: bool = True


class Settings(BaseSettings):
    """Application settings — the single source of truth for configuration.

    Settings are loaded from (in order of precedence):
    1. Environment variables (SECURESCAN_*)
    2. User config file (~/.securescan/config/config.yaml)
    3. System config file (/etc/securescan/config.yaml)
    4. Defaults defined here
    """

    # Application
    app_name: str = "SecureScan Pro X"
    version: str = "0.1.0"
    debug: bool = False
    home_dir: str = "~/.securescan"

    # Component configs
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    audit: AuditConfig = Field(default_factory=AuditConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    plugins: PluginConfig = Field(default_factory=PluginConfig)
    ui: UIConfig = Field(default_factory=UIConfig)
    backup: BackupConfig = Field(default_factory=BackupConfig)

    @field_validator("home_dir", mode="before")
    @classmethod
    def expand_home_dir(cls, v: str) -> str:
        """Expand ~ in home directory path."""
        return str(Path(v).expanduser())

    @property
    def data_dir(self) -> Path:
        """Return the data directory path."""
        return Path(self.home_dir) / "data"

    @property
    def config_dir(self) -> Path:
        """Return the config directory path."""
        return Path(self.home_dir) / "config"

    @property
    def log_dir(self) -> Path:
        """Return the log directory path."""
        return Path(self.home_dir).expanduser() / "logs"

    @property
    def plugin_dir(self) -> Path:
        """Return the plugin directory path."""
        return Path(self.plugins.directory).expanduser()

    @property
    def backup_dir(self) -> Path:
        """Return the backup directory path."""
        return Path(self.backup.directory).expanduser()

    def ensure_directories(self) -> None:
        """Create required directories if they don't exist."""
        for directory in [
            self.data_dir,
            self.config_dir,
            self.log_dir,
            self.plugin_dir,
            self.backup_dir,
        ]:
            directory.mkdir(parents=True, exist_ok=True)


def _load_yaml_config(path: Path) -> dict[str, Any]:
    """Load configuration from a YAML file.

    Args:
        path: Path to the YAML configuration file.

    Returns:
        Dictionary of configuration values, or empty dict if file not found.
    """
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            content = yaml.safe_load(f)
            return content if isinstance(content, dict) else {}
    except (yaml.YAMLError, OSError):
        return {}


def load_settings() -> Settings:
    """Load settings from all sources with proper precedence.

    Precedence (highest to lowest):
    1. Environment variables
    2. User config (~/.securescan/config/config.yaml)
    3. System config (/etc/securescan/config.yaml)
    4. Defaults

    Returns:
        Fully loaded Settings instance.
    """
    home = Path(os.environ.get("SECURESCAN_HOME", "~/.securescan")).expanduser()
    user_config = _load_yaml_config(home / "config" / "config.yaml")
    system_config = _load_yaml_config(Path("/etc/securescan/config.yaml"))

    # Merge configs (later overrides earlier)
    merged: dict[str, Any] = {}
    merged.update(system_config)
    merged.update(user_config)

    settings = Settings(**merged)
    settings.ensure_directories()
    return settings


# Global settings instance
settings = load_settings()
