"""API v1 — versioned API routes."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

from app.api.v1.workspaces import router as workspaces_router
from app.api.v1.assets import router as assets_router
from app.api.v1.assessments import router as assessments_router
from app.api.v1.scans import router as scans_router
from app.api.v1.reports import router as reports_router

router.include_router(workspaces_router, prefix="/workspaces", tags=["workspaces"])
router.include_router(assets_router, prefix="/assets", tags=["assets"])
router.include_router(assessments_router, prefix="/assessments", tags=["assessments"])
router.include_router(scans_router, prefix="/scans", tags=["scans"])
router.include_router(reports_router, prefix="/reports", tags=["reports"])
