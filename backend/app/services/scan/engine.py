"""Core scan engine for SecureScan Pro X."""

from __future__ import annotations

import asyncio
import socket
import ssl
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

COMMON_PORTS: dict[int, str] = {
    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
    80: "HTTP", 110: "POP3", 111: "RPCBind", 135: "MSRPC", 139: "NetBIOS",
    143: "IMAP", 443: "HTTPS", 445: "SMB", 993: "IMAPS", 995: "POP3S",
    1723: "PPTP", 3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL", 5900: "VNC",
    6379: "Redis", 8080: "HTTP-Proxy", 8443: "HTTPS-Alt", 27017: "MongoDB",
    9200: "Elasticsearch", 5601: "Kibana", 8000: "HTTP-Alt", 8888: "HTTP-Alt",
}


class ScanStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


@dataclass
class PortResult:
    port: int
    service: str
    state: str  # open, closed, filtered
    banner: str | None = None
    response_time_ms: float = 0.0


@dataclass
class HeaderCheckResult:
    header: str
    status: str  # good, weak, missing
    value: str | None = None
    severity: str = "info"
    recommendation: str = ""


@dataclass
class SSLCheckResult:
    protocol_version: str | None = None
    certificate_valid: bool = False
    certificate_issuer: str | None = None
    certificate_expires: str | None = None
    days_until_expiry: int = 0
    weak_cipher: bool = False
    weak_protocol: bool = False
    issues: list[str] = field(default_factory=list)


@dataclass
class PasswordCheckResult:
    score: int = 0  # 0-100
    strength: str = "unknown"  # very_weak, weak, fair, strong, very_strong
    issues: list[str] = field(default_factory=list)
    has_common_pattern: bool = False
    has_sequential: bool = False
    has_repeated: bool = False


@dataclass
class ScanFinding:
    id: str
    title: str
    description: str
    severity: str  # critical, high, medium, low, info
    category: str
    evidence: str = ""
    recommendation: str = ""
    cvss_score: float | None = None
    cwe_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScanResult:
    scan_type: str
    target: str
    status: ScanStatus = ScanStatus.PENDING
    findings: list[ScanFinding] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    started_at: str = ""
    completed_at: str = ""
    duration_seconds: float = 0.0
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class ScanEngine(ABC):
    @abstractmethod
    async def run_port_scan(
        self, target: str, ports: list[int] | None = None, timeout: float = 3.0
    ) -> ScanResult: ...

    @abstractmethod
    async def run_header_check(self, url: str) -> ScanResult: ...

    @abstractmethod
    async def run_password_check(self, demo_mode: bool = True) -> ScanResult: ...

    @abstractmethod
    async def run_ssl_check(self, hostname: str, port: int = 443) -> ScanResult: ...

    @abstractmethod
    async def run_full_scan(
        self, target: str, scan_types: list[str] | None = None
    ) -> dict[str, ScanResult]: ...


class InMemoryScanEngine(ScanEngine):
    def __init__(self, timeout: float = 5.0, max_concurrent: int = 50) -> None:
        self._timeout = timeout
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._scan_history: list[ScanResult] = []

    async def _scan_port(self, host: str, port: int, timeout: float) -> PortResult:
        service = COMMON_PORTS.get(port, f"unknown-{port}")
        async with self._semaphore:
            start = time.time()
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection(host, port),
                    timeout=timeout,
                )
                elapsed = (time.time() - start) * 1000
                writer.close()
                await writer.wait_closed()
                return PortResult(port=port, service=service, state="open", response_time_ms=elapsed)
            except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
                elapsed = (time.time() - start) * 1000
                if isinstance(e := (asyncio.TimeoutError, ConnectionRefusedError, OSError), type):
                    pass
                return PortResult(port=port, service=service, state="closed", response_time_ms=elapsed)

    async def run_port_scan(
        self, target: str, ports: list[int] | None = None, timeout: float = 3.0
    ) -> ScanResult:
        scan_result = ScanResult(scan_type="port_scan", target=target, status=ScanStatus.RUNNING)
        scan_result.started_at = datetime.now(timezone.utc).isoformat()

        if ports is None:
            ports = list(COMMON_PORTS.keys())

        try:
            tasks = [self._scan_port(target, port, timeout) for port in ports]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            open_ports = []
            for r in results:
                if isinstance(r, PortResult):
                    scan_result.evidence.append(
                        f"Port {r.port}/{r.service}: {r.state} ({r.response_time_ms:.1f}ms)"
                    )
                    if r.state == "open":
                        open_ports.append(r)

            for pr in open_ports:
                severity = "info"
                if pr.port in (21, 23, 135, 445, 3389):
                    severity = "high"
                elif pr.port in (22, 25, 110, 143, 3306, 5432, 6379, 27017):
                    severity = "medium"
                elif pr.port in (80, 443, 8080, 8443):
                    severity = "low"

                scan_result.findings.append(ScanFinding(
                    id=f"port-{pr.port}",
                    title=f"Open port {pr.port} ({pr.service})",
                    description=f"Port {pr.port} is open running {pr.service}.",
                    severity=severity,
                    category="network",
                    evidence=f"Port {pr.port}: {pr.state}, response time: {pr.response_time_ms:.1f}ms",
                    recommendation=f"Verify that {pr.service} on port {pr.port} is intentionally exposed and properly secured.",
                ))

            scan_result.metadata["open_port_count"] = len(open_ports)
            scan_result.metadata["scanned_port_count"] = len(ports)
            scan_result.status = ScanStatus.COMPLETED

        except Exception as e:
            scan_result.status = ScanStatus.FAILED
            scan_result.error = str(e)
            logger.error("port_scan_failed", target=target, error=str(e))

        scan_result.completed_at = datetime.now(timezone.utc).isoformat()
        if scan_result.started_at:
            started = datetime.fromisoformat(scan_result.started_at)
            completed = datetime.fromisoformat(scan_result.completed_at)
            scan_result.duration_seconds = (completed - started).total_seconds()

        self._scan_history.append(scan_result)
        return scan_result

    async def run_header_check(self, url: str) -> ScanResult:
        import httpx

        scan_result = ScanResult(scan_type="header_check", target=url, status=ScanStatus.RUNNING)
        scan_result.started_at = datetime.now(timezone.utc).isoformat()

        security_headers = {
            "Content-Security-Policy": {
                "severity": "high",
                "cwe": "CWE-693",
                "rec": "Implement a Content-Security-Policy header to prevent XSS attacks.",
            },
            "Strict-Transport-Security": {
                "severity": "high",
                "cwe": "CWE-319",
                "rec": "Enable HSTS with a minimum max-age of 31536000.",
            },
            "X-Frame-Options": {
                "severity": "medium",
                "cwe": "CWE-1021",
                "rec": "Set X-Frame-Options to DENY or SAMEORIGIN to prevent clickjacking.",
            },
            "X-Content-Type-Options": {
                "severity": "medium",
                "cwe": "CWE-693",
                "rec": "Set X-Content-Type-Options to nosniff.",
            },
            "X-XSS-Protection": {
                "severity": "low",
                "cwe": "CWE-79",
                "rec": "Set X-XSS-Protection to 1; mode=block (legacy browsers).",
            },
            "Referrer-Policy": {
                "severity": "low",
                "cwe": "CWE-200",
                "rec": "Set Referrer-Policy to strict-origin-when-cross-origin.",
            },
            "Permissions-Policy": {
                "severity": "low",
                "cwe": "CWE-693",
                "rec": "Set Permissions-Policy to restrict unnecessary browser features.",
            },
        }

        try:
            if not url.startswith(("http://", "https://")):
                url = f"https://{url}"

            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
                response = await client.get(url)
                scan_result.evidence.append(f"HTTP {response.status_code} from {url}")

                headers = {k.lower(): v for k, v in response.headers.items()}

                for header_name, config in security_headers.items():
                    header_lower = header_name.lower()
                    if header_lower in headers:
                        value = headers[header_lower]
                        status_str = "good"
                        severity = "info"
                        if header_lower == "strict-transport-security":
                            if "max-age=" in value:
                                try:
                                    max_age = int(value.split("max-age=")[1].split(";")[0])
                                    if max_age < 31536000:
                                        status_str = "weak"
                                        severity = "low"
                                except (ValueError, IndexError):
                                    status_str = "weak"
                                    severity = "low"
                        elif header_lower == "content-security-policy":
                            if "unsafe-inline" in value or "unsafe-eval" in value:
                                status_str = "weak"
                                severity = "low"

                        scan_result.findings.append(ScanFinding(
                            id=f"header-{header_lower}",
                            title=f"{header_name} header: {status_str}",
                            description=f"The {header_name} header is present and {status_str}.",
                            severity=severity,
                            category="headers",
                            evidence=f"{header_name}: {value[:200]}",
                            recommendation="" if status_str == "good" else config["rec"],
                            cwe_id=config["cwe"],
                        ))
                    else:
                        scan_result.findings.append(ScanFinding(
                            id=f"header-{header_lower}",
                            title=f"Missing {header_name} header",
                            description=f"The {header_name} header is not set.",
                            severity=config["severity"],
                            category="headers",
                            evidence=f"Header '{header_name}' not found in response.",
                            recommendation=config["rec"],
                            cwe_id=config["cwe"],
                        ))

                scan_result.status = ScanStatus.COMPLETED

        except httpx.ConnectError:
            scan_result.status = ScanStatus.FAILED
            scan_result.error = f"Could not connect to {url}"
        except Exception as e:
            scan_result.status = ScanStatus.FAILED
            scan_result.error = str(e)
            logger.error("header_check_failed", url=url, error=str(e))

        scan_result.completed_at = datetime.now(timezone.utc).isoformat()
        self._scan_history.append(scan_result)
        return scan_result

    async def run_password_check(self, demo_mode: bool = True) -> ScanResult:
        scan_result = ScanResult(
            scan_type="password_check",
            target="demo" if demo_mode else "config",
            status=ScanStatus.RUNNING,
        )
        scan_result.started_at = datetime.now(timezone.utc).isoformat()

        demo_passwords = [
            ("password", "Very common password"),
            ("admin123", "Contains common username pattern"),
            ("123456", "Sequential numbers"),
            ("qwerty", "Keyboard pattern"),
            ("letmein", "Common dictionary word"),
        ]

        common_passwords = {
            "password", "123456", "12345678", "qwerty", "abc123",
            "monkey", "master", "dragon", "login", "princess",
            "football", "shadow", "sunshine", "trustno1", "iloveyou",
            "batman", "access", "hello", "charlie", "letmein",
            "welcome", "password1", "admin", "passw0rd", "p@ssw0rd",
        }

        for pwd, note in demo_passwords:
            score, strength, issues = self._check_password_strength(pwd, common_passwords)
            scan_result.findings.append(ScanFinding(
                id=f"pwd-demo-{note[:20]}",
                title=f"Password strength: {strength} - {note}",
                description=f"Demo password analysis: {', '.join(issues)}",
                severity="critical" if score < 20 else "high" if score < 40 else "medium" if score < 60 else "low",
                category="password",
                evidence=f"Score: {score}/100. Issues: {', '.join(issues)}",
                recommendation="Use passwords with 16+ characters, mixed case, numbers, and symbols.",
                metadata={"score": score, "strength": strength, "demo": True},
            ))

        scan_result.evidence.append("Password check completed in demo mode")
        scan_result.status = ScanStatus.COMPLETED
        scan_result.completed_at = datetime.now(timezone.utc).isoformat()
        self._scan_history.append(scan_result)
        return scan_result

    def _check_password_strength(
        self, password: str, common_set: set[str] | None = None
    ) -> tuple[int, str, list[str]]:
        score = 0
        issues: list[str] = []

        if len(password) >= 8:
            score += 10
        if len(password) >= 12:
            score += 15
        if len(password) >= 16:
            score += 15
        if len(password) >= 20:
            score += 10

        if any(c.islower() for c in password):
            score += 5
        else:
            issues.append("No lowercase letters")
        if any(c.isupper() for c in password):
            score += 5
        else:
            issues.append("No uppercase letters")
        if any(c.isdigit() for c in password):
            score += 5
        else:
            issues.append("No digits")
        special = sum(1 for c in password if not c.isalnum())
        if special >= 2:
            score += 10
        elif special == 1:
            score += 5
        else:
            issues.append("No special characters")

        if common_set and password.lower() in common_set:
            score = max(0, score - 50)
            issues.append("Commonly used password")

        for pattern in ["123456", "abcdef", "qwerty", "asdfgh", "zxcvbn"]:
            if pattern in password.lower():
                score = max(0, score - 20)
                issues.append(f"Contains keyboard/sequential pattern")
                break

        for i in range(len(password) - 2):
            if ord(password[i]) + 1 == ord(password[i + 1]) == ord(password[i + 2]) - 1:
                score = max(0, score - 10)
                issues.append("Contains sequential characters")
                break

        for i in range(len(password) - 2):
            if password[i] == password[i + 1] == password[i + 2]:
                score = max(0, score - 10)
                issues.append("Contains repeated characters")
                break

        score = min(100, max(0, score))

        if score >= 80:
            strength = "very_strong"
        elif score >= 60:
            strength = "strong"
        elif score >= 40:
            strength = "fair"
        elif score >= 20:
            strength = "weak"
        else:
            strength = "very_weak"

        return score, strength, issues

    async def run_ssl_check(self, hostname: str, port: int = 443) -> ScanResult:
        scan_result = ScanResult(scan_type="ssl_check", target=f"{hostname}:{port}", status=ScanStatus.RUNNING)
        scan_result.started_at = datetime.now(timezone.utc).isoformat()

        try:
            context = ssl.create_default_context()
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(hostname, port, ssl=context),
                timeout=self._timeout,
            )

            ssl_object = writer.get_extra_info("ssl_object")
            if ssl_object:
                cert = ssl_object.getpeercert()
                protocol = ssl_object.version()
                cipher = ssl_object.cipher()

                not_after = cert.get("notAfter", "")
                not_before = cert.get("notBefore", "")
                issuer = dict(x[0] for x in cert.get("issuer", ()))
                subject = dict(x[0] for x in cert.get("subject", ()))

                cert_valid = True
                days_left = 0
                if not_after:
                    from email.utils import parsedate_to_datetime
                    expiry = parsedate_to_datetime(not_after)
                    days_left = (expiry.replace(tzinfo=None) - datetime.utcnow()).days
                    cert_valid = days_left > 0

                weak_protocols = ["TLSv1", "TLSv1.1", "SSLv3", "SSLv2"]
                is_weak_protocol = any(p in (protocol or "") for p in weak_protocols)

                weak_ciphers = ["RC4", "DES", "3DES", "NULL", "EXPORT", "MD5"]
                cipher_name = cipher[0] if cipher else ""
                is_weak_cipher = any(w in cipher_name.upper() for w in weak_ciphers)

                issues = []
                if is_weak_protocol:
                    issues.append(f"Weak protocol: {protocol}")
                    scan_result.findings.append(ScanFinding(
                        id="ssl-weak-protocol",
                        title=f"Weak SSL/TLS protocol: {protocol}",
                        description=f"Server supports {protocol} which has known vulnerabilities.",
                        severity="high",
                        category="ssl",
                        cwe_id="CWE-327",
                        recommendation="Disable TLS 1.0/1.1 and SSLv3. Use TLS 1.2+ only.",
                    ))

                if is_weak_cipher:
                    issues.append(f"Weak cipher: {cipher_name}")
                    scan_result.findings.append(ScanFinding(
                        id="ssl-weak-cipher",
                        title=f"Weak cipher suite: {cipher_name}",
                        description=f"Server uses cipher suite {cipher_name} with known weaknesses.",
                        severity="high",
                        category="ssl",
                        cwe_id="CWE-327",
                        recommendation="Use strong cipher suites (AES-256-GCM, ChaCha20).",
                    ))

                if not cert_valid:
                    issues.append("Certificate expired")
                    scan_result.findings.append(ScanFinding(
                        id="ssl-expired-cert",
                        title="SSL certificate expired",
                        description="The SSL certificate has expired.",
                        severity="critical",
                        category="ssl",
                        cwe_id="CWE-295",
                        recommendation="Renew the SSL certificate immediately.",
                    ))
                elif days_left < 30:
                    scan_result.findings.append(ScanFinding(
                        id="ssl-expiring-cert",
                        title=f"SSL certificate expires in {days_left} days",
                        description="The SSL certificate will expire soon.",
                        severity="medium",
                        category="ssl",
                        cwe_id="CWE-295",
                        recommendation="Renew the SSL certificate before it expires.",
                    ))

                scan_result.evidence.extend([
                    f"Protocol: {protocol}",
                    f"Cipher: {cipher_name}",
                    f"Certificate issuer: {issuer.get('organizationName', 'Unknown')}",
                    f"Certificate subject: {subject.get('commonName', 'Unknown')}",
                    f"Expires: {not_after} ({days_left} days)",
                    f"Valid: {cert_valid}",
                ])

                scan_result.metadata.update({
                    "protocol": protocol,
                    "cipher": cipher_name,
                    "issuer": issuer,
                    "subject": subject,
                    "expires": not_after,
                    "days_until_expiry": days_left,
                    "certificate_valid": cert_valid,
                })

            writer.close()
            await writer.wait_closed()
            scan_result.status = ScanStatus.COMPLETED

        except Exception as e:
            scan_result.status = ScanStatus.FAILED
            scan_result.error = str(e)
            logger.error("ssl_check_failed", hostname=hostname, error=str(e))

        scan_result.completed_at = datetime.now(timezone.utc).isoformat()
        self._scan_history.append(scan_result)
        return scan_result

    async def run_full_scan(
        self, target: str, scan_types: list[str] | None = None
    ) -> dict[str, ScanResult]:
        if scan_types is None:
            scan_types = ["port_scan", "header_check", "ssl_check"]

        results: dict[str, ScanResult] = {}

        if "port_scan" in scan_types:
            results["port_scan"] = await self.run_port_scan(target)
        if "header_check" in scan_types:
            url = target if target.startswith("http") else f"https://{target}"
            results["header_check"] = await self.run_header_check(url)
        if "ssl_check" in scan_types:
            host = target.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
            results["ssl_check"] = await self.run_ssl_check(host)

        return results

    def get_scan_history(self) -> list[ScanResult]:
        return list(self._scan_history)
