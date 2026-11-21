"""CSRF origin validation for cookie-authenticated requests."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlparse

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class CSRFMiddleware(BaseHTTPMiddleware):
    """Reject cross-site browser requests that carry the session cookie.

    Non-browser clients (no Origin/Referer) remain supported, so the CLI,
    tests and native clients keep working without a CSRF token handshake.
    """

    def __init__(self, app: "ASGIApp", allowed_origins: frozenset[str]) -> None:
        super().__init__(app)
        self._allowed_origins = allowed_origins

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in _UNSAFE_METHODS or not request.cookies.get("session_token"):
            return await call_next(request)

        origin = request.headers.get("origin")
        if not origin:
            referer = request.headers.get("referer")
            if referer:
                parsed = urlparse(referer)
                origin = f"{parsed.scheme}://{parsed.netloc}"

        if origin and origin not in self._allowed_origins:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF origin check failed"},
            )

        return await call_next(request)
