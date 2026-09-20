"""Dependency injection for SecureScan Pro X."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Cookie, Depends, HTTPException, status

from app.services.auth import AuthService, InMemoryAuthService, User, UserRole
from app.services.workspace import WorkspaceService, InMemoryWorkspaceService
from app.services.asset import AssetService, InMemoryAssetService
from app.services.audit import AuditService, InMemoryAuditService
from app.services.configuration import ConfigurationService, InMemoryConfigurationService
from app.services.plugin import InMemoryPluginManager, PluginManager
from app.services.assessment.orchestrator import AssessmentOrchestrator, InMemoryOrchestrator
from app.services.assessment.evidence import EvidenceService, InMemoryEvidenceService
from app.services.assessment.reports import ReportService, InMemoryReportService
from app.services.assessment.profiles import ProfileService, InMemoryProfileService
from app.services.assessment.policies import PolicyService, InMemoryPolicyService
from app.services.assessment.knowledge import KnowledgeService, InMemoryKnowledgeService

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
    _orchestrator = InMemoryOrchestrator(
        audit_service=_audit_service,
        evidence_service=InMemoryEvidenceService(),
        report_service=InMemoryReportService(),
    )
    _evidence_service = InMemoryEvidenceService()
    _report_service = InMemoryReportService()
    _profile_service = InMemoryProfileService()
    _policy_service = InMemoryPolicyService()
    _knowledge_service = InMemoryKnowledgeService()


def get_auth_service() -> AuthService:
    if _auth_service is None:
        init_services()
    assert _auth_service is not None
    return _auth_service


def get_workspace_service() -> WorkspaceService:
    if _workspace_service is None:
        init_services()
    assert _workspace_service is not None
    return _workspace_service


def get_asset_service() -> AssetService:
    if _asset_service is None:
        init_services()
    assert _asset_service is not None
    return _asset_service


def get_audit_service() -> AuditService:
    if _audit_service is None:
        init_services()
    assert _audit_service is not None
    return _audit_service


def get_plugin_manager() -> PluginManager:
    if _plugin_manager is None:
        init_services()
    assert _plugin_manager is not None
    return _plugin_manager


def get_orchestrator() -> AssessmentOrchestrator:
    if _orchestrator is None:
        init_services()
    assert _orchestrator is not None
    return _orchestrator


def get_evidence_service() -> EvidenceService:
    if _evidence_service is None:
        init_services()
    assert _evidence_service is not None
    return _evidence_service


def get_report_service() -> ReportService:
    if _report_service is None:
        init_services()
    assert _report_service is not None
    return _report_service


def get_profile_service() -> ProfileService:
    if _profile_service is None:
        init_services()
    assert _profile_service is not None
    return _profile_service


def get_policy_service() -> PolicyService:
    if _policy_service is None:
        init_services()
    assert _policy_service is not None
    return _policy_service


def get_knowledge_service() -> KnowledgeService:
    if _knowledge_service is None:
        init_services()
    assert _knowledge_service is not None
    return _knowledge_service


async def get_current_user(
    session_token: str | None = Cookie(None),
    auth: AuthService = Depends(get_auth_service),
) -> User | None:
    if not session_token:
        return None
    return await auth.validate_session(session_token)


async def get_current_user_optional(
    session_token: str | None = Cookie(None),
    auth: AuthService = Depends(get_auth_service),
) -> User | None:
    if not session_token:
        return None
    return await auth.validate_session(session_token)


async def require_auth(
    user: User | None = Depends(get_current_user),
) -> User:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return user


def require_role(minimum_role: UserRole):
    role_order = {UserRole.ADMIN: 3, UserRole.OPERATOR: 2, UserRole.VIEWER: 1}

    async def _check(user: User = Depends(require_auth)) -> User:
        user_level = role_order.get(user.role, 0)
        required_level = role_order.get(minimum_role, 0)
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
