"""Unit tests for the plugin framework (manifest, manager, lifecycle)."""

from __future__ import annotations

import sys
import types

import pytest

from app.plugins import (
    BasePlugin,
    InMemoryPluginManager,
    PluginContext,
    PluginManifest,
    PluginResult,
    PluginStatus,
    PluginType,
)


def _manifest(
    name: str = "fake-plugin",
    entry_point: str = "fake_plugin_mod",
) -> PluginManifest:
    return PluginManifest(
        name=name,
        display_name=name,
        description="Test plugin",
        version="1.0.0",
        author="qa",
        plugin_type=PluginType.SCANNER,
        entry_point=entry_point,
        permissions=["network"],
    )


class FakePlugin(BasePlugin):
    """Happy-path plugin: initialize succeeds, execute returns findings."""

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(
            success=True,
            findings=[{"id": "f1"}],
            metadata={"ctx": context.plugin_id},
        )


class ExplodingPlugin(BasePlugin):
    """Raises during execute (error-result path)."""

    async def execute(self, context: PluginContext) -> PluginResult:  # noqa: ARG002
        raise RuntimeError("boom")


class SlowPlugin(BasePlugin):
    """Sleeps past the manager's execution timeout."""

    async def execute(self, context: PluginContext) -> PluginResult:  # noqa: ARG002
        import asyncio

        await asyncio.sleep(5)
        return PluginResult(success=True)


@pytest.fixture
def fake_module():
    mod = types.ModuleType("fake_plugin_mod")
    mod.Plugin = FakePlugin
    sys.modules["fake_plugin_mod"] = mod
    yield mod
    sys.modules.pop("fake_plugin_mod", None)


class TestPluginData:
    def test_enums(self) -> None:
        assert PluginType.SCANNER.value == "scanner"
        assert PluginStatus.ACTIVE.value == "active"

    def test_manifest_defaults(self) -> None:
        m = _manifest()
        assert m.permissions == ["network"]
        assert m.min_core_version == "0.1.0"
        assert m.config_schema == {}

    def test_context_defaults(self) -> None:
        ctx = PluginContext(plugin_id="p1")
        assert ctx.config == {}
        assert ctx.workspace_id is None
        assert ctx.timeout_seconds == 300

    def test_result_defaults(self) -> None:
        r = PluginResult(success=True)
        assert r.findings == []
        assert r.error is None
        assert r.duration_seconds == 0.0


class TestBasePlugin:
    async def test_default_lifecycle(self) -> None:
        plugin = FakePlugin(_manifest())
        assert plugin.manifest.name == "fake-plugin"
        assert plugin.status == PluginStatus.INACTIVE
        assert await plugin.initialize(PluginContext(plugin_id="fake-plugin")) is True
        assert await plugin.health_check() is True
        await plugin.shutdown()

    def test_execute_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            BasePlugin(_manifest())  # type: ignore[abstract]


class TestPluginManager:
    async def test_register_and_list(self) -> None:
        mgr = InMemoryPluginManager()
        assert await mgr.register(_manifest()) is True
        assert await mgr.register(_manifest()) is False  # duplicate name
        listed = mgr.list_plugins()
        assert len(listed) == 1
        assert listed[0]["id"] == "fake-plugin"
        assert listed[0]["status"] == PluginStatus.INACTIVE.value
        assert listed[0]["type"] == "scanner"
        detail = mgr.get_plugin("fake-plugin")
        assert detail is not None
        assert detail["permissions"] == ["network"]
        assert mgr.get_plugin("nope") is None

    async def test_unregister(self, fake_module) -> None:  # noqa: ARG002
        mgr = InMemoryPluginManager()
        await mgr.register(_manifest())
        assert await mgr.unregister("nope") is False
        assert await mgr.unregister("fake-plugin") is True
        assert mgr.get_plugin("fake-plugin") is None
        assert mgr.list_plugins() == []

    async def test_activation_failure_unknown_module(self) -> None:
        mgr = InMemoryPluginManager()
        await mgr.register(_manifest(entry_point="module_that_does_not_exist_xyz"))
        assert await mgr.activate("fake-plugin") is False
        plugin = mgr.get_plugin("fake-plugin")
        assert plugin is not None
        assert plugin["status"] == PluginStatus.ERROR.value

    async def test_activate_execute_deactivate_cycle(self, fake_module) -> None:  # noqa: ARG002
        mgr = InMemoryPluginManager()
        await mgr.register(_manifest())
        assert await mgr.activate("unknown") is False
        assert await mgr.activate("fake-plugin") is True
        assert mgr.get_plugin("fake-plugin")["status"] == PluginStatus.ACTIVE.value

        result = await mgr.execute("fake-plugin", PluginContext(plugin_id="fake-plugin"))
        assert result.success is True
        assert result.findings == [{"id": "f1"}]
        assert result.duration_seconds >= 0.0

        assert await mgr.deactivate("fake-plugin") is True
        assert mgr.get_plugin("fake-plugin")["status"] == PluginStatus.INACTIVE.value
        # Executing a deactivated plugin reports cleanly.
        result = await mgr.execute("fake-plugin", PluginContext(plugin_id="fake-plugin"))
        assert result.success is False
        assert "not activated" in (result.error or "")

    async def test_execute_unknown_plugin(self) -> None:
        mgr = InMemoryPluginManager()
        result = await mgr.execute("ghost", PluginContext(plugin_id="ghost"))
        assert result.success is False
        assert "not found" in (result.error or "")

    async def test_execute_exception_is_captured(self) -> None:
        mod = types.ModuleType("fake_plugin_mod")
        mod.Plugin = ExplodingPlugin
        sys.modules["fake_plugin_mod"] = mod
        try:
            mgr = InMemoryPluginManager()
            await mgr.register(_manifest())
            await mgr.activate("fake-plugin")
            result = await mgr.execute("fake-plugin", PluginContext(plugin_id="fake-plugin"))
            assert result.success is False
            assert "boom" in (result.error or "")
        finally:
            sys.modules.pop("fake_plugin_mod", None)

    async def test_execute_timeout_is_captured(self) -> None:
        mod = types.ModuleType("fake_plugin_mod")
        mod.Plugin = SlowPlugin
        sys.modules["fake_plugin_mod"] = mod
        try:
            mgr = InMemoryPluginManager(max_execution_time=0.05)
            await mgr.register(_manifest())
            await mgr.activate("fake-plugin")
            result = await mgr.execute("fake-plugin", PluginContext(plugin_id="fake-plugin"))
            assert result.success is False
            assert "timed out" in (result.error or "")
        finally:
            sys.modules.pop("fake_plugin_mod", None)

    async def test_unregister_shuts_down_instance(self, fake_module) -> None:  # noqa: ARG002
        mgr = InMemoryPluginManager()
        await mgr.register(_manifest())
        await mgr.activate("fake-plugin")
        assert await mgr.unregister("fake-plugin") is True
        assert mgr.list_plugins() == []
