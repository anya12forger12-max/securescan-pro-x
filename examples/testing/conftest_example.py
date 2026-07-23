"""Shared pytest fixtures for MHCP example tests.

Copy this file into your test directory as ``conftest.py`` to
reuse these fixtures across your test modules.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Generator

import pytest

from mhcp_core.errors import Severity
from mhcp_core.result import Ok, Err, Result
from mhcp_database.connection import DatabaseConnection
from mhcp_database.models import HashRecord
from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline
from mhcp_scanner.engine.progress import ProgressTracker


# ── Known test vectors ────────────────────────────────────────────

SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
SHA256_HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
MD5_TEST = "098f6bcd4621d373cade4e832627b4f6"
SHA256_SAMPLE_1K = hashlib.sha256(b"\x42" * 1024).hexdigest()


# ── File fixtures ─────────────────────────────────────────────────

@pytest.fixture()
def sample_file(tmp_path: Path) -> Path:
    """Create a 1KB binary file with deterministic content."""
    path = tmp_path / "sample.bin"
    path.write_bytes(b"\x42" * 1024)
    return path


@pytest.fixture()
def sample_file_large(tmp_path: Path) -> Path:
    """Create a 1MB binary file."""
    path = tmp_path / "large.bin"
    path.write_bytes(b"\xAB" * (1024 * 1024))
    return path


@pytest.fixture()
def empty_file(tmp_path: Path) -> Path:
    """Create an empty file."""
    path = tmp_path / "empty.bin"
    path.write_bytes(b"")
    return path


@pytest.fixture()
def sample_text_file(tmp_path: Path) -> Path:
    """Create a small text file with known content."""
    path = tmp_path / "hello.txt"
    path.write_text("Hello, Malware Hash Checker Pro!")
    return path


@pytest.fixture()
def malicious_extension_file(tmp_path: Path) -> Path:
    """Create a file with a suspicious double extension."""
    path = tmp_path / "report.pdf.exe"
    path.write_bytes(b"\x00" * 256)
    return path


# ── Database fixtures ─────────────────────────────────────────────

@pytest.fixture()
def in_memory_db() -> Generator[DatabaseConnection, None, None]:
    """Provide a connected in-memory DatabaseConnection."""
    conn = DatabaseConnection(":memory:")
    conn.connect()
    yield conn
    conn.close()


@pytest.fixture()
def populated_db(in_memory_db: DatabaseConnection) -> DatabaseConnection:
    """Create hash_records table and insert known test vectors."""
    in_memory_db.execute("""
        CREATE TABLE IF NOT EXISTS hash_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash_value TEXT NOT NULL,
            algorithm TEXT NOT NULL,
            source TEXT,
            threat_type TEXT,
            severity TEXT,
            first_seen TEXT,
            last_seen TEXT,
            metadata TEXT
        )
    """)
    in_memory_db.execute(
        "CREATE INDEX IF NOT EXISTS idx_hash_value ON hash_records (hash_value)"
    )

    now = datetime.now(timezone.utc).isoformat()
    records = [
        (SHA256_EMPTY, "sha256", "test_vector", "trojan", "high", now, now, "{}"),
        (SHA256_HELLO, "sha256", "test_vector", "clean", "low", now, now, "{}"),
        (MD5_TEST, "md5", "test_vector", "ransomware", "critical", now, now, "{}"),
    ]
    in_memory_db.executemany(
        "INSERT INTO hash_records "
        "(hash_value, algorithm, source, threat_type, severity, "
        " first_seen, last_seen, metadata) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        records,
    )

    return in_memory_db


@pytest.fixture()
def hash_lookup_fn(populated_db: DatabaseConnection) -> Callable:
    """Return a callable wrapping HashRecordRepository.lookup."""
    from mhcp_scanner.engine.repository import HashRecordRepository

    repo = HashRecordRepository(populated_db)
    return repo.lookup


# ── Pipeline fixtures ─────────────────────────────────────────────

@pytest.fixture()
def pipeline_config() -> PipelineConfig:
    """Return a default PipelineConfig."""
    return PipelineConfig()


@pytest.fixture()
def pipeline_with_algorithms() -> PipelineConfig:
    """Return a PipelineConfig with multiple algorithms."""
    return PipelineConfig(algorithms=["sha256", "md5", "sha512"])


@pytest.fixture()
def pipeline(
    pipeline_config: PipelineConfig,
) -> ScanPipeline:
    """Return a basic ScanPipeline with no lookup function."""
    return ScanPipeline(config=pipeline_config)


@pytest.fixture()
def pipeline_with_lookup(
    pipeline_config: PipelineConfig,
    hash_lookup_fn: Callable,
) -> ScanPipeline:
    """Return a ScanPipeline with a database lookup function."""
    return ScanPipeline(config=pipeline_config, lookup_fn=hash_lookup_fn)


@pytest.fixture()
def progress_tracker() -> ProgressTracker:
    """Return a fresh ProgressTracker."""
    return ProgressTracker()


# ── Hash record fixtures ──────────────────────────────────────────

@pytest.fixture()
def sample_hash_record() -> HashRecord:
    """Return a HashRecord with a known SHA-256 hash."""
    return HashRecord(
        id=None,
        hash_value=SHA256_HELLO,
        algorithm="sha256",
        source="test",
        threat_type="clean",
        severity="low",
        first_seen=datetime(2024, 1, 1, tzinfo=timezone.utc),
        last_seen=datetime(2024, 6, 1, tzinfo=timezone.utc),
        metadata={"test": True},
    )


@pytest.fixture()
def malicious_hash_record() -> HashRecord:
    """Return a HashRecord representing a known-malicious hash."""
    return HashRecord(
        id=None,
        hash_value=SHA256_EMPTY,
        algorithm="sha256",
        source="virustotal",
        threat_type="trojan",
        severity="critical",
        first_seen=datetime(2023, 6, 15, tzinfo=timezone.utc),
        last_seen=datetime(2024, 1, 10, tzinfo=timezone.utc),
        metadata={"detection_ratio": "65/72"},
    )
