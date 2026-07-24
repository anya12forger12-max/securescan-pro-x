"""Unit tests for assessment profiles and policies.

Tests cover profile CRUD, built-in profiles, policy CRUD,
built-in policies, and policy validation.
"""

from __future__ import annotations

import pytest

from app.core.exceptions import AssessmentNotFoundError, ValidationError
from app.services.assessment.profiles import (
    BUILTIN_PROFILES,
    InMemoryProfileService,
)
from app.services.assessment.policies import (
    BUILTIN_POLICIES,
    InMemoryPolicyService,
)


class TestProfileService:
    """Tests for InMemoryProfileService."""

    @pytest.fixture
    def service(self) -> InMemoryProfileService:
        """Create a fresh service with built-in profiles."""
        return InMemoryProfileService()

    @pytest.mark.asyncio
    async def test_builtin_profiles_loaded(self, service: InMemoryProfileService) -> None:
        """Built-in profiles are loaded on init."""
        profiles, total = await service.list()
        assert total == len(BUILTIN_PROFILES)

    @pytest.mark.asyncio
    async def test_create_profile(self, service: InMemoryProfileService) -> None:
        """Creating a profile succeeds."""
        result = await service.create(
            name="Custom Profile",
            description="My custom profile",
            timeout_seconds=1800,
        )
        assert result["name"] == "Custom Profile"
        assert result["timeout_seconds"] == 1800
        assert not result["is_builtin"]

    @pytest.mark.asyncio
    async def test_create_duplicate_name(self, service: InMemoryProfileService) -> None:
        """Creating a profile with duplicate name raises error."""
        await service.create(name="Unique")
        with pytest.raises(ValidationError):
            await service.create(name="Unique")

    @pytest.mark.asyncio
    async def test_get_profile(self, service: InMemoryProfileService) -> None:
        """Getting an existing profile returns it."""
        created = await service.create(name="Get Me")
        result = await service.get(created["id"])
        assert result["name"] == "Get Me"

    @pytest.mark.asyncio
    async def test_get_profile_not_found(self, service: InMemoryProfileService) -> None:
        """Getting nonexistent profile raises error."""
        with pytest.raises(AssessmentNotFoundError):
            await service.get("nonexistent")

    @pytest.mark.asyncio
    async def test_update_profile(self, service: InMemoryProfileService) -> None:
        """Updating a profile succeeds."""
        created = await service.create(name="Original")
        updated = await service.update(created["id"], name="Updated")
        assert updated["name"] == "Updated"

    @pytest.mark.asyncio
    async def test_delete_profile(self, service: InMemoryProfileService) -> None:
        """Deleting a custom profile succeeds."""
        created = await service.create(name="To Delete")
        await service.delete(created["id"])
        with pytest.raises(AssessmentNotFoundError):
            await service.get(created["id"])

    @pytest.mark.asyncio
    async def test_delete_builtin_profile(self, service: InMemoryProfileService) -> None:
        """Deleting a built-in profile raises error."""
        profiles, _ = await service.list()
        builtin_id = profiles[0]["id"]
        with pytest.raises(ValidationError):
            await service.delete(builtin_id)

    @pytest.mark.asyncio
    async def test_list_with_offset(self, service: InMemoryProfileService) -> None:
        """Listing with offset and limit works."""
        await service.create(name="P1")
        await service.create(name="P2")
        all_profiles, total = await service.list()
        assert total >= len(BUILTIN_PROFILES) + 2

        page, page_total = await service.list(offset=0, limit=2)
        assert len(page) == 2
        assert page_total == total


class TestPolicyService:
    """Tests for InMemoryPolicyService."""

    @pytest.fixture
    def service(self) -> InMemoryPolicyService:
        """Create a fresh service with built-in policies."""
        return InMemoryPolicyService()

    @pytest.mark.asyncio
    async def test_builtin_policies_loaded(self, service: InMemoryPolicyService) -> None:
        """Built-in policies are loaded on init."""
        policies, total = await service.list()
        assert total == len(BUILTIN_POLICIES)

    @pytest.mark.asyncio
    async def test_create_policy(self, service: InMemoryPolicyService) -> None:
        """Creating a policy succeeds."""
        result = await service.create(
            name="Custom Policy",
            max_runtime_seconds=1800,
            approval_required=True,
        )
        assert result["name"] == "Custom Policy"
        assert result["max_runtime_seconds"] == 1800
        assert result["approval_required"] is True

    @pytest.mark.asyncio
    async def test_create_duplicate_name(self, service: InMemoryPolicyService) -> None:
        """Creating a policy with duplicate name raises error."""
        await service.create(name="Unique")
        with pytest.raises(ValidationError):
            await service.create(name="Unique")

    @pytest.mark.asyncio
    async def test_create_invalid_cpu(self, service: InMemoryPolicyService) -> None:
        """Creating a policy with invalid CPU percent raises error."""
        with pytest.raises(ValidationError):
            await service.create(name="Bad", max_cpu_percent=150)

    @pytest.mark.asyncio
    async def test_get_policy(self, service: InMemoryPolicyService) -> None:
        """Getting an existing policy returns it."""
        created = await service.create(name="Get Me")
        result = await service.get(created["id"])
        assert result["name"] == "Get Me"

    @pytest.mark.asyncio
    async def test_update_policy(self, service: InMemoryPolicyService) -> None:
        """Updating a policy succeeds."""
        created = await service.create(name="Original")
        updated = await service.update(created["id"], name="Updated")
        assert updated["name"] == "Updated"

    @pytest.mark.asyncio
    async def test_delete_policy(self, service: InMemoryPolicyService) -> None:
        """Deleting a custom policy succeeds."""
        created = await service.create(name="To Delete")
        await service.delete(created["id"])
        with pytest.raises(AssessmentNotFoundError):
            await service.get(created["id"])

    @pytest.mark.asyncio
    async def test_delete_builtin_policy(self, service: InMemoryPolicyService) -> None:
        """Deleting a built-in policy raises error."""
        policies, _ = await service.list()
        builtin_id = policies[0]["id"]
        with pytest.raises(ValidationError):
            await service.delete(builtin_id)

    @pytest.mark.asyncio
    async def test_validate_assessment_valid(self, service: InMemoryPolicyService) -> None:
        """Validation passes with no violations."""
        policy = await service.create(name="Test", approval_required=False)
        is_valid, violations = await service.validate_assessment(
            policy["id"],
            {"plugin_ids": ["p1"], "approved": False},
        )
        assert is_valid
        assert violations == []

    @pytest.mark.asyncio
    async def test_validate_assessment_plugin_restricted(self, service: InMemoryPolicyService) -> None:
        """Validation fails for restricted plugins."""
        policy = await service.create(
            name="Restricted",
            allowed_plugin_ids=["allowed-plugin"],
        )
        is_valid, violations = await service.validate_assessment(
            policy["id"],
            {"plugin_ids": ["not-allowed"]},
        )
        assert not is_valid
        assert len(violations) == 1
        assert "not-allowed" in violations[0]

    @pytest.mark.asyncio
    async def test_validate_assessment_approval_required(self, service: InMemoryPolicyService) -> None:
        """Validation fails when approval is required but not granted."""
        policy = await service.create(
            name="Needs Approval",
            approval_required=True,
        )
        is_valid, violations = await service.validate_assessment(
            policy["id"],
            {"approved": False},
        )
        assert not is_valid
        assert any("approval" in v.lower() for v in violations)

    @pytest.mark.asyncio
    async def test_validate_assessment_export_blocked(self, service: InMemoryPolicyService) -> None:
        """Validation fails when export is blocked."""
        policy = await service.create(
            name="No Export",
            export_allowed=False,
        )
        is_valid, violations = await service.validate_assessment(
            policy["id"],
            {"export_format": "pdf"},
        )
        assert not is_valid
        assert any("export" in v.lower() for v in violations)
