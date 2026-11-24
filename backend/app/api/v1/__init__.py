"""API v1 — versioned API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1.access import require_operator_for_writes, require_resource_owner
from app.api.v1.assessments import router as assessments_router
from app.api.v1.assets import router as assets_router
from app.api.v1.reports import router as reports_router
from app.api.v1.scans import router as scans_router
from app.api.v1.workspaces import router as workspaces_router
from app.core.dependencies import require_auth, require_operator

router = APIRouter()

# Data routers require a session, ownership of referenced resources, and an
# operator role for state-changing requests. Previously any logged-in viewer
# could modify or delete another account's data.
_auth = [
    Depends(require_auth),
    Depends(require_resource_owner),
    Depends(require_operator_for_writes),
]

router.include_router(
    workspaces_router,
    prefix="/workspaces",
    tags=["workspaces"],
    dependencies=_auth,
)
router.include_router(assets_router, prefix="/assets", tags=["assets"], dependencies=_auth)
router.include_router(
    assessments_router,
    prefix="/assessments",
    tags=["assessments"],
    dependencies=_auth,
)
router.include_router(
    scans_router,
    prefix="/scans",
    tags=["scans"],
    dependencies=[Depends(require_operator)],
)
router.include_router(
    reports_router,
    prefix="/reports",
    tags=["reports"],
    dependencies=_auth,
)
