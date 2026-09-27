"""End-to-end API regression tests for the v1 HTTP surface.

Locks the shipped fixes: router-level auth on data endpoints, the single
scans prefix, shared assessment/report state, workspace-scoped dashboard
counts, optional workspace_id list filters, evidence write-through,
integrity-verified report downloads, plus middleware behavior (security
headers, XSS rejection, rate limiting).

Every test registers its own throwaway account and sends a unique
X-Forwarded-For per request: the rate limiter keeps module-level buckets
for the process lifetime (burst=20), so a shared client IP would trip
it mid-suite.
"""

from __future__ import annotations

import itertools
import socket
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api import app

_ip_seq = itertools.count(1)


def _next_ip() -> str:
    n = next(_ip_seq)
    return f"198.51.{(n // 250) % 250}.{(n % 250) + 1}"


def _get(client: TestClient, url: str, **kw):
    headers = dict(kw.pop("headers", None) or {})
    headers.setdefault("X-Forwarded-For", _next_ip())
    return client.get(url, headers=headers, **kw)


def _post(client: TestClient, url: str, json=None, **kw):
    headers = dict(kw.pop("headers", None) or {})
    headers.setdefault("X-Forwarded-For", _next_ip())
    return client.post(url, json=json, headers=headers, **kw)


def _login(client: TestClient) -> str:
    """Register and log in a throwaway account; returns the username."""
    uid = uuid.uuid4().hex[:12]
    username = f"qa_{uid}"
    r = _post(
        client,
        "/api/v1/auth/register",
        {
            "username": username,
            "email": f"{uid}@example.com",
            "password": "Str0ngPass!word",
        },
    )
    assert r.status_code == 201, r.text
    r = _post(
        client,
        "/api/v1/auth/login",
        {"username": username, "password": "Str0ngPass!word"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["session_token"]
    return username


def _make_workspace(client: TestClient) -> str:
    r = _post(client, "/api/v1/workspaces", {"name": f"ws-{uuid.uuid4().hex[:10]}"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _make_assessment(client: TestClient, workspace_id: str) -> str:
    r = _post(
        client,
        f"/api/v1/assessments?workspace_id={workspace_id}",
        {"name": f"asm-{uuid.uuid4().hex[:10]}"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


class TestOpenEndpoints:
    """Endpoints that must stay reachable without a session."""

    def test_health_and_root(self, client: TestClient) -> None:
        assert _get(client, "/health").status_code == 200
        assert _get(client, "/").status_code == 200


class TestAuthEnforcement:
    """Data routers require a session (previously fully open)."""

    @pytest.mark.parametrize(
        "url",
        [
            "/api/v1/workspaces",
            "/api/v1/assessments",
            "/api/v1/assessments/dashboard",
            "/api/v1/assets",
            "/api/v1/reports",
            "/api/v1/assessments/asm-x/evidence",
        ],
    )
    def test_data_routers_reject_anonymous(self, client: TestClient, url: str) -> None:
        assert _get(client, url).status_code == 401

    def test_viewer_cannot_list_users(self, client: TestClient) -> None:
        _login(client)
        r = _get(client, "/api/v1/auth/users")
        assert r.status_code == 403


class TestAuthFlow:
    """Register / login / me / logout over HTTP."""

    def test_full_flow(self, client: TestClient) -> None:
        uid = uuid.uuid4().hex[:12]
        username = f"qa_{uid}"
        payload = {
            "username": username,
            "email": f"{uid}@example.com",
            "password": "Str0ngPass!word",
        }

        r = _post(client, "/api/v1/auth/register", payload)
        assert r.status_code == 201
        assert r.json()["user"]["username"] == username

        # Duplicate username -> 409.
        r = _post(
            client,
            "/api/v1/auth/register",
            {**payload, "email": f"other-{uid}@example.com"},
        )
        assert r.status_code == 409
        assert "exists" in r.json()["detail"]

        # Weak password rejected by the request schema with an actionable message.
        r = _post(
            client,
            "/api/v1/auth/register",
            {**payload, "username": f"weak_{uid}", "password": "short"},
        )
        assert r.status_code == 422
        assert "12" in str(r.json()["detail"])

        # Wrong password -> 401, generic message.
        r = _post(
            client,
            "/api/v1/auth/login",
            {"username": username, "password": "Wr0ngPass!word"},
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "Invalid credentials"

        # Successful login carries a session token.
        r = _post(
            client,
            "/api/v1/auth/login",
            {"username": username, "password": "Str0ngPass!word"},
        )
        assert r.status_code == 200
        assert r.json()["session_token"]

        # Cookie session resolves the user.
        r = _get(client, "/api/v1/auth/me")
        assert r.status_code == 200
        assert r.json()["username"] == username

        # Logout clears the session.
        r = _post(client, "/api/v1/auth/logout")
        assert r.status_code == 200
        assert _get(client, "/api/v1/auth/me").status_code == 401


class TestScans:
    """Scans auth + single-prefix router regression."""

    def test_scans_require_auth(self, client: TestClient) -> None:
        assert _get(client, "/api/v1/scans/history").status_code == 401

    def test_scan_routes_work_after_login(self, client: TestClient) -> None:
        _login(client)
        assert _get(client, "/api/v1/scans/history").status_code == 200

        r = _post(client, "/api/v1/scans/password-check", {"demo_mode": True})
        assert r.status_code == 200
        assert r.json()["scan_type"] == "password_check"

        # Regression: scans router previously carried its own /scans prefix,
        # yielding /api/v1/scans/scans/... (404).
        assert _get(client, "/api/v1/scans/scans/history").status_code == 404

    def test_engine_backed_routes(self, client: TestClient, local_http_server: str) -> None:
        """Port/header/ssl/full routes drive the real engine (local targets)."""
        _login(client)

        # Port scan: a socket we keep listening is reported open.
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        open_port = listener.getsockname()[1]
        try:
            r = _post(
                client,
                "/api/v1/scans/port-scan",
                {"target": "127.0.0.1", "ports": [open_port], "timeout": 1.0},
            )
        finally:
            listener.close()
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "completed"
        assert body["metadata"]["open_port_count"] == 1

        # Header check: local plain-HTTP server missing CSP/HSTS.
        r = _post(client, "/api/v1/scans/header-check", {"url": local_http_server})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "completed"
        titles = [f["title"] for f in body["findings"]]
        assert any("Missing Content-Security-Policy" in t for t in titles)

        # SSL check: closed port → failed status inside a 200 response.
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
        probe.close()
        r = _post(
            client,
            "/api/v1/scans/ssl-check",
            {"hostname": "127.0.0.1", "port": closed_port},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "failed"
        assert body["error"]

        # Full scan: dispatch only the requested scan types.
        r = _post(
            client,
            "/api/v1/scans/full-scan",
            {"target": "127.0.0.1", "scan_types": ["ssl_check"]},
        )
        assert r.status_code == 200, r.text
        assert set(r.json()) == {"ssl_check"}

        # History grew across the engine-backed calls above.
        r = _get(client, "/api/v1/scans/history")
        assert r.status_code == 200
        assert len(r.json()) >= 3


class TestWorkspaceAssetAssessmentCrud:
    """CRUD + the optional workspace_id list filters."""

    def test_full_crud(self, client: TestClient) -> None:
        _login(client)
        ws_id = _make_workspace(client)

        r = _get(client, f"/api/v1/workspaces/{ws_id}")
        assert r.status_code == 200
        assert r.json()["id"] == ws_id

        # Asset creation takes workspace_id as a query param.
        r = _post(
            client,
            f"/api/v1/assets?workspace_id={ws_id}",
            {"name": "host-1", "asset_type": "host", "identifier": "10.0.0.5"},
        )
        assert r.status_code == 201, r.text
        asset_id = r.json()["id"]

        # List without workspace_id (frontend contract) and with it.
        r = _get(client, "/api/v1/assets")
        assert r.status_code == 200
        assert any(a["id"] == asset_id for a in r.json())
        r = _get(client, f"/api/v1/assets?workspace_id={ws_id}")
        assert r.status_code == 200
        assert any(a["id"] == asset_id for a in r.json())

        # Assessment creation takes workspace_id as a query param.
        name = f"Quarterly {uuid.uuid4().hex[:6]}"
        r = _post(
            client,
            f"/api/v1/assessments?workspace_id={ws_id}",
            {"name": name},
        )
        assert r.status_code == 201, r.text
        asm_id = r.json()["id"]

        # List without workspace_id (frontend contract) and with it.
        r = _get(client, "/api/v1/assessments")
        assert r.status_code == 200
        assert any(a["id"] == asm_id for a in r.json())
        r = _get(client, f"/api/v1/assessments?workspace_id={ws_id}")
        assert r.status_code == 200
        assert any(a["id"] == asm_id for a in r.json())

        # Detail.
        r = _get(client, f"/api/v1/assessments/{asm_id}")
        assert r.status_code == 200
        assert r.json()["name"] == name

        # Dashboard without workspace_id (frontend contract).
        r = _get(client, "/api/v1/assessments/dashboard")
        assert r.status_code == 200
        assert r.json()["total_assessments"] >= 1

        # Search without workspace_id.
        r = _get(client, f"/api/v1/assessments/search?q={name.split()[0]}")
        assert r.status_code == 200
        assert any(x["id"] == asm_id for x in r.json()["results"])

        # Notes, tags, timeline.
        r = _post(
            client,
            f"/api/v1/assessments/{asm_id}/notes",
            {"content": "checked by smoke test"},
        )
        assert r.status_code == 201, r.text
        r = _post(
            client,
            f"/api/v1/assessments/{asm_id}/tags",
            {"tag": "smoke"},
        )
        assert r.status_code == 201, r.text
        r = _get(client, f"/api/v1/assessments/{asm_id}/timeline")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1


class TestLifecycle:
    """Queue/cancel state machine + archive guard."""

    def test_queue_then_cancel(self, client: TestClient) -> None:
        _login(client)
        ws_id = _make_workspace(client)
        asm_id = _make_assessment(client, ws_id)

        r = _post(client, f"/api/v1/assessments/{asm_id}/queue")
        assert r.status_code == 200
        assert r.json()["status"] == "queued"

        r = _post(client, f"/api/v1/assessments/{asm_id}/cancel")
        assert r.status_code == 200
        assert r.json()["status"] == "cancelled"

        # Archive only accepts completed assessments.
        r = _post(client, f"/api/v1/assessments/{asm_id}/archive")
        assert r.status_code == 409


class TestEvidenceAndStatistics:
    """Evidence write-through + 404 pre-check + statistics schema."""

    def test_evidence_flow(self, client: TestClient) -> None:
        _login(client)
        ws_id = _make_workspace(client)
        asm_id = _make_assessment(client, ws_id)

        r = _post(
            client,
            f"/api/v1/assessments/{asm_id}/evidence",
            {
                "evidence_type": "log",
                "title": "port scan output",
                "content": "22,80,443 open",
            },
        )
        assert r.status_code == 201, r.text
        ev_id = r.json()["id"]
        assert r.json()["integrity_hash"]

        # Write-through: statistics sees the evidence item.
        r = _get(client, f"/api/v1/assessments/{asm_id}/statistics")
        assert r.status_code == 200, r.text
        stats = r.json()
        assert stats["assessment_id"] == asm_id
        assert stats["total_evidence"] == 1
        assert "plugin_count" in stats
        assert stats["total_findings"] == 0

        # Evidence list + integrity verification.
        r = _get(client, f"/api/v1/assessments/{asm_id}/evidence")
        assert r.status_code == 200
        assert any(e["id"] == ev_id for e in r.json())
        r = _get(
            client,
            f"/api/v1/assessments/{asm_id}/evidence/{ev_id}/verify",
        )
        assert r.status_code == 200
        assert r.json()["is_valid"] is True

        # Missing assessment -> 404 before anything is stored.
        r = _post(
            client,
            "/api/v1/assessments/asm-does-not-exist/evidence",
            {"evidence_type": "manual_note", "title": "nope"},
        )
        assert r.status_code == 404

        # Unknown assessment statistics -> 404.
        r = _get(client, "/api/v1/assessments/asm-does-not-exist/statistics")
        assert r.status_code == 404


class TestFindings:
    """Finding normalization over HTTP."""

    def test_add_finding(self, client: TestClient) -> None:
        _login(client)
        ws_id = _make_workspace(client)
        asm_id = _make_assessment(client, ws_id)

        r = _post(
            client,
            f"/api/v1/assessments/{asm_id}/findings",
            {"title": "Outdated TLS configuration", "severity": "high"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["id"].startswith("find-")
        assert body["assessment_id"] == asm_id
        assert body["severity"] == "high"

        # Invalid severity -> rejected by normalization -> 422.
        r = _post(
            client,
            f"/api/v1/assessments/{asm_id}/findings",
            {"title": "bad severity", "severity": "urgent"},
        )
        assert r.status_code == 422

        # Unknown assessment -> 404.
        r = _post(
            client,
            "/api/v1/assessments/asm-does-not-exist/findings",
            {"title": "x"},
        )
        assert r.status_code == 404


class TestReports:
    """Shared report store + integrity-verified downloads."""

    def test_shared_store_and_integrity(self, client: TestClient) -> None:
        _login(client)
        ws_id = _make_workspace(client)
        asm_id = _make_assessment(client, ws_id)

        # Generate through the assessments router.
        r = _post(
            client,
            f"/api/v1/assessments/{asm_id}/reports",
            {"format": "html"},
        )
        assert r.status_code == 201, r.text
        html_id = r.json()["id"]
        assert html_id.startswith("rpt-")
        assert len(r.json()["integrity_hash"]) == 64

        # Same report visible through the reports router (shared store).
        r = _get(client, f"/api/v1/assessments/{asm_id}/reports")
        assert r.status_code == 200
        assert any(x["id"] == html_id for x in r.json())
        r = _get(client, "/api/v1/reports")
        assert r.status_code == 200
        assert any(x["id"] == html_id for x in r.json())
        r = _get(client, f"/api/v1/reports?assessment_id={asm_id}")
        assert r.status_code == 200
        assert any(x["id"] == html_id for x in r.json())

        # Detail + verify.
        r = _get(client, f"/api/v1/reports/{html_id}")
        assert r.status_code == 200
        assert r.json()["id"] == html_id
        r = _get(client, f"/api/v1/reports/{html_id}/verify")
        assert r.status_code == 200
        assert r.json()["integrity_valid"] is True

        # Download: integrity headers prove the embedded-hash fix.
        r = _get(client, f"/api/v1/reports/{html_id}")
        stored_hash = r.json()["integrity_hash"]
        r = _get(client, f"/api/v1/reports/{html_id}/download")
        assert r.status_code == 200
        assert r.headers["X-Integrity-Valid"] == "true"
        assert r.headers["X-Integrity-Hash"] == stored_hash
        assert "text/html" in r.headers["content-type"]
        assert "<html" in r.text.lower()

        # Generate through the reports router with the JSON format.
        r = _post(
            client,
            "/api/v1/reports/generate",
            {"assessment_id": asm_id, "format": "json"},
        )
        assert r.status_code == 201, r.text
        json_id = r.json()["id"]

        # Both formats listed for this assessment.
        r = _get(client, f"/api/v1/reports?assessment_id={asm_id}")
        ids = {x["id"] for x in r.json()}
        assert {html_id, json_id} <= ids

        # Unknown report -> 404 everywhere.
        assert _get(client, "/api/v1/reports/rpt-00000000").status_code == 404
        assert _get(client, "/api/v1/reports/rpt-00000000/download").status_code == 404

        # Unsupported format rejected by the request schema (not a 500).
        r = _post(
            client,
            "/api/v1/reports/generate",
            {"assessment_id": asm_id, "format": "pdf"},
        )
        assert r.status_code == 422


class TestDashboardScoping:
    """Dashboard counts are scoped to the requested workspace."""

    def test_workspace_isolation(self, client: TestClient) -> None:
        _login(client)
        ws_a = _make_workspace(client)
        asm_a = _make_assessment(client, ws_a)
        ws_b = _make_workspace(client)  # intentionally empty

        r = _post(
            client,
            f"/api/v1/assessments/{asm_a}/findings",
            {"title": "Critical misconfiguration", "severity": "critical"},
        )
        assert r.status_code == 201, r.text
        r = _post(
            client,
            f"/api/v1/assessments/{asm_a}/evidence",
            {"evidence_type": "manual_note", "title": "ev"},
        )
        assert r.status_code == 201, r.text
        r = _post(
            client,
            f"/api/v1/assessments/{asm_a}/reports",
            {"format": "json"},
        )
        assert r.status_code == 201, r.text

        # Workspace A sees its own data.
        r = _get(client, f"/api/v1/assessments/dashboard?workspace_id={ws_a}")
        assert r.status_code == 200
        dash_a = r.json()
        assert dash_a["total_assessments"] == 1
        assert dash_a["severity_breakdown"]["critical"] == 1
        assert dash_a["evidence_count"] == 1
        assert dash_a["report_count"] == 1

        # Empty workspace B sees nothing — no leakage from A.
        r = _get(client, f"/api/v1/assessments/dashboard?workspace_id={ws_b}")
        assert r.status_code == 200
        dash_b = r.json()
        assert dash_b["total_assessments"] == 0
        assert sum(dash_b["severity_breakdown"].values()) == 0
        assert dash_b["evidence_count"] == 0
        assert dash_b["report_count"] == 0

        # Cross-workspace list filter.
        r = _get(client, f"/api/v1/assessments?workspace_id={ws_b}")
        assert r.status_code == 200
        assert r.json() == []


class TestMiddleware:
    """Security headers, XSS rejection, and rate limiting."""

    def test_security_headers(self, client: TestClient) -> None:
        r = _get(client, "/api/v1/workspaces")  # non-exempt path
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert r.headers["X-Frame-Options"] == "DENY"
        assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
        assert "no-store" in r.headers["Cache-Control"]
        # HTTPS base_url -> HSTS emitted.
        assert "max-age=63072000" in r.headers["Strict-Transport-Security"]
        # Rate limiter stamps every non-exempt response.
        assert r.headers["X-RateLimit-Limit"] == "20"

    def test_xss_payload_rejected(self, client: TestClient) -> None:
        r = _post(
            client,
            "/api/v1/workspaces",
            {"name": "<script>alert(1)</script>"},
        )
        assert r.status_code == 400
        assert "malicious" in r.json()["detail"]

    def test_rate_limit_burst(self, client: TestClient) -> None:
        # A dedicated IP: burst=20, refill 100/min.
        ip = "203.0.113.77"
        statuses = []
        limited = None
        for _ in range(35):
            r = client.get(
                "/api/v1/workspaces",
                headers={"X-Forwarded-For": ip},
            )
            statuses.append(r.status_code)
            if r.status_code == 429 and limited is None:
                limited = r
        assert limited is not None, "burst never exhausted"
        assert limited.headers["X-RateLimit-Remaining"] == "0"
        assert limited.headers["X-RateLimit-Limit"] == "20"
        assert int(limited.headers["Retry-After"]) > 0
        assert statuses[-1] == 429


class TestLifespan:
    """Startup/shutdown hooks run (app factory coverage)."""

    def test_lifespan_context_manager(self) -> None:
        with TestClient(app, base_url="https://testserver") as c:
            r = c.get(
                "/health",
                headers={"X-Forwarded-For": _next_ip()},
            )
            assert r.status_code == 200
