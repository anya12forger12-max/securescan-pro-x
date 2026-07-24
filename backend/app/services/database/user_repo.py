"""User repository — database-backed user persistence.

Stores user credentials, roles, MFA state, and lockout information.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DatabaseError
from app.core.logging import get_logger
from app.services.auth import UserRole
from app.services.database.base import (
    BaseRepository,
    FilterSpec,
    PaginatedResult,
    PaginationParams,
    QueryFilters,
)

logger = get_logger(__name__)


class UserMixin:
    """Mixin columns for the User model — mixed into a declarative class at runtime."""

    pass


# We define a lightweight SQLAlchemy model for users that lives
# alongside the existing in-memory auth dataclass. This allows
# the database layer to persist users while the auth service
# continues to work with its own dataclass for business logic.

from sqlalchemy import Boolean, String, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models import UUIDMixin, TimestampMixin


class UserModel(Base, UUIDMixin, TimestampMixin):
    """SQLAlchemy model for application users."""

    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(
        String(20), default=UserRole.VIEWER.value, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(256), nullable=True)
    last_login_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[str | None] = mapped_column(String(64), nullable=True)


class UserRepository(BaseRepository[UserModel]):
    """Repository for user persistence and queries."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(UserModel, session)

    async def create_user(
        self,
        username: str,
        email: str,
        password_hash: str,
        role: str = UserRole.VIEWER.value,
        display_name: str | None = None,
    ) -> UserModel:
        """Create a new user.

        Args:
            username: Unique username.
            email: Unique email address.
            password_hash: Bcrypt (or similar) hash of the password.
            role: User role string.
            display_name: Optional display name.

        Returns:
            The created UserModel.

        Raises:
            DatabaseError: If username or email already exists.
        """
        return await self.create(
            username=username,
            email=email,
            password_hash=password_hash,
            role=role,
            display_name=display_name or username,
            is_active=True,
            mfa_enabled=False,
            failed_login_attempts=0,
        )

    async def get_user(self, user_id: str) -> UserModel | None:
        """Fetch a user by ID.

        Returns:
            UserModel or None.
        """
        return await self.get(user_id)

    async def get_by_username(self, username: str) -> UserModel | None:
        """Look up a user by username.

        Returns:
            UserModel or None.
        """
        stmt = select(self.model).where(self.model.username == username)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> UserModel | None:
        """Look up a user by email.

        Returns:
            UserModel or None.
        """
        stmt = select(self.model).where(self.model.email == email)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_users(
        self,
        active_only: bool = False,
        role: str | None = None,
        pagination: PaginationParams | None = None,
    ) -> PaginatedResult[UserModel]:
        """List users with optional filters.

        Args:
            active_only: Only return active users.
            role: Optional role filter.
            pagination: Page parameters.

        Returns:
            PaginatedResult of UserModels.
        """
        filters = QueryFilters(
            order_by="created_at",
            order_desc=True,
        )
        if active_only:
            filters.filters.append(
                FilterSpec(column="is_active", op="eq", value=True)
            )
        if role:
            filters.filters.append(
                FilterSpec(column="role", op="eq", value=role)
            )
        return await self.list(filters=filters, pagination=pagination)

    async def update_user(
        self,
        user_id: str,
        **kwargs: Any,
    ) -> UserModel:
        """Update user fields.

        Raises:
            DatabaseError: If user not found.
        """
        user = await self.get(user_id)
        if user is None:
            raise DatabaseError(f"User '{user_id}' not found")
        return await self.update(user_id, **kwargs)

    async def update_password_hash(
        self,
        user_id: str,
        new_hash: str,
    ) -> UserModel:
        """Update a user's password hash."""
        return await self.update_user(user_id, password_hash=new_hash)

    async def update_role(
        self,
        user_id: str,
        new_role: str,
    ) -> UserModel:
        """Change a user's role."""
        return await self.update_user(user_id, role=new_role)

    async def record_login(
        self,
        user_id: str,
        ip_address: str | None = None,
    ) -> UserModel:
        """Record a successful login — resets failed attempts and sets last_login_at."""
        now = datetime.now(timezone.utc).isoformat()
        return await self.update_user(
            user_id,
            last_login_at=now,
            failed_login_attempts=0,
            locked_until=None,
        )

    async def increment_failed_login(self, user_id: str) -> UserModel:
        """Increment failed login attempt counter.

        Does NOT handle lockout logic — that lives in the auth service.
        """
        user = await self.get(user_id)
        if user is None:
            raise DatabaseError(f"User '{user_id}' not found")
        return await self.update(
            user_id,
            failed_login_attempts=user.failed_login_attempts + 1,
        )

    async def lock_user(self, user_id: str, until: str) -> UserModel:
        """Set the lockout timestamp for a user."""
        return await self.update_user(user_id, locked_until=until)

    async def unlock_user(self, user_id: str) -> UserModel:
        """Clear lockout state for a user."""
        return await self.update_user(
            user_id,
            locked_until=None,
            failed_login_attempts=0,
        )

    async def deactivate(self, user_id: str) -> UserModel:
        """Deactivate a user account."""
        return await self.update_user(user_id, is_active=False)

    async def activate(self, user_id: str) -> UserModel:
        """Re-activate a user account."""
        return await self.update_user(user_id, is_active=True)

    async def enable_mfa(self, user_id: str, secret: str) -> UserModel:
        """Enable MFA for a user."""
        return await self.update_user(user_id, mfa_enabled=True, mfa_secret=secret)

    async def disable_mfa(self, user_id: str) -> UserModel:
        """Disable MFA for a user."""
        return await self.update_user(
            user_id, mfa_enabled=False, mfa_secret=None
        )

    async def delete_user(self, user_id: str) -> None:
        """Permanently delete a user."""
        user = await self.get(user_id)
        if user is None:
            raise DatabaseError(f"User '{user_id}' not found")
        await self.delete(user_id)

    async def username_exists(self, username: str, exclude_id: str | None = None) -> bool:
        """Check if a username is already taken."""
        stmt = select(self.model.id).where(self.model.username == username)
        if exclude_id:
            stmt = stmt.where(self.model.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def email_exists(self, email: str, exclude_id: str | None = None) -> bool:
        """Check if an email is already registered."""
        stmt = select(self.model.id).where(self.model.email == email)
        if exclude_id:
            stmt = stmt.where(self.model.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
