"""API layer — FastAPI application and route definitions."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__, __app_name__
from app.core.config import settings
from app.core.database import init_database, close_database
from app.core.logging import get_logger, setup_logging

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan — startup and shutdown events.

    Args:
        app: The FastAPI application instance.
    """
    # Startup
    setup_logging(level="debug" if settings.debug else "info")
    logger.info("application.starting", version=__version__)
    await init_database()
    logger.info("application.started", version=__version__)

    yield

    # Shutdown
    logger.info("application.shutting_down")
    await close_database()
    logger.info("application.stopped")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Configured FastAPI instance.
    """
    app = FastAPI(
        title=__app_name__,
        version=__version__,
        description="Enterprise-Grade Defensive Security Assessment Platform",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # CORS — allow Tauri webview origin
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["tauri://localhost", "http://localhost:1420"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routers
    from app.api.v1 import router as v1_router
    app.include_router(v1_router, prefix="/api/v1")

    # Health endpoint
    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        """Basic health check endpoint."""
        return {
            "status": "healthy",
            "version": __version__,
            "application": __app_name__,
        }

    return app


# Default app instance for uvicorn
app = create_app()
