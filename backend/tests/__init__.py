"""Test configuration and fixtures for SecureScan Pro X backend tests."""

from __future__ import annotations

import pytest

from app.services.workspace import InMemoryWorkspaceService
from app.services.asset import InMemoryAssetService
from app.services.assessment import InMemoryAssessmentService
from app.services.audit import InMemoryAuditService
from app.services.configuration import InMemoryConfigurationService
from app.services.plugin import InMemoryPluginManager


@pytest.fixture
def workspace_service() -> InMemoryWorkspaceService:
    """Create a fresh workspace service for testing."""
    return InMemoryWorkspaceService()


@pytest.fixture
def asset_service() -> InMemoryAssetService:
    """Create a fresh asset service for testing."""
    return InMemoryAssetService()


@pytest.fixture
def assessment_service() -> InMemoryAssessmentService:
    """Create a fresh assessment service for testing."""
    return InMemoryAssessmentService()


@pytest.fixture
def audit_service() -> InMemoryAuditService:
    """Create a fresh audit service for testing."""
    return InMemoryAuditService()


@pytest.fixture
def config_service() -> InMemoryConfigurationService:
    """Create a fresh configuration service for testing."""
    return InMemoryConfigurationService()


@pytest.fixture
def plugin_manager() -> InMemoryPluginManager:
    """Create a fresh plugin manager for testing."""
    return InMemoryPluginManager()
