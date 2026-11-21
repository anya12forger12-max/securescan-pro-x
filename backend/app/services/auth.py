"""Authentication service for SecureScan Pro X."""

from __future__ import annotations

import hashlib
import secrets
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from functools import lru_cache

import bcrypt

from app.core.logging import get_logger
from app.utils.crypto import verify_totp

logger = get_logger(__name__)

_BCRYPT_ROUNDS = 12
# bcrypt processes at most 72 bytes; anything longer raises on bcrypt>=4.1.
# Longer secrets are pre-hashed with SHA-256 (64 hex chars) so no entropy is
# silently dropped and verification stays deterministic.
_BCRYPT_MAX_BYTES = 72


def _prepare_password(password: str) -> bytes:
    """Normalize a password for bcrypt without losing entropy."""
    data = password.encode()
    if len(data) > _BCRYPT_MAX_BYTES:
        return hashlib.sha256(data).hexdigest().encode()
    return data


def hash_password(password: str) -> str:
    """Hash a password with bcrypt using a per-password random salt."""
    return bcrypt.hashpw(
        _prepare_password(password),
        bcrypt.gensalt(rounds=_BCRYPT_ROUNDS),
    ).decode()


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time check of a password against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(_prepare_password(password), password_hash.encode())
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    """Hash used to keep unknown-user logins from returning instantly."""
    return hash_password("timing-equalizer-not-a-real-password")


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
class _LoginAttempt:
    count: int = 0
    locked_until: datetime | None = None


@dataclass
class AuthResult:
    success: bool
    user: User | None = None
    session: Session | None = None
    session_token: str | None = None
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
        self,
        username: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
        mfa_code: str | None = None,
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
        self._login_attempts: dict[tuple[str, str], _LoginAttempt] = {}
        self._session_timeout = session_timeout_minutes
        self._max_login_attempts = max_login_attempts
        self._lockout_duration = lockout_duration_minutes
        self._password_min_length = password_min_length
        self._token_store: dict[str, str] = {}

    def _hash_token(self, token: str) -> str:
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

    @staticmethod
    def _attempt_key(username: str, ip_address: str | None) -> tuple[str, str]:
        return username.casefold(), ip_address or "unknown"

    def _get_attempt(self, username: str, ip_address: str | None) -> _LoginAttempt:
        return self._login_attempts.setdefault(
            self._attempt_key(username, ip_address), _LoginAttempt()
        )

    def _is_locked(self, attempt: _LoginAttempt, user: User) -> bool:
        if attempt.locked_until:
            if datetime.now(timezone.utc) < attempt.locked_until:
                return True
            attempt.locked_until = None
            attempt.count = 0
            user.locked_until = None
            user.failed_login_attempts = 0
        return False

    async def register(
        self, username: str, email: str, password: str, role: UserRole = UserRole.VIEWER
    ) -> AuthResult:
        if username.casefold() in self._users_by_username:
            return AuthResult(success=False, error="Registration failed")
        if email.casefold() in self._users_by_email:
            return AuthResult(success=False, error="Registration failed")

        strength_error = self._validate_password_strength(password)
        if strength_error:
            return AuthResult(success=False, error=strength_error)

        user_id = secrets.token_hex(16)
        password_hash = hash_password(password)
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
        self._users_by_username[username.casefold()] = user_id
        self._users_by_email[email.casefold()] = user_id

        logger.info("user_registered", user_id=user_id, username=username, role=role.value)
        return AuthResult(success=True, user=user)

    async def login(
        self,
        username: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
        mfa_code: str | None = None,
    ) -> AuthResult:
        normalized = username.casefold()
        user_id = self._users_by_username.get(normalized)
        if not user_id:
            verify_password(password, _dummy_password_hash())
            return AuthResult(success=False, error="Invalid credentials")

        user = self._users[user_id]
        attempt = self._get_attempt(normalized, ip_address)

        if not user.is_active:
            return AuthResult(success=False, error="Account is deactivated")

        if self._is_locked(attempt, user):
            return AuthResult(success=False, error="Account is locked", locked=True)

        if not verify_password(password, user.password_hash):
            attempt.count += 1
            user.failed_login_attempts = attempt.count
            if attempt.count >= self._max_login_attempts:
                attempt.locked_until = datetime.now(timezone.utc) + timedelta(
                    minutes=self._lockout_duration
                )
                user.locked_until = attempt.locked_until.isoformat()
                logger.warning(
                    "account_locked",
                    user_id=user_id,
                    attempts=attempt.count,
                    ip_address=ip_address,
                )
            return AuthResult(success=False, error="Invalid credentials")

        if user.mfa_enabled and (
            not mfa_code or not user.mfa_secret or not verify_totp(user.mfa_secret, mfa_code)
        ):
            return AuthResult(success=False, error="Invalid MFA code", requires_mfa=True)

        self._login_attempts.pop(self._attempt_key(normalized, ip_address), None)
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
        return AuthResult(success=True, user=user, session=session, session_token=session_token)

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

        try:
            if datetime.fromisoformat(session.expires_at) < datetime.now(timezone.utc):
                await self.logout(session_token)
                return None
        except ValueError:
            return None

        user = self._users.get(session.user_id)
        if not user or not user.is_active:
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

        if not verify_password(old_password, user.password_hash):
            return False

        strength_error = self._validate_password_strength(new_password)
        if strength_error:
            return False

        user.password_hash = hash_password(new_password)
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
