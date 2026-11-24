"""Audit logging middleware for SecureScan Pro X."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, ClassVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.logging import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response

logger = get_logger(__name__)


_TRUSTED_PROXY_HOSTS = frozenset({"127.0.0.1", "::1", "testclient"})


class AuditMiddleware(BaseHTTPMiddleware):
    """Logs all API requests for audit trail."""

    SKIP_PATHS: ClassVar[frozenset[str]] = frozenset(
        {"/health", "/docs", "/openapi.json", "/redoc"}
    )

    def __init__(
        self,
        app: Any,
        trusted_proxies: frozenset[str] | None = None,
    ) -> None:
        super().__init__(app)
        self._trusted_proxies = (
            _TRUSTED_PROXY_HOSTS if trusted_proxies is None else frozenset(trusted_proxies)
        )

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        start_time = time.time()
        response = await call_next(request)
        duration_ms = round((time.time() - start_time) * 1000, 2)

        peer = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        client_ip = (
            forwarded.split(",")[0].strip()
            if forwarded and peer in self._trusted_proxies
            else peer
        )
        # Set by require_auth for authenticated requests.
        user = getattr(request.state, "user", None)
        user_id = getattr(user, "id", None)

        logger.info(
            "api_request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
            user_id=user_id or "anonymous",
            user_agent=request.headers.get("User-Agent", "unknown")[:200],
        )

        return response
