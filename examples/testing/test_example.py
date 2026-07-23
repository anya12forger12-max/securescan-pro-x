"""Example test suite demonstrating MHCP testing patterns.

This file shows unit, integration, and property-based testing
patterns used throughout the Malware Hash Checker Pro codebase.

Run with:
    pytest test_example.py -v
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from mhcp_core.errors import (
    HashError,
    MHCError,
    ScannerError,
    Severity,
)
from mhcp_core.result import Err, Ok, Result
from mhcp_database.connection import DatabaseConnection
from mhcp_database.models import HashRecord
from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_hashing.computer import HashComputer
from mhcp_hashing.validator import (
    is_valid_hex,
    normalize_hash,
    validate_hash_format,
)
from mhcp_security.path_safety import is_safe_path, sanitize_path

from conftest_example import MD5_TEST, SHA256_EMPTY, SHA256_HELLO, SHA256_SAMPLE_1K


# ═══════════════════════════════════════════════════════════════════
# Unit Tests — HashAlgorithm
# ═══════════════════════════════════════════════════════════════════

class TestHashAlgorithm:
    """Tests for the HashAlgorithm enum."""

    @pytest.mark.unit
    def test_all_algorithms_exist(self) -> None:
        """All five algorithms are defined."""
        algorithms = HashAlgorithm.supported_algorithms()
        assert len(algorithms) == 5

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "algorithm,expected_hex_length",
        [
            (HashAlgorithm.MD5, 32),
            (HashAlgorithm.SHA1, 40),
            (HashAlgorithm.SHA256, 64),
            (HashAlgorithm.SHA384, 96),
            (HashAlgorithm.SHA512, 128),
        ],
    )
    def test_hex_digest_length(
        self, algorithm: HashAlgorithm, expected_hex_length: int
    ) -> None:
        """Hex digest length matches the expected character count."""
        assert algorithm.hex_digest_length == expected_hex_length

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "algorithm,expected_display",
        [
            (HashAlgorithm.MD5, "MD5"),
            (HashAlgorithm.SHA1, "SHA-1"),
            (HashAlgorithm.SHA256, "SHA-256"),
            (HashAlgorithm.SHA384, "SHA-384"),
            (HashAlgorithm.SHA512, "SHA-512"),
        ],
    )
    def test_display_name(self, algorithm: HashAlgorithm, expected_display: str) -> None:
        """Display name matches the human-readable label."""
        assert algorithm.display_name == expected_display

    @pytest.mark.unit
    def test_recommended_algorithms(self) -> None:
        """SHA-256, SHA-384, and SHA-512 are recommended."""
        assert HashAlgorithm.SHA256.is_recommended
        assert HashAlgorithm.SHA384.is_recommended
        assert HashAlgorithm.SHA512.is_recommended

    @pytest.mark.unit
    def test_legacy_algorithms(self) -> None:
        """MD5 and SHA-1 are legacy."""
        assert HashAlgorithm.MD5.is_legacy
        assert HashAlgorithm.SHA1.is_legacy
        assert not HashAlgorithm.SHA256.is_legacy

    @pytest.mark.unit
    def test_from_string_variants(self) -> None:
        """from_string accepts flexible input formats."""
        assert HashAlgorithm.from_string("sha256") is HashAlgorithm.SHA256
        assert HashAlgorithm.from_string("SHA-256") is HashAlgorithm.SHA256
        assert HashAlgorithm.from_string("SHA 256") is HashAlgorithm.SHA256
        assert HashAlgorithm.from_string("md5") is HashAlgorithm.MD5

    @pytest.mark.unit
    def test_from_string_unknown(self) -> None:
        """from_string raises ValueError for unknown algorithms."""
        with pytest.raises(ValueError, match="Unknown hash algorithm"):
            HashAlgorithm.from_string("blake3")


# ═══════════════════════════════════════════════════════════════════
# Unit Tests — Hash Validation
# ═══════════════════════════════════════════════════════════════════

class TestHashValidation:
    """Tests for hash format validation utilities."""

    @pytest.mark.unit
    def test_is_valid_hex(self) -> None:
        """Valid hex strings pass validation."""
        assert is_valid_hex("a1b2c3")
        assert is_valid_hex("0123456789abcdef")
        assert is_valid_hex("ABCD")

    @pytest.mark.unit
    def test_is_valid_hex_invalid(self) -> None:
        """Non-hex strings and empty strings fail validation."""
        assert not is_valid_hex("")
        assert not is_valid_hex("xyz")
        assert not is_valid_hex("g0ggle")

    @pytest.mark.unit
    def test_normalize_hash(self) -> None:
        """normalize_hash strips whitespace and lowercases."""
        assert normalize_hash("  ABCD  ") == "abcd"
        assert normalize_hash("0123456789ABCDEF") == "0123456789abcdef"

    @pytest.mark.unit
    def test_normalize_hash_invalid(self) -> None:
        """normalize_hash raises ValueError on non-hex input."""
        with pytest.raises(ValueError, match="non-hex"):
            normalize_hash("not-a-hash")

    @pytest.mark.unit
    def test_validate_hash_format(self) -> None:
        """Correct-length hex strings validate for their algorithm."""
        sha256_hex = "a" * 64
        assert validate_hash_format(sha256_hex, HashAlgorithm.SHA256)

        md5_hex = "b" * 32
        assert validate_hash_format(md5_hex, HashAlgorithm.MD5)

    @pytest.mark.unit
    def test_validate_hash_format_wrong_length(self) -> None:
        """Wrong-length strings fail validation."""
        assert not validate_hash_format("a" * 32, HashAlgorithm.SHA256)
        assert not validate_hash_format("b" * 64, HashAlgorithm.MD5)


# ═══════════════════════════════════════════════════════════════════
# Unit Tests — Result Type
# ═══════════════════════════════════════════════════════════════════

class TestResultType:
    """Tests for the Ok/Err result monad."""

    @pytest.mark.unit
    def test_ok_is_ok(self) -> None:
        """Ok variant reports is_ok() == True."""
        result: Result[int, Exception] = Ok(42)
        assert result.is_ok()
        assert not result.is_err()

    @pytest.mark.unit
    def test_ok_unwrap(self) -> None:
        """Ok.unwrap() returns the contained value."""
        result: Result[str, Exception] = Ok("hello")
        assert result.unwrap() == "hello"

    @pytest.mark.unit
    def test_err_is_err(self) -> None:
        """Err variant reports is_err() == True."""
        result: Result[int, ValueError] = Err(ValueError("bad"))
        assert result.is_err()
        assert not result.is_ok()

    @pytest.mark.unit
    def test_err_unwrap_raises(self) -> None:
        """Err.unwrap() raises the contained exception."""
        exc = ValueError("nope")
        result: Result[int, ValueError] = Err(exc)
        with pytest.raises(ValueError, match="nope"):
            result.unwrap()

    @pytest.mark.unit
    def test_ok_unwrap_or(self) -> None:
        """unwrap_or returns the value on Ok."""
        result: Result[int, Exception] = Ok(10)
        assert result.unwrap_or(0) == 10

    @pytest.mark.unit
    def test_err_unwrap_or_default(self) -> None:
        """unwrap_or returns the default on Err."""
        result: Result[int, Exception] = Err(RuntimeError())
        assert result.unwrap_or(99) == 99

    @pytest.mark.unit
    def test_map_transforms_ok(self) -> None:
        """map applies a function to the Ok value."""
        result: Result[int, Exception] = Ok(5)
        mapped = result.map(lambda x: x * 2)
        assert mapped.unwrap() == 10

    @pytest.mark.unit
    def test_map_propagates_err(self) -> None:
        """map does not touch Err variants."""
        result: Result[int, Exception] = Err(RuntimeError("fail"))
        mapped = result.map(lambda x: x * 2)
        assert mapped.is_err()

    @pytest.mark.unit
    def test_flat_map_chain(self) -> None:
        """flat_map chains Result-returning functions."""
        def parse(raw: str) -> Result[int, ValueError]:
            try:
                return Ok(int(raw))
            except ValueError:
                return Err(ValueError(f"bad: {raw}"))

        def double(n: int) -> Result[int, ValueError]:
            return Ok(n * 2)

        result = parse("21").flat_map(double)
        assert result.unwrap() == 42

    @pytest.mark.unit
    def test_flat_map_error_propagation(self) -> None:
        """flat_map short-circuits on Err."""
        def fail(raw: str) -> Result[int, ValueError]:
            return Err(ValueError("always fails"))

        result = Ok(1).flat_map(fail)
        assert result.is_err()

    @pytest.mark.unit
    def test_from_optional(self) -> None:
        """from_optional wraps non-None values as Ok."""
        assert Result.from_optional("x", RuntimeError()).is_ok()
        assert Result.from_optional(None, RuntimeError()).is_err()

    @pytest.mark.unit
    def test_equality(self) -> None:
        """Ok values are equal when contents match."""
        assert Ok(1) == Ok(1)
        assert Ok(1) != Ok(2)
        assert Ok(1) != Err(ValueError())

    @pytest.mark.unit
    def test_repr(self) -> None:
        """repr shows the variant and contained value."""
        assert "Ok" in repr(Ok(42))
        assert "Err" in repr(Err(RuntimeError()))


# ═══════════════════════════════════════════════════════════════════
# Unit Tests — Error Hierarchy
# ═══════════════════════════════════════════════════════════════════

class TestErrorHierarchy:
    """Tests for the MHCError hierarchy."""

    @pytest.mark.unit
    def test_mhcp_error_base(self) -> None:
        """MHCError carries error_code, severity, and recovery_suggestion."""
        err = MHCError(
            message="test error",
            error_code="TEST",
            severity=Severity.WARNING,
            recovery_suggestion="try again",
        )
        assert str(err) == "test error"
        assert err.error_code == "TEST"
        assert err.severity is Severity.WARNING
        assert err.recovery_suggestion == "try again"

    @pytest.mark.unit
    def test_mhcp_error_to_dict(self) -> None:
        """to_dict serialises the error for structured logging."""
        err = MHCError(message="boom", error_code="BOOM", severity=Severity.ERROR)
        d = err.to_dict()
        assert d["error_type"] == "MHCError"
        assert d["error_code"] == "BOOM"
        assert d["severity"] == "error"

    @pytest.mark.unit
    def test_subclass_hierarchy(self) -> None:
        """All error subclasses inherit from MHCError."""
        assert issubclass(HashError, MHCError)
        assert issubclass(ScannerError, MHCError)

    @pytest.mark.unit
    def test_hash_error_creation(self) -> None:
        """HashError can be raised and caught."""
        with pytest.raises(HashError) as exc_info:
            raise HashError(
                message="digest failed",
                error_code="HASH_FAILED",
                severity=Severity.ERROR,
            )
        assert exc_info.value.error_code == "HASH_FAILED"

    @pytest.mark.unit
    def test_severity_values(self) -> None:
        """Severity enum has all four expected levels."""
        assert Severity.CRITICAL.value == "critical"
        assert Severity.ERROR.value == "error"
        assert Severity.WARNING.value == "warning"
        assert Severity.INFO.value == "info"


# ═══════════════════════════════════════════════════════════════════
# Integration Tests — Database
# ═══════════════════════════════════════════════════════════════════

class TestDatabaseIntegration:
    """Integration tests for DatabaseConnection and HashRecord."""

    @pytest.mark.integration
    def test_connection_context_manager(self) -> None:
        """DatabaseConnection works as a context manager."""
        with DatabaseConnection(":memory:") as db:
            db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")
            db.execute("INSERT INTO t (val) VALUES (?)", ("hello",))
            row = db.fetchone("SELECT val FROM t WHERE id = 1")
            assert row is not None
            assert row["val"] == "hello"

    @pytest.mark.integration
    def test_transaction_commit(self) -> None:
        """Transaction context commits on clean exit."""
        with DatabaseConnection(":memory:") as db:
            db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")
            with db.transaction() as conn:
                conn.execute("INSERT INTO t (val) VALUES (?)", ("committed",))
            row = db.fetchone("SELECT val FROM t WHERE id = 1")
            assert row is not None
            assert row["val"] == "committed"

    @pytest.mark.integration
    def test_transaction_rollback(self) -> None:
        """Transaction context rolls back on exception."""
        with DatabaseConnection(":memory:") as db:
            db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")
            with pytest.raises(RuntimeError):
                with db.transaction() as conn:
                    conn.execute("INSERT INTO t (val) VALUES (?)", ("doomed",))
                    raise RuntimeError("boom")
            count = db.fetchone("SELECT COUNT(*) AS cnt FROM t")
            assert count is not None
            assert count["cnt"] == 0

    @pytest.mark.integration
    def test_populated_db_lookup(self, populated_db: DatabaseConnection) -> None:
        """Can query known hashes from the populated database."""
        row = populated_db.fetchone(
            "SELECT * FROM hash_records WHERE hash_value = ?",
            (SHA256_HELLO,),
        )
        assert row is not None
        assert row["threat_type"] == "clean"
        assert row["severity"] == "low"

    @pytest.mark.integration
    def test_executemany(self, in_memory_db: DatabaseConnection) -> None:
        """executemany inserts multiple rows."""
        in_memory_db.execute(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)"
        )
        rows = [("a",), ("b",), ("c",)]
        in_memory_db.executemany("INSERT INTO t (val) VALUES (?)", rows)
        result = in_memory_db.fetchall("SELECT val FROM t ORDER BY id")
        assert [r["val"] for r in result] == ["a", "b", "c"]


# ═══════════════════════════════════════════════════════════════════
# Integration Tests — Scanner Pipeline
# ═══════════════════════════════════════════════════════════════════

class TestScannerPipeline:
    """Integration tests for the ScanPipeline."""

    @pytest.mark.integration
    def test_pipeline_computes_hashes(self, pipeline: ScanPipeline, sample_file: Path) -> None:
        """Pipeline computes SHA-256 for a file."""
        hashes = pipeline.compute_hashes(sample_file)
        assert "sha256" in hashes
        assert len(hashes["sha256"]) == 64

    @pytest.mark.integration
    def test_pipeline_full_scan(self, pipeline: ScanPipeline, sample_file: Path) -> None:
        """Full pipeline scan produces a result dict with verdict."""
        result = pipeline.scan_file(sample_file)
        assert isinstance(result, dict)
        assert "verdict" in result or "verdict_type" in result

    @pytest.mark.integration
    def test_pipeline_with_known_hash(
        self, pipeline_with_lookup: ScanPipeline, sample_file: Path
    ) -> None:
        """Pipeline identifies a known hash via database lookup."""
        result = pipeline_with_lookup.scan_file(sample_file)
        hashes = result.get("hashes", result.get("computed_hashes", {}))
        sha256 = hashes.get("sha256", "")
        assert sha256 == SHA256_SAMPLE_1K

    @pytest.mark.integration
    def test_pipeline_file_not_found(self, pipeline: ScanPipeline, tmp_path: Path) -> None:
        """Scanning a nonexistent file raises an error."""
        with pytest.raises((HashError, FileNotFoundError)):
            pipeline.scan_file(tmp_path / "nope.bin")

    @pytest.mark.integration
    def test_pipeline_progress_tracking(
        self, pipeline: ScanPipeline, sample_file: Path, progress_tracker: ProgressTracker
    ) -> None:
        """ProgressTracker records updates during a pipeline scan."""
        pipeline_with_tracker = ScanPipeline(
            config=PipelineConfig(),
            progress_tracker=progress_tracker,
        )
        pipeline_with_tracker.scan_file(sample_file)
        assert len(progress_tracker.history) > 0


# ═══════════════════════════════════════════════════════════════════
# Security Tests — Path Safety
# ═══════════════════════════════════════════════════════════════════

class TestPathSafety:
    """Security tests for path safety validation."""

    @pytest.mark.security
    def test_safe_path(self) -> None:
        """Normal paths are considered safe."""
        assert is_safe_path("/home/user/documents/file.txt")

    @pytest.mark.security
    def test_path_traversal(self) -> None:
        """Paths with .. are detected as unsafe."""
        result = sanitize_path("/home/user/../etc/passwd")
        assert not result.is_safe
        assert any("traversal" in issue.lower() for issue in result.issues)

    @pytest.mark.security
    def test_null_bytes(self) -> None:
        """Paths with null bytes are detected."""
        result = sanitize_path("/home/user/file\0.exe")
        assert not result.is_safe
        assert any("null" in issue.lower() for issue in result.issues)

    @pytest.mark.security
    def test_symlink_detection(self, tmp_path: Path) -> None:
        """Symlinks are detected."""
        target = tmp_path / "real.txt"
        target.write_text("content")
        link = tmp_path / "link.txt"
        link.symlink_to(target)
        result = sanitize_path(link)
        assert not result.is_safe
        assert any("symlink" in issue.lower() for issue in result.issues)

    @pytest.mark.security
    def test_safe_path_returns_clean_path(self) -> None:
        """Safe paths pass through without modification."""
        result = sanitize_path("/opt/mhcp/data/sample.bin")
        assert result.is_safe
        assert result.sanitised == "/opt/mhcp/data/sample.bin"


# ═══════════════════════════════════════════════════════════════════
# Unit Tests — Verdict Generation
# ═══════════════════════════════════════════════════════════════════

class TestVerdictGeneration:
    """Tests for VerdictGenerator behaviour."""

    @pytest.mark.unit
    def test_known_malicious(self) -> None:
        """Records in the database produce a KNOWN_MALICIOUS verdict."""
        from mhcp_scanner.engine.verdict import VerdictGenerator, VerdictType

        gen = VerdictGenerator()
        records = [{"threat_type": "trojan", "severity": "high"}]
        verdict = gen.generate(lookup_results=records)
        assert verdict.verdict_type is VerdictType.KNOWN_MALICIOUS
        assert verdict.is_malicious

    @pytest.mark.unit
    def test_unknown_no_records(self) -> None:
        """No matching records produce an UNKNOWN verdict."""
        from mhcp_scanner.engine.verdict import VerdictGenerator, VerdictType

        gen = VerdictGenerator()
        verdict = gen.generate(lookup_results=[])
        assert verdict.verdict_type is VerdictType.UNKNOWN
        assert verdict.is_unknown

    @pytest.mark.unit
    def test_database_error_fallback(self) -> None:
        """Database errors produce an UNKNOWN verdict."""
        from mhcp_scanner.engine.verdict import VerdictGenerator, VerdictType

        gen = VerdictGenerator()
        verdict = gen.generate(database_error="connection refused")
        assert verdict.verdict_type is VerdictType.UNKNOWN

    @pytest.mark.unit
    def test_verdict_human_readable(self) -> None:
        """Verdict provides a human-readable description."""
        from mhcp_scanner.engine.verdict import VerdictGenerator

        gen = VerdictGenerator()
        verdict = gen.generate(lookup_results=[])
        assert isinstance(verdict.human_readable, str)
        assert len(verdict.human_readable) > 0

    @pytest.mark.unit
    def test_verdict_to_dict(self) -> None:
        """Verdict serialises to a dictionary."""
        from mhcp_scanner.engine.verdict import VerdictGenerator

        gen = VerdictGenerator()
        verdict = gen.generate(lookup_results=[])
        d = verdict.to_dict()
        assert isinstance(d, dict)
        assert "verdict_type" in d or "type" in d
