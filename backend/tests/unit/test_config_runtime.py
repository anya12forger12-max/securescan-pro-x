"""Regression tests for configuration loading at runtime."""

from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import TYPE_CHECKING

import app.core.config as config

if TYPE_CHECKING:
    import pytest


def test_ambient_path_does_not_override_database_path() -> None:
    settings = config.Settings()
    assert settings.database.path != os.environ.get("PATH")
    assert settings.database.path.endswith("securescan.db")
    assert settings.audit.path.endswith("audit")


def test_securescan_home_controls_runtime_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("SECURESCAN_HOME", str(tmp_path))
    try:
        reloaded = importlib.reload(config).settings
        assert reloaded.home_dir == str(tmp_path)
        assert reloaded.database.path == str(tmp_path / "data" / "securescan.db")
        assert reloaded.audit.path == str(tmp_path / "audit")
        assert reloaded.logging.file_path == str(tmp_path / "logs")
        assert reloaded.plugin_dir == tmp_path / "plugins"
        assert reloaded.backup_dir == tmp_path / "backups"
    finally:
        monkeypatch.delenv("SECURESCAN_HOME", raising=False)
        importlib.reload(config)


def test_nested_env_uses_prefixed_names(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    db_path = tmp_path / "custom-securescan.db"
    monkeypatch.setenv("SECURESCAN_DATABASE__PATH", str(db_path))
    try:
        settings = config.Settings()
        assert settings.database.path == str(db_path)
    finally:
        monkeypatch.delenv("SECURESCAN_DATABASE__PATH", raising=False)
