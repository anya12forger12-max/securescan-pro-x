"""Root conftest.py — shared test fixtures."""

from __future__ import annotations

import pytest


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    """Use asyncio backend for all async tests."""
    return "asyncio"
