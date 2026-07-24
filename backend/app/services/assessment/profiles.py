"""Assessment profiles — reusable assessment configuration templates.

Profiles define how an assessment should be executed: timeouts, which plugins
to run, evidence collection settings, reporting style, and concurrency limits.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.exceptions import AssessmentNotFoundError, ValidationError
from app.core.logging import get_logger

logger = get_logger(__name__)


# ── Built-in Profiles ──────────────────────────────────────────────

BUILTIN_PROFILES: list[dict[str, Any]] = [
    {
        "name": "Quick Review",
        "description": "Fast overview assessment with minimal checks.",
        "timeout_seconds": 600,
        "concurrency_limit": 10,
        "evidence_collection": True,
        "reporting_style": "summary",
        "plugin_ids": [],
        "policy_ids": [],
    },
    {
        "name": "Baseline Review",
        "description": "Standard baseline security review.",
        "timeout_seconds": 3600,
        "concurrency_limit": 5,
        "evidence_collection": True,
        "reporting_style": "standard",
        "plugin_ids": [],
        "policy_ids": [],
    },
    {
        "name": "Configuration Audit",
        "description": "Detailed configuration and hardening audit.",
        "timeout_seconds": 7200,
        "concurrency_limit": 3,
        "evidence_collection": True,
        "reporting_style": "detailed",
        "plugin_ids": [],
        "policy_ids": [],
    },
    {
        "name": "Documentation Review",
        "description": "Review documentation completeness and accuracy.",
        "timeout_seconds": 1800,
        "concurrency_limit": 5,
        "evidence_collection": True,
        "reporting_style": "standard",
        "plugin_ids": [],
        "policy_ids": [],
    },
    {
        "name": "Compliance Review",
        "description": "Compliance-focused assessment against standards.",
        "timeout_seconds": 10800,
        "concurrency_limit": 2,
        "evidence_collection": True,
        "reporting_style": "compliance",
        "plugin_ids": [],
        "policy_ids": [],
    },
    {
        "name": "Demo Assessment",
        "description": "Demo profile for testing with sample data only.",
        "timeout_seconds": 300,
        "concurrency_limit": 10,
        "evidence_collection": False,
        "reporting_style": "summary",
        "plugin_ids": [],
        "policy_ids": [],
    },
]


# ── Profile Service Interface ──────────────────────────────────────


class ProfileService(ABC):
    """Interface for assessment profile management."""

    @abstractmethod
    async def create(
        self,
        name: str,
        description: str | None = None,
        timeout_seconds: int = 3600,
        concurrency_limit: int = 5,
        evidence_collection: bool = True,
        reporting_style: str = "standard",
        notification_rules: dict[str, Any] | None = None,
        plugin_ids: list[str] | None = None,
        policy_ids: list[str] | None = None,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new assessment profile.

        Args:
            name: Profile name (must be unique).
            description: Optional description.
            timeout_seconds: Maximum execution time.
            concurrency_limit: Max concurrent jobs.
            evidence_collection: Whether to collect evidence.
            reporting_style: Style of report output.
            notification_rules: Notification configuration.
            plugin_ids: Plugins to use with this profile.
            policy_ids: Policies to apply.
            config: Additional configuration.

        Returns:
            Created profile data.

        Raises:
            ValidationError: If the profile is invalid.
        """
        ...

    @abstractmethod
    async def get(self, profile_id: str) -> dict[str, Any]:
        """Get a profile by ID.

        Args:
            profile_id: Profile ID.

        Returns:
            Profile data.

        Raises:
            AssessmentNotFoundError: If profile does not exist.
        """
        ...

    @abstractmethod
    async def list(
        self,
        include_builtin: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """List all profiles.

        Args:
            include_builtin: Include built-in profiles.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (list of profiles, total count).
        """
        ...

    @abstractmethod
    async def update(
        self,
        profile_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Update a profile.

        Args:
            profile_id: Profile to update.
            **kwargs: Fields to update.

        Returns:
            Updated profile.

        Raises:
            AssessmentNotFoundError: If profile does not exist.
        """
        ...

    @abstractmethod
    async def delete(self, profile_id: str) -> None:
        """Delete a profile. Built-in profiles cannot be deleted.

        Args:
            profile_id: Profile to delete.

        Raises:
            AssessmentNotFoundError: If profile does not exist.
            ValidationError: If attempting to delete a built-in profile.
        """
        ...


# ── In-Memory Implementation ──────────────────────────────────────


class InMemoryProfileService(ProfileService):
    """In-memory profile service with built-in profiles."""

    def __init__(self) -> None:
        """Initialize with built-in profiles."""
        self._profiles: dict[str, dict[str, Any]] = {}
        self._counter: int = 0

        # Register built-in profiles
        for bp in BUILTIN_PROFILES:
            self._counter += 1
            pid = f"profile-{self._counter:08d}"
            self._profiles[pid] = {
                "id": pid,
                "is_builtin": True,
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
                **bp,
            }

    async def create(
        self,
        name: str,
        description: str | None = None,
        timeout_seconds: int = 3600,
        concurrency_limit: int = 5,
        evidence_collection: bool = True,
        reporting_style: str = "standard",
        notification_rules: dict[str, Any] | None = None,
        plugin_ids: list[str] | None = None,
        policy_ids: list[str] | None = None,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new assessment profile.

        Args:
            name: Profile name.
            description: Optional description.
            timeout_seconds: Maximum execution time.
            concurrency_limit: Max concurrent jobs.
            evidence_collection: Whether to collect evidence.
            reporting_style: Report output style.
            notification_rules: Notification config.
            plugin_ids: Plugin IDs.
            policy_ids: Policy IDs.
            config: Additional config.

        Returns:
            Created profile.

        Raises:
            ValidationError: If name is not unique or invalid.
        """
        # Check uniqueness
        for p in self._profiles.values():
            if p["name"] == name and not p["is_deleted"]:
                raise ValidationError(f"Profile with name '{name}' already exists")

        if timeout_seconds < 0:
            raise ValidationError("timeout_seconds must be non-negative")
        if concurrency_limit < 1:
            raise ValidationError("concurrency_limit must be at least 1")

        self._counter += 1
        now = datetime.now(timezone.utc)
        pid = f"profile-{self._counter:08d}"

        profile = {
            "id": pid,
            "name": name,
            "description": description,
            "is_builtin": False,
            "is_deleted": False,
            "timeout_seconds": timeout_seconds,
            "concurrency_limit": concurrency_limit,
            "evidence_collection": evidence_collection,
            "reporting_style": reporting_style,
            "notification_rules": notification_rules or {},
            "plugin_ids": plugin_ids or [],
            "policy_ids": policy_ids or [],
            "config": config or {},
            "created_at": now,
            "updated_at": now,
        }
        self._profiles[pid] = profile

        logger.info("profile.created", profile_id=pid, name=name)
        return dict(profile)

    async def get(self, profile_id: str) -> dict[str, Any]:
        """Get a profile by ID.

        Args:
            profile_id: Profile ID.

        Returns:
            Profile data.

        Raises:
            AssessmentNotFoundError: If profile does not exist.
        """
        profile = self._profiles.get(profile_id)
        if profile is None or profile["is_deleted"]:
            raise AssessmentNotFoundError(f"Profile '{profile_id}' not found")
        return dict(profile)

    async def list(
        self,
        include_builtin: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """List all profiles.

        Args:
            include_builtin: Include built-in profiles.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (profiles, total count).
        """
        profiles = [
            p for p in self._profiles.values()
            if not p["is_deleted"] and (include_builtin or not p["is_builtin"])
        ]
        total = len(profiles)
        page = profiles[offset:offset + limit]
        return ([dict(p) for p in page], total)

    async def update(
        self,
        profile_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Update a profile.

        Args:
            profile_id: Profile to update.
            **kwargs: Fields to update.

        Returns:
            Updated profile.

        Raises:
            AssessmentNotFoundError: If profile does not exist.
        """
        profile = self._profiles.get(profile_id)
        if profile is None or profile["is_deleted"]:
            raise AssessmentNotFoundError(f"Profile '{profile_id}' not found")

        updatable = {
            "name", "description", "timeout_seconds", "concurrency_limit",
            "evidence_collection", "reporting_style", "notification_rules",
            "plugin_ids", "policy_ids", "config",
        }
        for key, value in kwargs.items():
            if key in updatable:
                profile[key] = value
        profile["updated_at"] = datetime.now(timezone.utc)

        return dict(profile)

    async def delete(self, profile_id: str) -> None:
        """Soft-delete a profile.

        Args:
            profile_id: Profile to delete.

        Raises:
            AssessmentNotFoundError: If profile does not exist.
            ValidationError: If attempting to delete a built-in profile.
        """
        profile = self._profiles.get(profile_id)
        if profile is None or profile["is_deleted"]:
            raise AssessmentNotFoundError(f"Profile '{profile_id}' not found")

        if profile["is_builtin"]:
            raise ValidationError("Cannot delete built-in profile")

        profile["is_deleted"] = True
        profile["updated_at"] = datetime.now(timezone.utc)
        logger.info("profile.deleted", profile_id=profile_id)
