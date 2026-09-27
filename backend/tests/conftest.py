"""Root conftest.py — shared test fixtures."""

from __future__ import annotations

import http.server
import threading
from collections.abc import Iterator

import pytest


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    """Use asyncio backend for all async tests."""
    return "asyncio"


class _QuietHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP server: sends X-Frame-Options only (no CSP/HSTS)."""

    def do_GET(self) -> None:
        body = b"<html><body>ssx test server</body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        """Silence request logging."""


@pytest.fixture()
def local_http_server() -> Iterator[str]:
    """A local HTTP server on 127.0.0.1 (returns its base URL)."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
