"""Authentication API routes for SecureScan Pro X."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

from app.services.auth import AuthService, UserRole
from app.core.dependencies import get_auth_service, get_current_user_optional

router = APIRouter(prefix="/auth", tags=["Authentication"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    display_name: str | None = Field(None, max_length=100)


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=12, max_length=128)


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    display_name: str | None
    role: str
    is_active: bool
    last_login_at: str | None
    created_at: str


class AuthResponse(BaseModel):
    success: bool
    message: str
    user: UserResponse | None = None
    session_token: str | None = None


def _user_to_response(user: object) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role.value if hasattr(user.role, "value") else user.role,
        is_active=user.is_active,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    request: RegisterRequest,
    auth: AuthService = Depends(get_auth_service),
) -> AuthResponse:
    result = await auth.register(
        username=request.username,
        email=request.email,
        password=request.password,
    )
    if not result.success:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=result.error)
    return AuthResponse(
        success=True,
        message="Registration successful",
        user=_user_to_response(result.user) if result.user else None,
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    request: LoginRequest,
    response: Response,
    auth: AuthService = Depends(get_auth_service),
    req: Request = None,
) -> AuthResponse:
    ip = req.client.host if req and req.client else None
    ua = req.headers.get("user-agent") if req else None
    result = await auth.login(
        username=request.username,
        password=request.password,
        ip_address=ip,
        user_agent=ua,
    )
    if not result.success:
        code = status.HTTP_423_LOCKED if result.locked else status.HTTP_401_UNAUTHORIZED
        raise HTTPException(status_code=code, detail=result.error)

    response.set_cookie(
        key="session_token",
        value=result.session_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=1800,
        path="/",
    )

    return AuthResponse(
        success=True,
        message="Login successful",
        user=_user_to_response(result.user) if result.user else None,
        session_token=result.session_token,
    )


@router.post("/logout")
async def logout(
    response: Response,
    session_token: str | None = Cookie(None),
    auth: AuthService = Depends(get_auth_service),
) -> dict[str, bool]:
    if session_token:
        await auth.logout(session_token)
    response.delete_cookie("session_token", path="/")
    return {"success": True}


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    user=Depends(get_current_user_optional),
) -> UserResponse:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _user_to_response(user)


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    user=Depends(get_current_user_optional),
    auth: AuthService = Depends(get_auth_service),
) -> dict[str, str]:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    success = await auth.change_password(user.id, request.old_password, request.new_password)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid current password or password too weak")
    return {"message": "Password changed successfully"}


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    user=Depends(get_current_user_optional),
    auth: AuthService = Depends(get_auth_service),
) -> list[UserResponse]:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if hasattr(user.role, "value"):
        role_val = user.role.value
    else:
        role_val = user.role
    if role_val != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    users = await auth.list_users()
    return [_user_to_response(u) for u in users]
