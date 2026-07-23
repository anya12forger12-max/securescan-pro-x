"""Database engine and session management.

Provides async SQLAlchemy engine and session factory.
"""

from __future__ import annotations

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""

    pass


def create_engine() -> AsyncEngine:
    """Create the async database engine.

    Returns:
        Configured AsyncEngine instance.
    """
    db_path = settings.database.path
    database_url = f"sqlite+aiosqlite:///{db_path}"

    return create_async_engine(
        database_url,
        echo=settings.debug,
        future=True,
    )


# Module-level engine and session factory
engine = create_engine()

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get an async database session.

    Yields:
        AsyncSession instance, automatically closed after use.
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_database() -> None:
    """Initialize the database — create all tables.

    Called once at application startup.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_database() -> None:
    """Close the database engine.

    Called once at application shutdown.
    """
    await engine.dispose()
