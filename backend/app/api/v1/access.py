"""Request-level authorization helpers for the versioned API.

Authentication only proves who a caller is; these helpers also enforce what
that caller may touch. Resources carry an ``owner_id`` set at creation time.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import Depends, HTTPException, Request, status

from app.core.dependencies import require_auth
from app.services.auth import ROLE_HIERARCHY, User, UserRole

if TYPE_CHECKING:
    from collections.abc import Callable


def ensure_owner(resource: dict[str, Any], user: User, label: str) -> None:
    """Reject access to a resource owned by another account.

    Administrators may operate across tenants. Missing owner metadata is
    treated as a system-owned resource and is not readable by ordinary users.
    """
    if user.role == UserRole.ADMIN:
        return
    owner = resource.get("owner_id", "system")
    if owner != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You are not allowed to access this {label}",
        )


async def require_resource_owner(
    request: Request,
    user: User = Depends(require_auth),
) -> User:
    """Check ownership of any resource identified by path or query parameters."""
    if user.role == UserRole.ADMIN:
        return user

    # Imported lazily to keep shared state as the single source of truth.
    from app.api.v1.state import asset_service, orchestrator, workspace_service

    workspace_id = request.path_params.get("workspace_id") or request.query_params.get(
        "workspace_id"
    )
    if workspace_id:
        workspace = workspace_service._workspaces.get(workspace_id)
        if workspace is None:
            raise HTTPException(status_code=404, detail="Workspace not found")
        ensure_owner(workspace, user, "workspace")

    asset_id = request.path_params.get("asset_id")
    if asset_id:
        asset = asset_service._assets.get(asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        ensure_owner(asset, user, "asset")

    assessment_id = request.path_params.get("assessment_id") or request.query_params.get(
        "assessment_id"
    )
    if assessment_id:
        assessment = orchestrator._assessments.get(assessment_id)
        if assessment is None:
            raise HTTPException(status_code=404, detail="Assessment not found")
        ensure_owner(assessment, user, "assessment")

    return user


async def require_operator_for_writes(
    request: Request,
    user: User = Depends(require_auth),
) -> User:
    """Require operator role for state-changing requests from viewers."""
    if (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and ROLE_HIERARCHY.get(user.role, 0) < ROLE_HIERARCHY[UserRole.OPERATOR]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operator role or higher required",
        )
    return user


def visible_assessments(user: User) -> list[dict[str, Any]]:
    """Return assessments the caller is allowed to see."""
    from app.api.v1.state import orchestrator

    return [
        assessment
        for assessment in orchestrator._assessments.values()
        if user.role == UserRole.ADMIN or assessment.get("owner_id", "system") == user.id
    ]


def require_owned_report(report_id: str, user: User) -> Any:
    """Locate a report and enforce ownership of its assessment."""
    from app.api.v1.state import orchestrator, report_service

    metadata = report_service.get_report(report_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="Report not found")
    assessment = orchestrator._assessments.get(metadata.assessment_id, {})
    ensure_owner({"owner_id": assessment.get("owner_id", "system")}, user, "report")
    return metadata


def writable_scope(user: User) -> Callable[[dict[str, Any]], bool]:
    """Return a predicate for filtering records visible to ``user``."""
    if user.role == UserRole.ADMIN:
        return lambda _record: True
    return lambda record: record.get("owner_id", "system") == user.id
