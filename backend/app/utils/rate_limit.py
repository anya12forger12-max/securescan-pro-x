"""Rate limiting middleware for SecureScan Pro X."""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint


@dataclass
class RateLimitBucket:
    """A rate limit bucket tracking requests."""
    tokens: int
    last_refill: float
    max_tokens: int
    refill_rate: float


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory rate limiting middleware using token bucket algorithm."""

    def __init__(
        self,
        app: object,
        requests_per_minute: int = 100,
        burst_size: int = 20,
    ) -> None:
        super().__init__(app)
        self._requests_per_minute = requests_per_minute
        self._burst_size = burst_size
        self._refill_rate = requests_per_minute / 60.0
        self._buckets: dict[str, RateLimitBucket] = defaultdict(self._create_bucket)
        self._cleanup_interval = 300
        self._last_cleanup = time.time()

    def _create_bucket(self) -> RateLimitBucket:
        return RateLimitBucket(
            tokens=self._burst_size,
            last_refill=time.time(),
            max_tokens=self._burst_size,
            refill_rate=self._refill_rate,
        )

    def _get_client_id(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

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
        expired = [
            k for k, v in self._buckets.items()
            if now - v.last_refill > 600
        ]
        for k in expired:
            del self._buckets[k]

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.url.path in ("/health", "/docs", "/openapi.json"):
            return await call_next(request)

        self._cleanup_old_buckets()
        client_id = self._get_client_id(request)
        bucket = self._buckets[client_id]
        self._refill(bucket)

        remaining = int(bucket.tokens)
        if bucket.tokens < 1:
            return Response(
                content='{"detail":"Rate limit exceeded. Try again later."}',
                status_code=429,
                media_type="application/json",
                headers={
                    "X-RateLimit-Limit": str(self._burst_size),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(bucket.last_refill + 60)),
                    "Retry-After": str(int(60 / self._refill_rate)),
                },
            )

        bucket.tokens -= 1
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self._burst_size)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining - 1))
        return response
