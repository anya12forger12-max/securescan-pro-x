"""Unit tests for the in-memory authentication service.

Covers password hashing (bcrypt with >72-byte pre-hash), password
strength policy, session lifecycle, login lockout, and account state.
"""

from __future__ import annotations

import pytest

from app.services.auth import (
    InMemoryAuthService,
    UserRole,
    hash_password,
    verify_password,
)


@pytest.fixture
def auth() -> InMemoryAuthService:
    """Create a fresh auth service."""
    return InMemoryAuthService()


class TestPasswordHashing:
    """bcrypt hashing helpers."""

    def test_roundtrip(self) -> None:
        """A password verifies against its own hash."""
        h = hash_password("Sup3rSecret!Pass")
        assert verify_password("Sup3rSecret!Pass", h)

    def test_wrong_password_rejected(self) -> None:
        """A different password does not verify."""
        h = hash_password("Sup3rSecret!Pass")
        assert not verify_password("WrongPass1!xx", h)

    def test_long_password_roundtrip(self) -> None:
        """Passwords beyond bcrypt's 72-byte limit still round-trip."""
        long_pw = "A1!" + "x" * 200
        assert verify_password(long_pw, hash_password(long_pw))
        assert not verify_password(long_pw + "x", hash_password(long_pw))

    def test_malformed_hash_fails_closed(self) -> None:
        """A corrupt stored hash is rejected, not raised."""
        assert not verify_password("anything", "not-a-bcrypt-hash")
        assert not verify_password("anything", "")

    def test_hashes_are_salted(self) -> None:
        """Two hashes of the same password differ (per-hash salt)."""
        assert hash_password("SamePass1!aaa") != hash_password("SamePass1!aaa")


class TestRegistration:
    """Registration and password strength policy."""

    @pytest.mark.asyncio
    async def test_register_success(self, auth: InMemoryAuthService) -> None:
        """A well-formed registration succeeds."""
        result = await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        assert result.success
        assert result.user is not None
        assert result.user.username == "alice"
        assert result.user.role == UserRole.VIEWER

    @pytest.mark.asyncio
    async def test_duplicate_username_rejected(self, auth: InMemoryAuthService) -> None:
        """The second registration with a taken username fails."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        result = await auth.register("alice", "other@example.com", "Str0ngPass!word")
        assert not result.success
        assert result.error == "Username already exists"

    @pytest.mark.asyncio
    async def test_duplicate_email_rejected(self, auth: InMemoryAuthService) -> None:
        """The second registration with a taken email fails."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        result = await auth.register("bob", "alice@example.com", "Str0ngPass!word")
        assert not result.success
        assert result.error == "Email already exists"

    @pytest.mark.parametrize(
        ("password", "expected"),
        [
            ("Sh0rt!a", "at least 12 characters"),
            ("alllowercase1!", "uppercase"),
            ("ALLUPPERCASE1!", "lowercase"),
            ("NoDigits!!here", "digit"),
            ("NoSpecial123456", "special character"),
        ],
    )
    @pytest.mark.asyncio
    async def test_password_strength_rejected(
        self,
        auth: InMemoryAuthService,
        password: str,
        expected: str,
    ) -> None:
        """Weak passwords are rejected with an actionable message."""
        result = await auth.register("weakuser", "weak@example.com", password)
        assert not result.success
        assert expected in (result.error or "")


class TestLoginAndSessions:
    """Login, session validation, logout, refresh."""

    @pytest.mark.asyncio
    async def test_login_returns_session_token(self, auth: InMemoryAuthService) -> None:
        """A successful login carries a usable session token."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        result = await auth.login("alice", "Str0ngPass!word", ip_address="10.0.0.1")
        assert result.success
        assert result.session_token
        user = await auth.validate_session(result.session_token)
        assert user is not None
        assert user.username == "alice"

    @pytest.mark.asyncio
    async def test_wrong_password_rejected(self, auth: InMemoryAuthService) -> None:
        """A wrong password fails without leaking which field was wrong."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        result = await auth.login("alice", "Wr0ngPass!word")
        assert not result.success
        assert result.error == "Invalid credentials"

    @pytest.mark.asyncio
    async def test_unknown_user_rejected(self, auth: InMemoryAuthService) -> None:
        """An unknown username fails with the same generic error."""
        result = await auth.login("nobody", "Str0ngPass!word")
        assert not result.success
        assert result.error == "Invalid credentials"

    @pytest.mark.asyncio
    async def test_logout_revokes_token(self, auth: InMemoryAuthService) -> None:
        """After logout the token no longer validates."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        login = await auth.login("alice", "Str0ngPass!word")
        assert login.session_token
        assert await auth.logout(login.session_token)
        assert await auth.validate_session(login.session_token) is None

    @pytest.mark.asyncio
    async def test_logout_unknown_token_is_noop(self, auth: InMemoryAuthService) -> None:
        """Logging out a bogus token is a safe no-op."""
        assert not await auth.logout("bogus-token")

    @pytest.mark.asyncio
    async def test_refresh_extends_session(self, auth: InMemoryAuthService) -> None:
        """Refreshing a live session returns the same session id."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        login = await auth.login("alice", "Str0ngPass!word")
        refreshed = await auth.refresh_session(login.session_token)
        assert refreshed is not None
        assert refreshed.id == login.session.id

    @pytest.mark.asyncio
    async def test_refresh_rejects_unknown_token(self, auth: InMemoryAuthService) -> None:
        """Refreshing an unknown token fails cleanly."""
        assert await auth.refresh_session("bogus-token") is None

    @pytest.mark.asyncio
    async def test_revoke_all_sessions(self, auth: InMemoryAuthService) -> None:
        """Revoking all sessions invalidates every token for the user."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        first = await auth.login("alice", "Str0ngPass!word")
        second = await auth.login("alice", "Str0ngPass!word")
        revoked = await auth.revoke_all_sessions(first.user.id)
        assert revoked == 2
        assert await auth.validate_session(first.session_token) is None
        assert await auth.validate_session(second.session_token) is None


class TestLockout:
    """Brute-force lockout after repeated failures."""

    @pytest.mark.asyncio
    async def test_lockout_after_max_attempts(self, auth: InMemoryAuthService) -> None:
        """The 5th consecutive failure locks the account; next attempt reports it."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        for _ in range(4):
            result = await auth.login("alice", "Wr0ngPass!word")
            assert not result.success
            assert not result.locked
        # The triggering failure still answers generically (no lock disclosure).
        result = await auth.login("alice", "Wr0ngPass!word")
        assert not result.success
        assert not result.locked
        # From the next attempt on, the lock is reported distinctly.
        result = await auth.login("alice", "Wr0ngPass!word")
        assert not result.success
        assert result.locked
        assert result.error == "Account is locked"

    @pytest.mark.asyncio
    async def test_lockout_survives_correct_password(self, auth: InMemoryAuthService) -> None:
        """A locked account rejects even the correct password."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        for _ in range(5):
            await auth.login("alice", "Wr0ngPass!word")
        result = await auth.login("alice", "Str0ngPass!word")
        assert not result.success
        assert result.locked

    @pytest.mark.asyncio
    async def test_successful_login_resets_failures(self, auth: InMemoryAuthService) -> None:
        """A success between failures resets the lockout counter."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        for _ in range(4):
            await auth.login("alice", "Wr0ngPass!word")
        assert (await auth.login("alice", "Str0ngPass!word")).success
        for _ in range(4):
            await auth.login("alice", "Wr0ngPass!word")
        result = await auth.login("alice", "Str0ngPass!word")
        assert result.success


class TestAccountState:
    """Password change, deactivation, role and user queries."""

    @pytest.mark.asyncio
    async def test_change_password(self, auth: InMemoryAuthService) -> None:
        """Changing the password invalidates the old one."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        user = (await auth.login("alice", "Str0ngPass!word")).user
        assert await auth.change_password(user.id, "Str0ngPass!word", "N3wPass!word")
        assert not (await auth.login("alice", "Str0ngPass!word")).success
        assert (await auth.login("alice", "N3wPass!word")).success

    @pytest.mark.asyncio
    async def test_change_password_rejects_wrong_old(self, auth: InMemoryAuthService) -> None:
        """A wrong current password blocks the change."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        user = (await auth.login("alice", "Str0ngPass!word")).user
        assert not await auth.change_password(user.id, "Wr0ngPass!word", "N3wPass!word")

    @pytest.mark.asyncio
    async def test_deactivated_user_cannot_login(self, auth: InMemoryAuthService) -> None:
        """Deactivation blocks login with a distinct message."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        user = (await auth.login("alice", "Str0ngPass!word")).user
        assert await auth.deactivate_user(user.id)
        result = await auth.login("alice", "Str0ngPass!word")
        assert not result.success
        assert result.error == "Account is deactivated"

    @pytest.mark.asyncio
    async def test_update_role(self, auth: InMemoryAuthService) -> None:
        """Roles can be promoted and read back."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        user = (await auth.login("alice", "Str0ngPass!word")).user
        assert await auth.update_user_role(user.id, UserRole.ADMIN)
        fetched = await auth.get_user(user.id)
        assert fetched is not None
        assert fetched.role == UserRole.ADMIN

    @pytest.mark.asyncio
    async def test_list_users(self, auth: InMemoryAuthService) -> None:
        """Registered users are enumerable."""
        await auth.register("alice", "alice@example.com", "Str0ngPass!word")
        await auth.register("bob", "bob@example.com", "Str0ngPass!word")
        users = await auth.list_users()
        assert {u.username for u in users} == {"alice", "bob"}
