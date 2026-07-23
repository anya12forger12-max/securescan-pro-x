"""Plugin manager — discovery, loading, and lifecycle management.

Manages the plugin ecosystem with sandboxing, permission verification,
and resource limits.

NOTE: Phase 1A scaffolds the interface only. Plugin execution is Phase 4.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class PluginType(str, Enum):
    """Types of plugins supported."""

    CHECK = "check"
    REPORT = "report"
    KNOWLEDGE = "knowledge"
    INTEGRATION = "integration"
    UI = "ui"


class PluginStatus(str, Enum):
    """Plugin lifecycle states."""

    DISCOVERED = "discovered"
    LOADED = "loaded"
    INITIALIZED = "initialized"
    RUNNING = "running"
    ERROR = "error"
    DISABLED = "disabled"


@dataclass
class PluginInfo:
    """Metadata about a plugin."""

    id: str
    name: str
    version: str
    description: str
    author: str = ""
    plugin_type: PluginType = PluginType.CHECK
    permissions: list[str] = field(default_factory=list)
    target_types: list[str] = field(default_factory=list)
    min_securescan_version: str = "0.1.0"
    status: PluginStatus = PluginStatus.DISCOVERED
    error_message: str | None = None


class PluginManager(ABC):
    """Interface for plugin management operations."""

    @abstractmethod
    async def discover(self) -> list[PluginInfo]:
        """Discover all available plugins.

        Scans the plugin directory for valid plugins.

        Returns:
            List of discovered plugin info.
        """
        ...

    @abstractmethod
    async def load(self, plugin_id: str) -> PluginInfo:
        """Load a plugin by ID.

        Args:
            plugin_id: Plugin to load.

        Returns:
            Plugin info after loading.

        Raises:
            PluginNotFoundError: If plugin does not exist.
            PluginLoadError: If plugin fails to load.
            PluginSignatureError: If signature verification fails.
        """
        ...

    @abstractmethod
    async def initialize(self, plugin_id: str) -> PluginInfo:
        """Initialize a loaded plugin.

        Args:
            plugin_id: Plugin to initialize.

        Returns:
            Plugin info after initialization.

        Raises:
            PluginLoadError: If initialization fails.
            PluginPermissionError: If required permissions not granted.
        """
        ...

    @abstractmethod
    async def unload(self, plugin_id: str) -> None:
        """Unload a plugin.

        Args:
            plugin_id: Plugin to unload.
        """
        ...

    @abstractmethod
    async def get(self, plugin_id: str) -> PluginInfo:
        """Get plugin info by ID.

        Args:
            plugin_id: Plugin ID.

        Returns:
            Plugin info.

        Raises:
            PluginNotFoundError: If plugin does not exist.
        """
        ...

    @abstractmethod
    async def list_plugins(
        self,
        plugin_type: PluginType | None = None,
    ) -> list[PluginInfo]:
        """List all plugins.

        Args:
            plugin_type: Filter by plugin type.

        Returns:
            List of plugin info.
        """
        ...

    @abstractmethod
    async def check_permissions(
        self,
        plugin_id: str,
        granted_permissions: list[str],
    ) -> bool:
        """Check if a plugin has all required permissions.

        Args:
            plugin_id: Plugin to check.
            granted_permissions: Permissions granted to the plugin.

        Returns:
            True if all required permissions are granted.
        """
        ...


class InMemoryPluginManager(PluginManager):
    """In-memory plugin manager for development and testing.

    Plugins are stored as metadata only — no actual execution.
    """

    def __init__(self) -> None:
        """Initialize the in-memory plugin store."""
        self._plugins: dict[str, PluginInfo] = {}

    async def discover(self) -> list[PluginInfo]:
        """Discover plugins from the in-memory store.

        Returns:
            List of all registered plugins.
        """
        return list(self._plugins.values())

    async def load(self, plugin_id: str) -> PluginInfo:
        """Load a plugin (mark as loaded in memory).

        Args:
            plugin_id: Plugin to load.

        Returns:
            Updated plugin info.

        Raises:
            PluginNotFoundError: If plugin does not exist.
        """
        plugin = self._plugins.get(plugin_id)
        if plugin is None:
            from app.core.exceptions import PluginNotFoundError
            raise PluginNotFoundError(f"Plugin '{plugin_id}' not found")

        plugin.status = PluginStatus.LOADED
        return plugin

    async def initialize(self, plugin_id: str) -> PluginInfo:
        """Initialize a loaded plugin.

        Args:
            plugin_id: Plugin to initialize.

        Returns:
            Updated plugin info.

        Raises:
            PluginLoadError: If plugin not loaded.
        """
        plugin = self._plugins.get(plugin_id)
        if plugin is None:
            from app.core.exceptions import PluginNotFoundError
            raise PluginNotFoundError(f"Plugin '{plugin_id}' not found")

        if plugin.status != PluginStatus.LOADED:
            from app.core.exceptions import PluginLoadError
            raise PluginLoadError(
                f"Plugin '{plugin_id}' must be loaded before initialization"
            )

        plugin.status = PluginStatus.INITIALIZED
        return plugin

    async def unload(self, plugin_id: str) -> None:
        """Unload a plugin.

        Args:
            plugin_id: Plugin to unload.
        """
        if plugin_id in self._plugins:
            self._plugins[plugin_id].status = PluginStatus.DISABLED

    async def get(self, plugin_id: str) -> PluginInfo:
        """Get plugin info by ID.

        Args:
            plugin_id: Plugin ID.

        Returns:
            Plugin info.

        Raises:
            PluginNotFoundError: If plugin does not exist.
        """
        plugin = self._plugins.get(plugin_id)
        if plugin is None:
            from app.core.exceptions import PluginNotFoundError
            raise PluginNotFoundError(f"Plugin '{plugin_id}' not found")
        return plugin

    async def list_plugins(
        self,
        plugin_type: PluginType | None = None,
    ) -> list[PluginInfo]:
        """List all plugins.

        Args:
            plugin_type: Filter by plugin type.

        Returns:
            List of plugin info.
        """
        plugins = list(self._plugins.values())
        if plugin_type is not None:
            plugins = [p for p in plugins if p.plugin_type == plugin_type]
        return plugins

    async def check_permissions(
        self,
        plugin_id: str,
        granted_permissions: list[str],
    ) -> bool:
        """Check if a plugin has all required permissions.

        Args:
            plugin_id: Plugin to check.
            granted_permissions: Permissions granted to the plugin.

        Returns:
            True if all required permissions are granted.
        """
        plugin = self._plugins.get(plugin_id)
        if plugin is None:
            return False
        return all(
            perm in granted_permissions for perm in plugin.permissions
        )

    def register_plugin(self, info: PluginInfo) -> None:
        """Register a plugin in memory (for testing).

        Args:
            info: Plugin info to register.
        """
        self._plugins[info.id] = info
