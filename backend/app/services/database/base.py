"""Base database repository with generic CRUD operations.

Provides a reusable generic repository pattern over async SQLAlchemy,
with pagination, filtering, and transaction management.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Generic, Sequence, Type, TypeVar

from sqlalchemy import Select, func, select, delete as sa_delete
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase, InstrumentedAttribute

from app.core.exceptions import DatabaseError
from app.core.logging import get_logger

logger = get_logger(__name__)

ModelType = TypeVar("ModelType", bound=DeclarativeBase)


@dataclass
class PaginationParams:
    """Pagination request parameters."""

    page: int = 1
    page_size: int = 50

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


@dataclass
class PaginatedResult(Generic[ModelType]):
    """Paginated query result."""

    items: list[ModelType]
    total: int
    page: int
    page_size: int
    pages: int


@dataclass
class FilterSpec:
    """A single column-level filter condition."""

    column: str
    op: str  # eq, ne, like, in, gt, gte, lt, lte, is_null
    value: Any = None


@dataclass
class QueryFilters:
    """Container for multiple filter specs and sort order."""

    filters: list[FilterSpec] = field(default_factory=list)
    order_by: str | None = None
    order_desc: bool = False


class BaseRepository(Generic[ModelType]):
    """Generic async repository providing CRUD operations.

    Subclass this with your SQLAlchemy model to get automatic
    create / get / list / update / delete with pagination and filtering.
    """

    def __init__(self, model: Type[ModelType], session: AsyncSession) -> None:
        self.model = model
        self.session = session

    # ── Create ──────────────────────────────────────────────────────

    async def create(self, **kwargs: Any) -> ModelType:
        """Create a new row and flush to the session.

        Args:
            **kwargs: Column values for the new row.

        Returns:
            The newly created model instance.

        Raises:
            DatabaseError: On integrity or unexpected DB errors.
        """
        instance = self.model(**kwargs)
        self.session.add(instance)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            await self.session.rollback()
            logger.warning(
                "create.integrity_error",
                model=self.model.__tablename__,
                error=str(exc),
            )
            raise DatabaseError(
                f"Integrity error creating {self.model.__tablename__}: {exc}"
            ) from exc
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error(
                "create.error",
                model=self.model.__tablename__,
                error=str(exc),
            )
            raise DatabaseError(
                f"Database error creating {self.model.__tablename__}: {exc}"
            ) from exc

        logger.info(
            "repo.created",
            model=self.model.__tablename__,
            id=instance.id,
        )
        return instance

    # ── Read ────────────────────────────────────────────────────────

    async def get(self, id: str) -> ModelType | None:
        """Fetch a single row by primary key.

        Args:
            id: Primary key value.

        Returns:
            The model instance or None.
        """
        stmt = select(self.model).where(self.model.id == id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_or_raise(self, id: str, exc_cls: type[DatabaseError] | None = None) -> ModelType:
        """Fetch by PK or raise a DatabaseError.

        Args:
            id: Primary key value.
            exc_cls: Custom exception class to raise. Defaults to DatabaseError.

        Returns:
            The model instance.

        Raises:
            The provided exc_cls or DatabaseError if not found.
        """
        instance = await self.get(id)
        if instance is None:
            error_cls = exc_cls or DatabaseError
            raise error_cls(
                f"{self.model.__tablename__} '{id}' not found"
            )
        return instance

    async def get_multi(
        self,
        ids: Sequence[str],
    ) -> list[ModelType]:
        """Fetch multiple rows by primary key list.

        Args:
            ids: Sequence of primary key values.

        Returns:
            List of matching model instances.
        """
        if not ids:
            return []
        stmt = select(self.model).where(self.model.id.in_(ids))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list(
        self,
        filters: QueryFilters | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[ModelType]:
        """List rows with optional filtering, sorting and pagination.

        Args:
            filters: Filter and sort specification.
            pagination: Page / page_size.

        Returns:
            A PaginatedResult containing items, total count, and page info.
        """
        filters = filters or QueryFilters()
        pagination = pagination or PaginationParams()

        base = self._apply_filters(select(self.model), filters)
        count_stmt = select(func.count()).select_from(base.subquery())
        total: int = (await self.session.execute(count_stmt)).scalar_one() or 0

        base = self._apply_ordering(base, filters)
        base = base.offset(pagination.offset).limit(pagination.limit)

        result = await self.session.execute(base)
        items = list(result.scalars().all())

        pages = math.ceil(total / pagination.page_size) if pagination.page_size else 0

        return PaginatedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
            pages=pages,
        )

    async def count(self, filters: QueryFilters | None = None) -> int:
        """Count rows matching optional filters.

        Args:
            filters: Optional filter specification.

        Returns:
            Row count.
        """
        filters = filters or QueryFilters()
        base = self._apply_filters(select(self.model), filters)
        stmt = select(func.count()).select_from(base.subquery())
        result = await self.session.execute(stmt)
        return result.scalar_one() or 0

    async def exists(self, id: str) -> bool:
        """Check whether a row with the given PK exists.

        Args:
            id: Primary key value.

        Returns:
            True if row exists.
        """
        stmt = select(func.count()).where(self.model.id == id)
        result = await self.session.execute(stmt)
        return (result.scalar_one() or 0) > 0

    # ── Update ──────────────────────────────────────────────────────

    async def update(self, id: str, **kwargs: Any) -> ModelType:
        """Update a row by PK with the supplied values.

        Only keys present in kwargs are updated (partial update).

        Args:
            id: Primary key value.
            **kwargs: Columns to update.

        Returns:
            The updated model instance.

        Raises:
            DatabaseError: If not found or on DB errors.
        """
        instance = await self.get_or_raise(id)
        for key, value in kwargs.items():
            if hasattr(instance, key):
                setattr(instance, key, value)

        try:
            await self.session.flush()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DatabaseError(
                f"Integrity error updating {self.model.__tablename__}: {exc}"
            ) from exc
        except SQLAlchemyError as exc:
            await self.session.rollback()
            raise DatabaseError(
                f"Database error updating {self.model.__tablename__}: {exc}"
            ) from exc

        logger.info(
            "repo.updated",
            model=self.model.__tablename__,
            id=id,
            fields=list(kwargs.keys()),
        )
        return instance

    # ── Delete ──────────────────────────────────────────────────────

    async def delete(self, id: str) -> None:
        """Delete a row by PK.

        Args:
            id: Primary key value.

        Raises:
            DatabaseError: If not found or on DB errors.
        """
        instance = await self.get_or_raise(id)
        try:
            await self.session.delete(instance)
            await self.session.flush()
        except SQLAlchemyError as exc:
            await self.session.rollback()
            raise DatabaseError(
                f"Database error deleting {self.model.__tablename__}: {exc}"
            ) from exc

        logger.info(
            "repo.deleted",
            model=self.model.__tablename__,
            id=id,
        )

    async def delete_multi(self, ids: Sequence[str]) -> int:
        """Delete multiple rows by PK list.

        Args:
            ids: Primary key values to delete.

        Returns:
            Number of rows deleted.
        """
        if not ids:
            return 0
        stmt = sa_delete(self.model).where(self.model.id.in_(ids))
        result = await self.session.execute(stmt)
        count = result.rowcount
        await self.session.flush()

        logger.info(
            "repo.deleted_multi",
            model=self.model.__tablename__,
            count=count,
        )
        return count

    # ── Filter / ordering helpers ───────────────────────────────────

    def _apply_filters(
        self,
        stmt: Select,
        filters: QueryFilters,
    ) -> Select:
        """Apply FilterSpec list to a SELECT statement."""
        for spec in filters.filters:
            column = self._get_column(spec.column)
            stmt = self._apply_single_filter(stmt, column, spec)
        return stmt

    def _apply_single_filter(
        self,
        stmt: Select,
        column: InstrumentedAttribute,
        spec: FilterSpec,
    ) -> Select:
        op = spec.op
        if op == "eq":
            return stmt.where(column == spec.value)
        if op == "ne":
            return stmt.where(column != spec.value)
        if op == "like":
            return stmt.where(column.ilike(f"%{spec.value}%"))
        if op == "in":
            return stmt.where(column.in_(spec.value))
        if op == "gt":
            return stmt.where(column > spec.value)
        if op == "gte":
            return stmt.where(column >= spec.value)
        if op == "lt":
            return stmt.where(column < spec.value)
        if op == "lte":
            return stmt.where(column <= spec.value)
        if op == "is_null":
            return stmt.where(column.is_(None))
        if op == "is_not_null":
            return stmt.where(column.isnot(None))
        logger.warning("repo.unknown_filter_op", op=op, column=spec.column)
        return stmt

    def _apply_ordering(
        self,
        stmt: Select,
        filters: QueryFilters,
    ) -> Select:
        if filters.order_by is None:
            return stmt
        column = self._get_column(filters.order_by)
        if filters.order_desc:
            return stmt.order_by(column.desc())
        return stmt.order_by(column.asc())

    def _get_column(self, name: str) -> InstrumentedAttribute:
        """Resolve a column name to the SQLAlchemy instrumented attribute."""
        column = getattr(self.model, name, None)
        if column is None:
            raise DatabaseError(
                f"Column '{name}' does not exist on {self.model.__tablename__}"
            )
        return column

    # ── Transaction helpers ─────────────────────────────────────────

    async def flush(self) -> None:
        """Flush pending changes without committing."""
        await self.session.flush()

    async def refresh(self, instance: ModelType) -> ModelType:
        """Refresh an instance from the database."""
        await self.session.refresh(instance)
        return instance
