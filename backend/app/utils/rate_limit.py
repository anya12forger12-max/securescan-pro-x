"""Rate limiting middleware for SecureScan Pro X."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

if TYPE_CHECKING:
    from starlette.types import ASGIApp

_TRUSTED_PROXY_HOSTS = frozenset({"127.0.0.1", "::1", "testclient"})

_ROUTE_LIMITS: dict[str, tuple[int, int]] = {
    "/api/v1/auth/login": (5, 5),
    "/api/v1/auth/register": (3, 5),
}


@dataclass
class RateLimitBucket:
    """A rate limit bucket tracking requests."""

    tokens: float
    last_refill: float
    max_tokens: int
    refill_rate: float


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory rate limiting middleware using token bucket algorithm."""

    def __init__(
        self,
        app: "ASGIApp",
        requests_per_minute: int = 100,
        burst_size: int = 20,
        trusted_proxies: frozenset[str] | None = None,
    ) -> None:
        super().__init__(app)
        self._requests_per_minute = requests_per_minute
        self._burst_size = burst_size
        self._refill_rate = requests_per_minute / 60.0
        self._trusted_proxies = (
            _TRUSTED_PROXY_HOSTS if trusted_proxies is None else frozenset(trusted_proxies)
        )
        self._buckets: dict[str | tuple[str, str], RateLimitBucket] = {}
        self._cleanup_interval = 300
        self._last_cleanup = time.time()

    def _create_bucket(
        self,
        max_tokens: int | None = None,
        refill_rate: float | None = None,
    ) -> RateLimitBucket:
        limit = self._burst_size if max_tokens is None else max_tokens
        rate = self._refill_rate if refill_rate is None else refill_rate
        return RateLimitBucket(
            tokens=limit,
            last_refill=time.time(),
            max_tokens=limit,
            refill_rate=rate,
        )

    def _get_client_id(self, request: Request) -> str:
        peer = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded and peer in self._trusted_proxies:
            return forwarded.split(",")[0].strip()
        return peer

    def _bucket_for(
        self, key: str | tuple[str, str], limit: tuple[int, int] | None
    ) -> RateLimitBucket:
        bucket = self._buckets.get(key)
        if bucket is None:
            if limit is None:
                bucket = self._create_bucket()
            else:
                burst, per_minute = limit
                bucket = self._create_bucket(burst, per_minute / 60.0)
            self._buckets[key] = bucket
        return bucket

    def _refill(self, bucket: RateLimitBucket) -> None:
        now = time.time()
        elapsed = now - bucket.last_refill
        bucket.tokens = min(
            bucket.max_tokens,
            bucket.tokens + elapsed * bucket.refill_rate,
        )
        bucket.last_refill = now

    def _cleanup_old_buckets(self) -> None:
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return
        self._last_cleanup = now
        expired = [k for k, v in self._buckets.items() if now - v.last_refill > 600]
        for k in expired:
            del self._buckets[k]

    @staticmethod
    def _limited_response(bucket: RateLimitBucket) -> Response:
        return Response(
            content='{"detail":"Rate limit exceeded. Try again later."}',
            status_code=429,
            media_type="application/json",
            headers={
                "X-RateLimit-Limit": str(bucket.max_tokens),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(bucket.last_refill + 60)),
                "Retry-After": str(max(1, int(1 / bucket.refill_rate))),
            },
        )

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in ("/health", "/docs", "/openapi.json"):
            return await call_next(request)

        self._cleanup_old_buckets()
        client_id = self._get_client_id(request)
        route_limit = _ROUTE_LIMITS.get(request.url.path)
        key: str | tuple[str, str] = (client_id, request.url.path) if route_limit else client_id
        bucket = self._bucket_for(key, route_limit)
        self._refill(bucket)

        remaining = int(bucket.tokens)
        if bucket.tokens < 1:
            return self._limited_response(bucket)

        bucket.tokens -= 1
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(bucket.max_tokens)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining - 1))
        return response
