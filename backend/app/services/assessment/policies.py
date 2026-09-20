"""Assessment policies — governance rules for assessment execution.

Policies enforce constraints on resource usage, runtime limits, retention,
export controls, approval workflows, and plugin permissions.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from app.core.exceptions import AssessmentNotFoundError, ValidationError
from app.core.logging import get_logger

logger = get_logger(__name__)


# ── Built-in Policies ──────────────────────────────────────────────

BUILTIN_POLICIES: list[dict[str, Any]] = [
    {
        "name": "Default Policy",
        "description": "Standard policy with reasonable defaults.",
        "max_runtime_seconds": 7200,
        "max_memory_mb": 1024,
        "max_cpu_percent": 80,
        "logging_level": "info",
        "retention_days": 90,
        "export_allowed": True,
        "approval_required": False,
        "evidence_storage": "local",
        "allowed_plugin_ids": [],
    },
    {
        "name": "Strict Policy",
        "description": "Restrictive policy for sensitive environments.",
        "max_runtime_seconds": 3600,
        "max_memory_mb": 512,
        "max_cpu_percent": 50,
        "logging_level": "debug",
        "retention_days": 365,
        "export_allowed": False,
        "approval_required": True,
        "evidence_storage": "encrypted_local",
        "allowed_plugin_ids": [],
    },
    {
        "name": "Demo Policy",
        "description": "Permissive policy for demo and testing.",
        "max_runtime_seconds": 300,
        "max_memory_mb": 256,
        "max_cpu_percent": 30,
        "logging_level": "debug",
        "retention_days": 7,
        "export_allowed": True,
        "approval_required": False,
        "evidence_storage": "local",
        "allowed_plugin_ids": [],
    },
]


# ── Policy Service Interface ──────────────────────────────────────


class PolicyService(ABC):
    """Interface for assessment policy management."""

    @abstractmethod
    async def create(
        self,
        name: str,
        description: str | None = None,
        max_runtime_seconds: int = 7200,
        max_memory_mb: int = 1024,
        max_cpu_percent: int = 80,
        logging_level: str = "info",
        retention_days: int = 90,
        export_allowed: bool = True,
        approval_required: bool = False,
        evidence_storage: str = "local",
        allowed_plugin_ids: list[str] | None = None,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new assessment policy.

        Args:
            name: Policy name (must be unique).
            description: Optional description.
            max_runtime_seconds: Maximum runtime.
            max_memory_mb: Maximum memory usage.
            max_cpu_percent: Maximum CPU usage.
            logging_level: Logging verbosity.
            retention_days: Data retention period.
            export_allowed: Whether export is permitted.
            approval_required: Whether approval is required.
            evidence_storage: Evidence storage backend.
            allowed_plugin_ids: Allowed plugin IDs (empty = all).
            config: Additional configuration.

        Returns:
            Created policy.

        Raises:
            ValidationError: If policy is invalid.
        """
        ...

    @abstractmethod
    async def get(self, policy_id: str) -> dict[str, Any]:
        """Get a policy by ID.

        Args:
            policy_id: Policy ID.

        Returns:
            Policy data.

        Raises:
            AssessmentNotFoundError: If policy does not exist.
        """
        ...

    @abstractmethod
    async def list(
        self,
        include_builtin: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """List all policies.

        Args:
            include_builtin: Include built-in policies.
            offset: Number to skip.
            limit: Maximum to return.

        Returns:
            Tuple of (policies, total count).
        """
        ...

    @abstractmethod
    async def update(
        self,
        policy_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Update a policy.

        Args:
            policy_id: Policy to update.
            **kwargs: Fields to update.

        Returns:
            Updated policy.
        """
        ...

    @abstractmethod
    async def delete(self, policy_id: str) -> None:
        """Delete a policy.

        Args:
            policy_id: Policy to delete.
        """
        ...

    @abstractmethod
    async def validate_assessment(
        self,
        policy_id: str,
        assessment_config: dict[str, Any],
    ) -> tuple[bool, list[str]]:
        """Validate an assessment against a policy.

        Args:
            policy_id: Policy to validate against.
            assessment_config: Assessment configuration to check.

        Returns:
            Tuple of (is_valid, list of violations).
        """
        ...


# ── In-Memory Implementation ──────────────────────────────────────


class InMemoryPolicyService(PolicyService):
    """In-memory policy service with built-in policies."""

    def __init__(self) -> None:
        """Initialize with built-in policies."""
        self._policies: dict[str, dict[str, Any]] = {}
        self._counter: int = 0

        for bp in BUILTIN_POLICIES:
            self._counter += 1
            pid = f"policy-{self._counter:08d}"
            self._policies[pid] = {
                "id": pid,
                "is_builtin": True,
                "is_deleted": False,
                "config": {},
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
                **bp,
            }

    async def create(
        self,
        name: str,
        description: str | None = None,
        max_runtime_seconds: int = 7200,
        max_memory_mb: int = 1024,
        max_cpu_percent: int = 80,
        logging_level: str = "info",
        retention_days: int = 90,
        export_allowed: bool = True,
        approval_required: bool = False,
        evidence_storage: str = "local",
        allowed_plugin_ids: list[str] | None = None,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new assessment policy.

        Args:
            name: Policy name.
            description: Optional description.
            max_runtime_seconds: Maximum runtime.
            max_memory_mb: Maximum memory.
            max_cpu_percent: Maximum CPU.
            logging_level: Logging level.
            retention_days: Retention period.
            export_allowed: Whether export is permitted.
            approval_required: Whether approval is required.
            evidence_storage: Storage backend.
            allowed_plugin_ids: Allowed plugins.
            config: Additional config.

        Returns:
            Created policy.

        Raises:
            ValidationError: If invalid.
        """
        for p in self._policies.values():
            if p["name"] == name and not p["is_deleted"]:
                raise ValidationError(f"Policy with name '{name}' already exists")

        if max_runtime_seconds < 0:
            raise ValidationError("max_runtime_seconds must be non-negative")
        if max_memory_mb < 0:
            raise ValidationError("max_memory_mb must be non-negative")
        if not (0 <= max_cpu_percent <= 100):
            raise ValidationError("max_cpu_percent must be 0-100")
        if retention_days < 0:
            raise ValidationError("retention_days must be non-negative")

        self._counter += 1
        now = datetime.now(timezone.utc)
        pid = f"policy-{self._counter:08d}"

        policy = {
            "id": pid,
            "name": name,
            "description": description,
            "is_builtin": False,
            "is_deleted": False,
            "max_runtime_seconds": max_runtime_seconds,
            "max_memory_mb": max_memory_mb,
            "max_cpu_percent": max_cpu_percent,
            "logging_level": logging_level,
            "retention_days": retention_days,
            "export_allowed": export_allowed,
            "approval_required": approval_required,
            "evidence_storage": evidence_storage,
            "allowed_plugin_ids": allowed_plugin_ids or [],
            "config": config or {},
            "created_at": now,
            "updated_at": now,
        }
        self._policies[pid] = policy

        logger.info("policy.created", policy_id=pid, name=name)
        return dict(policy)

    async def get(self, policy_id: str) -> dict[str, Any]:
        """Get a policy by ID.

        Args:
            policy_id: Policy ID.

        Returns:
            Policy data.

        Raises:
            AssessmentNotFoundError: If policy does not exist.
        """
        policy = self._policies.get(policy_id)
        if policy is None or policy["is_deleted"]:
            raise AssessmentNotFoundError(f"Policy '{policy_id}' not found")
        return dict(policy)

    async def list(
        self,
        include_builtin: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """List all policies.

        Args:
            include_builtin: Include built-in policies.
            offset: Skip count.
            limit: Max results.

        Returns:
            Tuple of (policies, total).
        """
        policies = [
            p for p in self._policies.values()
            if not p["is_deleted"] and (include_builtin or not p["is_builtin"])
        ]
        total = len(policies)
        page = policies[offset:offset + limit]
        return ([dict(p) for p in page], total)

    async def update(
        self,
        policy_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Update a policy.

        Args:
            policy_id: Policy to update.
            **kwargs: Fields to update.

        Returns:
            Updated policy.
        """
        policy = self._policies.get(policy_id)
        if policy is None or policy["is_deleted"]:
            raise AssessmentNotFoundError(f"Policy '{policy_id}' not found")

        updatable = {
            "name", "description", "max_runtime_seconds", "max_memory_mb",
            "max_cpu_percent", "logging_level", "retention_days",
            "export_allowed", "approval_required", "evidence_storage",
            "allowed_plugin_ids", "config",
        }
        for key, value in kwargs.items():
            if key in updatable:
                policy[key] = value
        policy["updated_at"] = datetime.now(timezone.utc)
        return dict(policy)

    async def delete(self, policy_id: str) -> None:
        """Soft-delete a policy.

        Args:
            policy_id: Policy to delete.

        Raises:
            AssessmentNotFoundError: If not found.
            ValidationError: If built-in.
        """
        policy = self._policies.get(policy_id)
        if policy is None or policy["is_deleted"]:
            raise AssessmentNotFoundError(f"Policy '{policy_id}' not found")
        if policy["is_builtin"]:
            raise ValidationError("Cannot delete built-in policy")
        policy["is_deleted"] = True
        policy["updated_at"] = datetime.now(timezone.utc)
        logger.info("policy.deleted", policy_id=policy_id)

    async def validate_assessment(
        self,
        policy_id: str,
        assessment_config: dict[str, Any],
    ) -> tuple[bool, list[str]]:
        """Validate an assessment config against a policy.

        Args:
            policy_id: Policy to check against.
            assessment_config: Assessment configuration.

        Returns:
            Tuple of (is_valid, list of violation descriptions).
        """
        policy = await self.get(policy_id)
        violations: list[str] = []

        # Check plugin permissions
        allowed_plugins = policy.get("allowed_plugin_ids", [])
        if allowed_plugins:
            requested_plugins = assessment_config.get("plugin_ids", [])
            for pid in requested_plugins:
                if pid not in allowed_plugins:
                    violations.append(f"Plugin '{pid}' is not permitted by policy")

        # Check export rules
        if not policy.get("export_allowed", True):
            if assessment_config.get("export_format"):
                violations.append("Export is not permitted by this policy")

        # Check approval requirements
        if policy.get("approval_required", False):
            if not assessment_config.get("approved", False):
                violations.append("Assessment requires approval per policy")

        return (len(violations) == 0, violations)
