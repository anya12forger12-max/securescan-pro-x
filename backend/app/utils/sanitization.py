"""Input sanitization middleware for SecureScan Pro X."""

from __future__ import annotations

import html
import re

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


_XSS_PATTERNS = [
    re.compile(r"<script\b", re.IGNORECASE),
    re.compile(r"javascript:", re.IGNORECASE),
    re.compile(r"on\w+\s*=", re.IGNORECASE),
    re.compile(r"<iframe\b", re.IGNORECASE),
    re.compile(r"<object\b", re.IGNORECASE),
    re.compile(r"<embed\b", re.IGNORECASE),
    re.compile(r"<form\b", re.IGNORECASE),
    re.compile(r"<input\b", re.IGNORECASE),
    re.compile(r"<link\b.*href\s*=", re.IGNORECASE),
]


class InputSanitizationMiddleware(BaseHTTPMiddleware):
    """Sanitizes request inputs to prevent XSS and injection attacks."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        content_type = request.headers.get("content-type", "")
        if "application/json" not in content_type:
            return await call_next(request)

        body = await request.body()
        if body:
            try:
                text = body.decode("utf-8")
                if self._contains_xss(text):
                    return Response(
                        content='{"detail":"Input contains potentially malicious content"}',
                        status_code=400,
                        media_type="application/json",
                    )
            except UnicodeDecodeError:
                pass

        return await call_next(request)

    def _contains_xss(self, text: str) -> bool:
        return any(pattern.search(text) for pattern in _XSS_PATTERNS)


def sanitize_html(text: str) -> str:
    """HTML-escape a string."""
    return html.escape(text)


def sanitize_sql_like(text: str) -> str:
    """Escape SQL LIKE special characters."""
    text = text.replace("\\", "\\\\")
    text = text.replace("%", "\\%")
    text = text.replace("_", "\\_")
    return text
