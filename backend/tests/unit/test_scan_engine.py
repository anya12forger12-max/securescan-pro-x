"""Unit tests for the scan engine against local (offline) targets.

No external network access: ports are bound on 127.0.0.1 and the TLS
server is a self-signed localhost chain trusted only for this test.
"""

from __future__ import annotations

import asyncio
import ssl
import subprocess
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

from app.services.scan.engine import InMemoryScanEngine, ScanStatus


def _run(*args: str) -> None:
    subprocess.run(args, check=True, capture_output=True)  # noqa: S603


def _make_local_chain(tmp_path) -> tuple[str, str]:
    """Create CA + leaf cert (SAN=IP:127.0.0.1); returns (ca, leaf) paths."""
    ca_key = tmp_path / "ca.key"
    ca_pem = tmp_path / "ca.pem"
    leaf_key = tmp_path / "leaf.key"
    leaf_csr = tmp_path / "leaf.csr"
    leaf_pem = tmp_path / "leaf.pem"
    ext = tmp_path / "ext.cnf"
    ext.write_text(
        "[v3]\n"
        "subjectAltName=IP:127.0.0.1\n"
        "basicConstraints=CA:FALSE\n"
        "keyUsage=digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n"
    )

    _run(
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(ca_key),
        "-out",
        str(ca_pem),
        "-days",
        "30",
        "-subj",
        "/CN=SSX Test CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,digitalSignature,keyCertSign,cRLSign",
    )
    _run(
        "openssl",
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(leaf_key),
        "-out",
        str(leaf_csr),
        "-subj",
        "/CN=127.0.0.1",
    )
    _run(
        "openssl",
        "x509",
        "-req",
        "-in",
        str(leaf_csr),
        "-CA",
        str(ca_pem),
        "-CAkey",
        str(ca_key),
        "-CAcreateserial",
        "-days",
        "30",
        "-out",
        str(leaf_pem),
        "-extfile",
        str(ext),
        "-extensions",
        "v3",
    )
    return str(ca_pem), str(leaf_pem)


class TestPortScan:
    async def test_open_and_closed_ports(self) -> None:
        # A port we actually listen on (detected "open").
        open_srv = await asyncio.start_server(lambda _r, w: w.close(), "127.0.0.1", 0)
        open_port = open_srv.sockets[0].getsockname()[1]
        # A port nobody listens on (detected "closed").
        closed_probe = await asyncio.start_server(lambda _r, w: w.close(), "127.0.0.1", 0)
        closed_port = closed_probe.sockets[0].getsockname()[1]
        closed_probe.close()
        await closed_probe.wait_closed()

        engine = InMemoryScanEngine()
        result = await engine.run_port_scan(
            target="127.0.0.1",
            ports=[open_port, closed_port],
            timeout=1.0,
        )
        open_srv.close()
        await open_srv.wait_closed()

        assert result.status == ScanStatus.COMPLETED
        assert result.metadata["scanned_port_count"] == 2
        assert result.metadata["open_port_count"] == 1
        assert any(f.id == f"port-{open_port}" for f in result.findings)
        assert len(result.evidence) == 2
        assert result.duration_seconds >= 0.0
        assert result in engine.get_scan_history()

    async def test_all_closed(self) -> None:
        engine = InMemoryScanEngine()
        probe = await asyncio.start_server(lambda _r, w: w.close(), "127.0.0.1", 0)
        port = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()

        result = await engine.run_port_scan(target="127.0.0.1", ports=[port], timeout=1.0)
        assert result.status == ScanStatus.COMPLETED
        assert result.metadata["open_port_count"] == 0
        assert result.findings == []


class TestHeaderCheck:
    async def test_local_server_missing_security_headers(
        self,
        local_http_server: str,
    ) -> None:
        engine = InMemoryScanEngine()
        result = await engine.run_header_check(url=local_http_server)
        assert result.status == ScanStatus.COMPLETED
        titles = [f.title for f in result.findings]
        # Server sends X-Frame-Options but no CSP/HSTS.
        assert any(t == "Missing Content-Security-Policy header" for t in titles)
        assert any(t == "Missing Strict-Transport-Security header" for t in titles)
        assert any(t == "X-Frame-Options header: good" for t in titles)
        assert sum(1 for t in titles if t.startswith("Missing ")) >= 5
        assert result.evidence

    async def test_connection_failure_reports_error(self) -> None:
        probe = await asyncio.start_server(lambda _r, w: w.close(), "127.0.0.1", 0)
        port = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()

        engine = InMemoryScanEngine()
        result = await engine.run_header_check(url=f"http://127.0.0.1:{port}")
        assert result.status == ScanStatus.FAILED
        assert result.error
        assert "Could not connect" in result.error


class TestSslCheck:
    async def test_trusted_local_tls_server(
        self,
        tmp_path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Full certificate parsing path against a locally-trusted chain."""
        ca_pem, leaf_pem = _make_local_chain(tmp_path)
        monkeypatch.setenv("SSL_CERT_FILE", ca_pem)

        server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_ctx.load_cert_chain(certfile=leaf_pem, keyfile=str(tmp_path / "leaf.key"))

        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            writer.write(b"ok")
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(handler, "127.0.0.1", 0, ssl=server_ctx)
        port = server.sockets[0].getsockname()[1]

        try:
            engine = InMemoryScanEngine(timeout=5.0)
            result = await engine.run_ssl_check(hostname="127.0.0.1", port=port)
        finally:
            server.close()
            await server.wait_closed()

        assert result.status == ScanStatus.COMPLETED, result.error
        assert result.metadata["certificate_valid"] is True
        assert result.metadata["protocol"].startswith("TLS")
        assert result.metadata["cipher"]
        assert result.metadata["subject"]["commonName"] == "127.0.0.1"
        assert any(e.startswith("Protocol:") for e in result.evidence)
        assert any(e.startswith("Expires:") for e in result.evidence)

    async def test_connection_refused_reports_failure(self) -> None:
        probe = await asyncio.start_server(lambda _r, w: w.close(), "127.0.0.1", 0)
        port = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()

        engine = InMemoryScanEngine()
        result = await engine.run_ssl_check(hostname="127.0.0.1", port=port)
        assert result.status == ScanStatus.FAILED
        assert result.error


class TestFullScan:
    async def test_dispatches_selected_scan_types(self) -> None:
        engine = InMemoryScanEngine()
        results = await engine.run_full_scan(
            target="127.0.0.1",
            scan_types=["port_scan", "ssl_check"],
        )
        assert set(results) == {"port_scan", "ssl_check"}
        assert results["ssl_check"].status == ScanStatus.FAILED  # nothing listening

    async def test_default_scan_types(self) -> None:
        engine = InMemoryScanEngine()
        results = await engine.run_full_scan(target="127.0.0.1")
        assert set(results) == {"port_scan", "header_check", "ssl_check"}
