"""API v1 — versioned API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1.assessments import router as assessments_router
from app.api.v1.assets import router as assets_router
from app.api.v1.reports import router as reports_router
from app.api.v1.scans import router as scans_router
from app.api.v1.workspaces import router as workspaces_router
from app.core.dependencies import require_auth

router = APIRouter()

# Assessment data (assets, findings, evidence, reports) is only reachable
# with a valid session; previously these routers were completely open.
_auth = [Depends(require_auth)]

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
router.include_router(scans_router, prefix="/scans", tags=["scans"])
router.include_router(
    reports_router,
    prefix="/reports",
    tags=["reports"],
    dependencies=_auth,
)
