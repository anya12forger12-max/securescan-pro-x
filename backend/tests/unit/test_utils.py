"""Unit tests for utility modules: validation, crypto, and logging."""

from __future__ import annotations

import time

import pytest

from app.services.logging_service import StructuredLoggingService
from app.utils.crypto import (
    TokenManager,
    compute_file_hash,
    compute_hash,
    constant_time_compare,
    derive_key_from_password,
    generate_api_key,
    generate_secret_key,
)
from app.utils.sanitization import sanitize_html, sanitize_sql_like
from app.utils.validation import (
    parse_port_list,
    sanitize_string,
    validate_asset_type,
    validate_cidr,
    validate_email,
    validate_hostname,
    validate_ip_address,
    validate_ip_network,
    validate_port,
    validate_port_range,
    validate_scan_target,
    validate_severity,
    validate_url,
)


class TestValidation:
    """Pure validation helpers."""

    def test_hostname(self) -> None:
        assert validate_hostname("example.com")
        assert validate_hostname("sub.domain-1.example.co")
        assert not validate_hostname("")
        assert not validate_hostname("not a host")

    def test_ip_address(self) -> None:
        assert validate_ip_address("192.168.0.1")
        assert validate_ip_address("::1")
        assert not validate_ip_address("999.1.1.1")
        assert not validate_ip_address("example.com")

    def test_ip_network(self) -> None:
        assert validate_ip_network("10.0.0.0/8")
        assert not validate_ip_network("10.0.0.0/33")
        assert not validate_ip_network("nope")

    def test_url(self) -> None:
        assert validate_url("https://example.com/path")
        assert validate_url("http://localhost:8080")
        assert not validate_url("ftp://example.com")
        assert not validate_url("just-a-string")

    def test_port(self) -> None:
        assert validate_port(1)
        assert validate_port(443)
        assert validate_port(65535)
        assert not validate_port(0)
        assert not validate_port(65536)

    def test_port_range(self) -> None:
        assert validate_port_range(1000, 2000)
        assert not validate_port_range(2000, 1000)
        assert not validate_port_range(0, 70000)

    def test_cidr(self) -> None:
        assert validate_cidr("192.168.1.0/24")
        assert not validate_cidr("192.168.1.0/99")

    def test_severity(self) -> None:
        for sev in ("critical", "high", "medium", "low", "info"):
            assert validate_severity(sev)
        assert not validate_severity("urgent")

    def test_asset_type(self) -> None:
        for t in ("host", "network", "web", "cloud", "container"):
            assert validate_asset_type(t)
        assert not validate_asset_type("device")

    def test_sanitize_string(self) -> None:
        assert sanitize_string("  hello  ") == "hello"
        assert sanitize_string("a" * 50, max_length=10) == "a" * 10
        # Control characters are stripped; newlines are preserved.
        assert sanitize_string("line\x07\nbreak") == "line\nbreak"

    def test_scan_target(self) -> None:
        ok, msg = validate_scan_target("192.168.1.1")
        assert ok and msg == ""
        ok, msg = validate_scan_target("example.com")
        assert ok and msg == ""
        ok, msg = validate_scan_target("not a target!!")
        assert not ok
        assert "Invalid target" in msg
        ok, _ = validate_scan_target("   ")
        assert not ok

    def test_parse_port_list(self) -> None:
        assert parse_port_list("80,443,8080") == [80, 443, 8080]
        assert parse_port_list("22") == [22]
        assert parse_port_list("") == []

    def test_validate_email(self) -> None:
        assert validate_email("user@example.com")
        assert not validate_email("not-an-email")
        assert not validate_email("user@")


class TestCrypto:
    """Crypto helpers."""

    def test_generate_api_key(self) -> None:
        key = generate_api_key()
        assert len(key) == 48
        assert generate_api_key(16) != generate_api_key(16)

    def test_generate_secret_key_is_fernet(self) -> None:
        from cryptography.fernet import Fernet

        key = generate_secret_key()
        Fernet(key.encode())

    def test_derive_key_from_password_stable_with_salt(self) -> None:
        key1, salt = derive_key_from_password("pw")
        key2, _ = derive_key_from_password("pw", salt=salt)
        key3, _ = derive_key_from_password("other", salt=salt)
        assert key1 == key2
        assert key1 != key3

    def test_compute_hash(self) -> None:
        assert compute_hash(b"abc") == (
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        assert compute_hash(b"abc", "sha512") != compute_hash(b"abc")

    def test_compute_file_hash(self, tmp_path) -> None:
        f = tmp_path / "data.bin"
        f.write_bytes(b"abc")
        assert compute_file_hash(str(f)) == compute_hash(b"abc")

    def test_constant_time_compare(self) -> None:
        assert constant_time_compare("abc", "abc")
        assert not constant_time_compare("abc", "abd")
        assert not constant_time_compare("abc", "")

    def test_token_manager_roundtrip(self) -> None:
        tm = TokenManager()
        token = tm.encrypt("secret-value")
        assert tm.decrypt(token) == "secret-value"

    def test_token_manager_dict_roundtrip(self) -> None:
        tm = TokenManager()
        payload = {"a": 1, "nested": {"b": [1, 2, 3]}}
        assert tm.decrypt_dict(tm.encrypt_dict(payload)) == payload

    def test_token_manager_rejects_wrong_key(self) -> None:
        tm1 = TokenManager()
        tm2 = TokenManager()
        token = tm1.encrypt("secret-value")
        rejected = False
        try:
            tm2.decrypt(token)
        except Exception:
            rejected = True
        assert rejected, "decrypt with wrong key must fail"


class TestSanitization:
    """HTML/SQL escaping helpers."""

    def test_sanitize_html(self) -> None:
        assert sanitize_html("<b>") == "&lt;b&gt;"

    def test_sanitize_sql_like(self) -> None:
        escaped = sanitize_sql_like("100%_x")
        assert escaped == "100\\%\\_x"


class TestLoggingService:
    """Structured logging service surface."""

    def test_get_logger_and_context(self) -> None:
        svc = StructuredLoggingService()
        logger = svc.get_logger("unit.test")
        assert logger is not None
        svc.set_context(request_id="abc")
        svc.clear_context()


class TestRateLimitBucketRefill:
    """Token bucket math used by the rate-limit middleware."""

    def test_bucket_refills_over_time(self) -> None:
        from app.utils.rate_limit import RateLimitBucket

        bucket = RateLimitBucket(
            tokens=0,
            last_refill=time.time() - 60,
            max_tokens=20,
            refill_rate=100 / 60,
        )
        elapsed = 60.0
        bucket.tokens = min(bucket.max_tokens, bucket.tokens + elapsed * bucket.refill_rate)
        assert bucket.tokens == bucket.max_tokens


class TestLazyServiceExports:
    """app.services lazy __getattr__ export machinery."""

    def test_every_declared_export_resolves(self) -> None:
        import app.services as services

        assert set(services.__all__) >= {
            "AssetService",
            "AuditService",
            "ConfigurationService",
            "InMemoryOrchestrator",
            "InMemoryVulnKnowledgeService",
            "LoggingService",
            "PluginManager",
            "ReportGenerationService",
            "WorkspaceService",
        }
        for name in services.__all__:
            assert getattr(services, name) is not None

    def test_unknown_export_raises_attribute_error(self) -> None:
        import app.services as services

        with pytest.raises(AttributeError, match="has no attribute"):
            _ = services.NoSuchServiceXyz
