"""API layer — FastAPI application and route definitions."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__, __app_name__
from app.core.config import settings
from app.core.logging import get_logger, setup_logging

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(level="debug" if settings.debug else "info")
    logger.info("application.starting", version=__version__)

    from app.core.dependencies import init_services
    init_services()

    try:
        from app.core.database import init_database
        await init_database()
    except Exception:
        logger.warning("database_not_available", note="Running in in-memory mode")

    logger.info("application.started", version=__version__)
    yield
    logger.info("application.shutting_down")
    try:
        from app.core.database import close_database
        await close_database()
    except Exception:
        pass
    logger.info("application.stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title=__app_name__,
        version=__version__,
        description="Enterprise-Grade Defensive Security Assessment Platform",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "tauri://localhost",
            "http://localhost:1420",
            "http://localhost:3000",
            "http://localhost:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.utils.security_headers import SecurityHeadersMiddleware
    app.add_middleware(SecurityHeadersMiddleware)

    from app.utils.rate_limit import RateLimitMiddleware
    app.add_middleware(RateLimitMiddleware, requests_per_minute=100, burst_size=20)

    from app.utils.sanitization import InputSanitizationMiddleware
    app.add_middleware(InputSanitizationMiddleware)

    from app.utils.audit_middleware import AuditMiddleware
    app.add_middleware(AuditMiddleware)

    from app.api.v1 import router as v1_router
    app.include_router(v1_router, prefix="/api/v1")

    from app.api.v1.auth import router as auth_router
    app.include_router(auth_router, prefix="/api/v1")

    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        return {
            "status": "healthy",
            "version": __version__,
            "application": __app_name__,
        }

    @app.get("/", tags=["root"])
    async def root() -> dict:
        return {
            "name": __app_name__,
            "version": __version__,
            "docs": "/docs",
            "health": "/health",
        }

    return app


app = create_app()
