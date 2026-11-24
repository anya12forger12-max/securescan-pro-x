"""Dependency injection for SecureScan Pro X."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Cookie, Depends, HTTPException, Request, status

from app.services.assessment.evidence import EvidenceService, InMemoryEvidenceService
from app.services.assessment.knowledge import InMemoryKnowledgeService, KnowledgeService
from app.services.assessment.orchestrator import AssessmentOrchestrator, InMemoryOrchestrator
from app.services.assessment.policies import InMemoryPolicyService, PolicyService
from app.services.assessment.profiles import InMemoryProfileService, ProfileService
from app.services.assessment.reports import InMemoryReportService, ReportService
from app.services.asset import AssetService, InMemoryAssetService
from app.services.audit import AuditService, InMemoryAuditService
from app.services.auth import ROLE_HIERARCHY, AuthService, InMemoryAuthService, User, UserRole
from app.services.configuration import ConfigurationService, InMemoryConfigurationService
from app.services.plugin import InMemoryPluginManager, PluginManager
from app.services.workspace import InMemoryWorkspaceService, WorkspaceService

_auth_service: AuthService | None = None
_workspace_service: WorkspaceService | None = None
_asset_service: AssetService | None = None
_audit_service: AuditService | None = None
_config_service: ConfigurationService | None = None
_plugin_manager: PluginManager | None = None
_orchestrator: AssessmentOrchestrator | None = None
_evidence_service: EvidenceService | None = None
_report_service: ReportService | None = None
_profile_service: ProfileService | None = None
_policy_service: PolicyService | None = None
_knowledge_service: KnowledgeService | None = None


def init_services() -> None:
    global _auth_service, _workspace_service, _asset_service, _audit_service
    global _config_service, _plugin_manager, _orchestrator, _evidence_service
    global _report_service, _profile_service, _policy_service, _knowledge_service

    _audit_service = InMemoryAuditService()
    _auth_service = InMemoryAuthService(
        session_timeout_minutes=30,
        max_login_attempts=5,
        lockout_duration_minutes=15,
        password_min_length=12,
    )
    _workspace_service = InMemoryWorkspaceService()
    _asset_service = InMemoryAssetService()
    _config_service = InMemoryConfigurationService()
    _plugin_manager = InMemoryPluginManager()
    _orchestrator = InMemoryOrchestrator()
    _evidence_service = InMemoryEvidenceService()
    _report_service = InMemoryReportService()
    _profile_service = InMemoryProfileService()
    _policy_service = InMemoryPolicyService()
    _knowledge_service = InMemoryKnowledgeService()


def get_auth_service() -> AuthService:
    if _auth_service is None:
        init_services()
    if _auth_service is None:
        raise RuntimeError("Service not initialized")
    return _auth_service


def get_workspace_service() -> WorkspaceService:
    if _workspace_service is None:
        init_services()
    if _workspace_service is None:
        raise RuntimeError("Service not initialized")
    return _workspace_service


def get_asset_service() -> AssetService:
    if _asset_service is None:
        init_services()
    if _asset_service is None:
        raise RuntimeError("Service not initialized")
    return _asset_service


def get_audit_service() -> AuditService:
    if _audit_service is None:
        init_services()
    if _audit_service is None:
        raise RuntimeError("Service not initialized")
    return _audit_service


def get_plugin_manager() -> PluginManager:
    if _plugin_manager is None:
        init_services()
    if _plugin_manager is None:
        raise RuntimeError("Service not initialized")
    return _plugin_manager


def get_orchestrator() -> AssessmentOrchestrator:
    if _orchestrator is None:
        init_services()
    if _orchestrator is None:
        raise RuntimeError("Service not initialized")
    return _orchestrator


def get_evidence_service() -> EvidenceService:
    if _evidence_service is None:
        init_services()
    if _evidence_service is None:
        raise RuntimeError("Service not initialized")
    return _evidence_service


def get_report_service() -> ReportService:
    if _report_service is None:
        init_services()
    if _report_service is None:
        raise RuntimeError("Service not initialized")
    return _report_service


def get_profile_service() -> ProfileService:
    if _profile_service is None:
        init_services()
    if _profile_service is None:
        raise RuntimeError("Service not initialized")
    return _profile_service


def get_policy_service() -> PolicyService:
    if _policy_service is None:
        init_services()
    if _policy_service is None:
        raise RuntimeError("Service not initialized")
    return _policy_service


def get_knowledge_service() -> KnowledgeService:
    if _knowledge_service is None:
        init_services()
    if _knowledge_service is None:
        raise RuntimeError("Service not initialized")
    return _knowledge_service


async def get_current_user(
    session_token: str | None = Cookie(None),
    auth: AuthService = Depends(get_auth_service),
) -> User | None:
    if not session_token:
        return None
    return await auth.validate_session(session_token)


async def require_auth(
    request: Request,
    user: User | None = Depends(get_current_user),
) -> User:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    # Make the authenticated principal available to middleware so audit
    # records can attribute a request to an account, not just an IP.
    request.state.user = user
    return user


def require_role(minimum_role: UserRole) -> Callable[..., Any]:
    async def _check(user: User = Depends(require_auth)) -> User:
        user_level = ROLE_HIERARCHY.get(user.role, 0)
        required_level = ROLE_HIERARCHY.get(minimum_role, 0)
        if user_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{minimum_role.value}' or higher required",
            )
        return user

    return _check


async def require_admin(user: User = Depends(require_role(UserRole.ADMIN))) -> User:
    return user


async def require_operator(user: User = Depends(require_role(UserRole.OPERATOR))) -> User:
    return user
