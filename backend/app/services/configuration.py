"""Configuration service — manages application configuration.

Provides CRUD operations for configuration with validation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


class ConfigurationService(ABC):
    """Interface for configuration management operations."""

    @abstractmethod
    async def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value by key.

        Args:
            key: Dot-separated configuration key.
            default: Default value if key not found.

        Returns:
            The configuration value.
        """
        ...

    @abstractmethod
    async def set(self, key: str, value: Any) -> None:
        """Set a configuration value.

        Args:
            key: Dot-separated configuration key.
            value: Value to set.

        Raises:
            ValidationError: If value fails validation.
        """
        ...

    @abstractmethod
    async def get_all(self) -> dict[str, Any]:
        """Get all configuration values.

        Returns:
            Dictionary of all configuration.
        """
        ...

    @abstractmethod
    async def reset(self) -> None:
        """Reset all configuration to defaults."""
        ...


class InMemoryConfigurationService(ConfigurationService):
    """In-memory configuration service for development and testing.

    Stores configuration in a dictionary. Suitable for single-session use.
    """

    def __init__(self, initial: dict[str, Any] | None = None) -> None:
        """Initialize with optional initial configuration.

        Args:
            initial: Initial configuration values.
        """
        self._config: dict[str, Any] = initial or {}

    async def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value by dot-separated key.

        Args:
            key: Dot-separated configuration key (e.g., 'ui.theme').
            default: Default value if key not found.

        Returns:
            The configuration value, or default.
        """
        keys = key.split(".")
        value: Any = self._config
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default
            if value is None:
                return default
        return value

    async def set(self, key: str, value: Any) -> None:
        """Set a configuration value by dot-separated key.

        Args:
            key: Dot-separated configuration key.
            value: Value to set.
        """
        keys = key.split(".")
        target = self._config
        for k in keys[:-1]:
            if k not in target or not isinstance(target[k], dict):
                target[k] = {}
            target = target[k]
        target[keys[-1]] = value
        logger.info("config.set", key=key)

    async def get_all(self) -> dict[str, Any]:
        """Get all configuration values.

        Returns:
            Copy of the full configuration dictionary.
        """
        return dict(self._config)

    async def reset(self) -> None:
        """Reset configuration to empty."""
        self._config.clear()
        logger.info("config.reset")
