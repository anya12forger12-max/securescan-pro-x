"""Unit tests for ConfigurationService."""

from __future__ import annotations

import pytest

from app.services.configuration import InMemoryConfigurationService


class TestConfigurationService:
    """Tests for ConfigurationService implementation."""

    @pytest.fixture
    def service(self) -> InMemoryConfigurationService:
        """Create a fresh service for each test."""
        return InMemoryConfigurationService()

    @pytest.mark.asyncio
    async def test_get_default_value(
        self, service: InMemoryConfigurationService
    ) -> None:
        """Getting an unset key returns the default value."""
        result = await service.get("nonexistent.key", default="fallback")
        assert result == "fallback"

    @pytest.mark.asyncio
    async def test_set_and_get(
        self, service: InMemoryConfigurationService
    ) -> None:
        """Setting and getting a value works."""
        await service.set("app.name", "TestApp")
        result = await service.get("app.name")
        assert result == "TestApp"

    @pytest.mark.asyncio
    async def test_nested_keys(
        self, service: InMemoryConfigurationService
    ) -> None:
        """Nested dot-separated keys work correctly."""
        await service.set("ui.theme", "dark")
        await service.set("ui.font_size", "large")

        assert await service.get("ui.theme") == "dark"
        assert await service.get("ui.font_size") == "large"

    @pytest.mark.asyncio
    async def test_get_all(
        self, service: InMemoryConfigurationService
    ) -> None:
        """Getting all config returns full dictionary."""
        await service.set("a", 1)
        await service.set("b", 2)

        all_config = await service.get_all()
        assert all_config["a"] == 1
        assert all_config["b"] == 2

    @pytest.mark.asyncio
    async def test_reset(
        self, service: InMemoryConfigurationService
    ) -> None:
        """Resetting clears all configuration."""
        await service.set("key", "value")
        await service.reset()

        result = await service.get("key")
        assert result is None

    @pytest.mark.asyncio
    async def test_overwrite_value(
        self, service: InMemoryConfigurationService
    ) -> None:
        """Setting an existing key overwrites the value."""
        await service.set("key", "old")
        await service.set("key", "new")

        result = await service.get("key")
        assert result == "new"
