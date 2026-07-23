"""API v1 — versioned API routes."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

# Import and include sub-routers
from app.api.v1.workspaces import router as workspaces_router
from app.api.v1.assets import router as assets_router
from app.api.v1.assessments import router as assessments_router

router.include_router(workspaces_router, prefix="/workspaces", tags=["workspaces"])
router.include_router(assets_router, prefix="/assets", tags=["assets"])
router.include_router(assessments_router, prefix="/assessments", tags=["assessments"])
