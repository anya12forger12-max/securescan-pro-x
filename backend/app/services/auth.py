"""Authentication service for SecureScan Pro X."""

from __future__ import annotations

import secrets
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from passlib.context import CryptContext

from app.core.logging import get_logger

logger = get_logger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


class UserRole(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


ROLE_HIERARCHY: dict[UserRole, int] = {
    UserRole.ADMIN: 3,
    UserRole.OPERATOR: 2,
    UserRole.VIEWER: 1,
}


@dataclass
class User:
    id: str
    username: str
    email: str
    password_hash: str
    display_name: str | None = None
    role: UserRole = UserRole.VIEWER
    is_active: bool = True
    mfa_enabled: bool = False
    mfa_secret: str | None = None
    last_login_at: str | None = None
    failed_login_attempts: int = 0
    locked_until: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class Session:
    id: str
    user_id: str
    token_hash: str
    ip_address: str | None = None
    user_agent: str | None = None
    expires_at: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_activity_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class AuthResult:
    success: bool
    user: User | None = None
    session: Session | None = None
    error: str | None = None
    requires_mfa: bool = False
    locked: bool = False


class AuthService(ABC):
    @abstractmethod
    async def register(
        self, username: str, email: str, password: str, role: UserRole = UserRole.VIEWER
    ) -> AuthResult: ...

    @abstractmethod
    async def login(
        self, username: str, password: str, ip_address: str | None = None, user_agent: str | None = None
    ) -> AuthResult: ...

    @abstractmethod
    async def logout(self, session_token: str) -> bool: ...

    @abstractmethod
    async def validate_session(self, session_token: str) -> User | None: ...

    @abstractmethod
    async def refresh_session(self, session_token: str) -> Session | None: ...

    @abstractmethod
    async def change_password(self, user_id: str, old_password: str, new_password: str) -> bool: ...

    @abstractmethod
    async def get_user(self, user_id: str) -> User | None: ...

    @abstractmethod
    async def list_users(self) -> list[User]: ...

    @abstractmethod
    async def update_user_role(self, user_id: str, new_role: UserRole) -> bool: ...

    @abstractmethod
    async def deactivate_user(self, user_id: str) -> bool: ...

    @abstractmethod
    async def revoke_all_sessions(self, user_id: str) -> int: ...


class InMemoryAuthService(AuthService):
    def __init__(
        self,
        session_timeout_minutes: int = 30,
        max_login_attempts: int = 5,
        lockout_duration_minutes: int = 15,
        password_min_length: int = 12,
    ) -> None:
        self._users: dict[str, User] = {}
        self._users_by_username: dict[str, str] = {}
        self._users_by_email: dict[str, str] = {}
        self._sessions: dict[str, Session] = {}
        self._sessions_by_user: dict[str, list[str]] = {}
        self._session_timeout = session_timeout_minutes
        self._max_login_attempts = max_login_attempts
        self._lockout_duration = lockout_duration_minutes
        self._password_min_length = password_min_length
        self._token_store: dict[str, str] = {}

    def _hash_token(self, token: str) -> str:
        import hashlib
        return hashlib.sha256(token.encode()).hexdigest()

    def _validate_password_strength(self, password: str) -> str | None:
        if len(password) < self._password_min_length:
            return f"Password must be at least {self._password_min_length} characters"
        if not any(c.isupper() for c in password):
            return "Password must contain at least one uppercase letter"
        if not any(c.islower() for c in password):
            return "Password must contain at least one lowercase letter"
        if not any(c.isdigit() for c in password):
            return "Password must contain at least one digit"
        if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in password):
            return "Password must contain at least one special character"
        return None

    def _is_locked(self, user: User) -> bool:
        if user.locked_until:
            try:
                lock_time = datetime.fromisoformat(user.locked_until)
                if datetime.now(timezone.utc) < lock_time:
                    return True
                user.locked_until = None
                user.failed_login_attempts = 0
            except ValueError:
                user.locked_until = None
        return False

    async def register(
        self, username: str, email: str, password: str, role: UserRole = UserRole.VIEWER
    ) -> AuthResult:
        if username in self._users_by_username:
            return AuthResult(success=False, error="Username already exists")
        if email in self._users_by_email:
            return AuthResult(success=False, error="Email already exists")

        strength_error = self._validate_password_strength(password)
        if strength_error:
            return AuthResult(success=False, error=strength_error)

        user_id = secrets.token_hex(16)
        password_hash = pwd_context.hash(password)
        now = datetime.now(timezone.utc).isoformat()

        user = User(
            id=user_id,
            username=username,
            email=email,
            password_hash=password_hash,
            display_name=username,
            role=role,
            created_at=now,
            updated_at=now,
        )

        self._users[user_id] = user
        self._users_by_username[username] = user_id
        self._users_by_email[email] = user_id

        logger.info("user_registered", user_id=user_id, username=username, role=role.value)
        return AuthResult(success=True, user=user)

    async def login(
        self, username: str, password: str, ip_address: str | None = None, user_agent: str | None = None
    ) -> AuthResult:
        user_id = self._users_by_username.get(username)
        if not user_id:
            return AuthResult(success=False, error="Invalid credentials")

        user = self._users[user_id]

        if not user.is_active:
            return AuthResult(success=False, error="Account is deactivated")

        if self._is_locked(user):
            return AuthResult(success=False, error="Account is locked", locked=True)

        if not pwd_context.verify(password, user.password_hash):
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= self._max_login_attempts:
                user.locked_until = (
                    datetime.now(timezone.utc) + timedelta(minutes=self._lockout_duration)
                ).isoformat()
                logger.warning(
                    "account_locked",
                    user_id=user_id,
                    attempts=user.failed_login_attempts,
                )
            return AuthResult(success=False, error="Invalid credentials")

        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = datetime.now(timezone.utc).isoformat()

        session_token = secrets.token_urlsafe(48)
        token_hash = self._hash_token(session_token)
        expires_at = (
            datetime.now(timezone.utc) + timedelta(minutes=self._session_timeout)
        ).isoformat()

        session = Session(
            id=secrets.token_hex(16),
            user_id=user_id,
            token_hash=token_hash,
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=expires_at,
        )

        self._sessions[session.id] = session
        self._token_store[token_hash] = session.id
        if user_id not in self._sessions_by_user:
            self._sessions_by_user[user_id] = []
        self._sessions_by_user[user_id].append(session.id)

        logger.info("user_logged_in", user_id=user_id, session_id=session.id)
        return AuthResult(success=True, user=user, session=session)

    async def logout(self, session_token: str) -> bool:
        token_hash = self._hash_token(session_token)
        session_id = self._token_store.pop(token_hash, None)
        if not session_id:
            return False

        session = self._sessions.pop(session_id, None)
        if session and session.user_id in self._sessions_by_user:
            self._sessions_by_user[session.user_id] = [
                sid for sid in self._sessions_by_user[session.user_id] if sid != session_id
            ]

        logger.info("user_logged_out", session_id=session_id)
        return True

    async def validate_session(self, session_token: str) -> User | None:
        token_hash = self._hash_token(session_token)
        session_id = self._token_store.get(token_hash)
        if not session_id:
            return None

        session = self._sessions.get(session_id)
        if not session:
            return None

        try:
            if datetime.fromisoformat(session.expires_at) < datetime.now(timezone.utc):
                await self.logout(session_token)
                return None
        except ValueError:
            return None

        user = self._users.get(session.user_id)
        if not user or not user.is_active:
            return None

        session.last_activity_at = datetime.now(timezone.utc).isoformat()
        return user

    async def refresh_session(self, session_token: str) -> Session | None:
        token_hash = self._hash_token(session_token)
        session_id = self._token_store.get(token_hash)
        if not session_id:
            return None

        session = self._sessions.get(session_id)
        if not session:
            return None

        session.expires_at = (
            datetime.now(timezone.utc) + timedelta(minutes=self._session_timeout)
        ).isoformat()
        session.last_activity_at = datetime.now(timezone.utc).isoformat()
        return session

    async def change_password(self, user_id: str, old_password: str, new_password: str) -> bool:
        user = self._users.get(user_id)
        if not user:
            return False

        if not pwd_context.verify(old_password, user.password_hash):
            return False

        strength_error = self._validate_password_strength(new_password)
        if strength_error:
            return False

        user.password_hash = pwd_context.hash(new_password)
        user.updated_at = datetime.now(timezone.utc).isoformat()
        await self.revoke_all_sessions(user_id)
        logger.info("password_changed", user_id=user_id)
        return True

    async def get_user(self, user_id: str) -> User | None:
        return self._users.get(user_id)

    async def list_users(self) -> list[User]:
        return list(self._users.values())

    async def update_user_role(self, user_id: str, new_role: UserRole) -> bool:
        user = self._users.get(user_id)
        if not user:
            return False
        user.role = new_role
        user.updated_at = datetime.now(timezone.utc).isoformat()
        logger.info("role_updated", user_id=user_id, new_role=new_role.value)
        return True

    async def deactivate_user(self, user_id: str) -> bool:
        user = self._users.get(user_id)
        if not user:
            return False
        user.is_active = False
        user.updated_at = datetime.now(timezone.utc).isoformat()
        await self.revoke_all_sessions(user_id)
        logger.info("user_deactivated", user_id=user_id)
        return True

    async def revoke_all_sessions(self, user_id: str) -> int:
        session_ids = self._sessions_by_user.pop(user_id, [])
        count = 0
        for sid in session_ids:
            session = self._sessions.pop(sid, None)
            if session:
                self._token_store.pop(session.token_hash, None)
                count += 1
        return count
