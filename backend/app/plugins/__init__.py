"""Plugin framework for SecureScan Pro X."""

from __future__ import annotations

import asyncio
import importlib
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


class PluginType(str, Enum):
    SCANNER = "scanner"
    ANALYZER = "analyzer"
    REPORTER = "reporter"
    NOTIFIER = "notifier"
    UTILITY = "utility"


class PluginStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    DISABLED = "disabled"
    LOADING = "loading"


@dataclass
class PluginManifest:
    name: str
    display_name: str
    description: str
    version: str
    author: str
    plugin_type: PluginType
    entry_point: str
    permissions: list[str] = field(default_factory=list)
    config_schema: dict[str, Any] = field(default_factory=dict)
    min_core_version: str = "0.1.0"


@dataclass
class PluginContext:
    plugin_id: str
    config: dict[str, Any] = field(default_factory=dict)
    workspace_id: str | None = None
    assessment_id: str | None = None
    timeout_seconds: int = 300


@dataclass
class PluginResult:
    success: bool
    findings: list[dict[str, Any]] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    duration_seconds: float = 0.0


class BasePlugin(ABC):
    def __init__(self, manifest: PluginManifest) -> None:
        self._manifest = manifest
        self._status = PluginStatus.INACTIVE
        self._loaded_at: str | None = None

    @property
    def manifest(self) -> PluginManifest:
        return self._manifest

    @property
    def status(self) -> PluginStatus:
        return self._status

    async def initialize(self, context: PluginContext) -> bool:
        self._status = PluginStatus.ACTIVE
        self._loaded_at = datetime.now(timezone.utc).isoformat()
        return True

    async def shutdown(self) -> None:
        self._status = PluginStatus.INACTIVE

    @abstractmethod
    async def execute(self, context: PluginContext) -> PluginResult: ...

    async def health_check(self) -> bool:
        return self._status == PluginStatus.ACTIVE


class PluginManager(ABC):
    @abstractmethod
    async def register(self, manifest: PluginManifest) -> bool: ...

    @abstractmethod
    async def unregister(self, plugin_id: str) -> bool: ...

    @abstractmethod
    async def activate(self, plugin_id: str) -> bool: ...

    @abstractmethod
    async def deactivate(self, plugin_id: str) -> bool: ...

    @abstractmethod
    async def execute(
        self, plugin_id: str, context: PluginContext
    ) -> PluginResult: ...

    @abstractmethod
    def list_plugins(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def get_plugin(self, plugin_id: str) -> dict[str, Any] | None: ...


class InMemoryPluginManager(PluginManager):
    def __init__(self, max_execution_time: int = 300) -> None:
        self._plugins: dict[str, PluginManifest] = {}
        self._plugin_instances: dict[str, BasePlugin] = {}
        self._plugin_status: dict[str, PluginStatus] = {}
        self._execution_log: list[dict[str, Any]] = []
        self._max_execution_time = max_execution_time

    async def register(self, manifest: PluginManifest) -> bool:
        if manifest.name in self._plugins:
            return False
        self._plugins[manifest.name] = manifest
        self._plugin_status[manifest.name] = PluginStatus.INACTIVE
        logger.info("plugin_registered", plugin=manifest.name, type=manifest.plugin_type.value)
        return True

    async def unregister(self, plugin_id: str) -> bool:
        if plugin_id not in self._plugins:
            return False
        if plugin_id in self._plugin_instances:
            await self._plugin_instances[plugin_id].shutdown()
            del self._plugin_instances[plugin_id]
        del self._plugins[plugin_id]
        self._plugin_status.pop(plugin_id, None)
        return True

    async def activate(self, plugin_id: str) -> bool:
        manifest = self._plugins.get(plugin_id)
        if not manifest:
            return False
        try:
            module = importlib.import_module(manifest.entry_point)
            plugin_class = getattr(module, "Plugin")
            instance = plugin_class(manifest)
            context = PluginContext(plugin_id=plugin_id)
            if await instance.initialize(context):
                self._plugin_instances[plugin_id] = instance
                self._plugin_status[plugin_id] = PluginStatus.ACTIVE
                logger.info("plugin_activated", plugin=plugin_id)
                return True
        except Exception as e:
            self._plugin_status[plugin_id] = PluginStatus.ERROR
            logger.error("plugin_activation_failed", plugin=plugin_id, error=str(e))
        return False

    async def deactivate(self, plugin_id: str) -> bool:
        instance = self._plugin_instances.get(plugin_id)
        if instance:
            await instance.shutdown()
            del self._plugin_instances[plugin_id]
        self._plugin_status[plugin_id] = PluginStatus.INACTIVE
        return True

    async def execute(
        self, plugin_id: str, context: PluginContext
    ) -> PluginResult:
        start = time.time()
        manifest = self._plugins.get(plugin_id)
        if not manifest:
            return PluginResult(success=False, error=f"Plugin {plugin_id} not found")

        instance = self._plugin_instances.get(plugin_id)
        if not instance:
            return PluginResult(success=False, error=f"Plugin {plugin_id} not activated")

        try:
            result = await asyncio.wait_for(
                instance.execute(context),
                timeout=self._max_execution_time,
            )
        except asyncio.TimeoutError:
            result = PluginResult(
                success=False,
                error=f"Plugin {plugin_id} timed out after {self._max_execution_time}s",
            )
        except Exception as e:
            result = PluginResult(success=False, error=str(e))

        result.duration_seconds = time.time() - start
        self._execution_log.append({
            "plugin_id": plugin_id,
            "success": result.success,
            "duration": result.duration_seconds,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return result

    def list_plugins(self) -> list[dict[str, Any]]:
        return [
            {
                "id": m.name,
                "name": m.display_name,
                "description": m.description,
                "version": m.version,
                "author": m.author,
                "type": m.plugin_type.value,
                "status": self._plugin_status.get(m.name, PluginStatus.INACTIVE).value,
            }
            for m in self._plugins.values()
        ]

    def get_plugin(self, plugin_id: str) -> dict[str, Any] | None:
        manifest = self._plugins.get(plugin_id)
        if not manifest:
            return None
        return {
            "id": manifest.name,
            "name": manifest.display_name,
            "description": manifest.description,
            "version": manifest.version,
            "author": manifest.author,
            "type": manifest.plugin_type.value,
            "status": self._plugin_status.get(manifest.name, PluginStatus.INACTIVE).value,
            "permissions": manifest.permissions,
        }
