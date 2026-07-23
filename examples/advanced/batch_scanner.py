"""Advanced example — batch file scanning with progress and cancellation.

Scans every file under a directory tree, tracking progress and allowing
graceful cancellation via Ctrl-C.

Usage:
    python batch_scanner.py /path/to/directory/
"""

from __future__ import annotations

import signal
import sys
import time
from pathlib import Path
from typing import Any

from mhcp_database.connection import DatabaseConnection
from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_scanner.engine.backend import HashBackend
from mhcp_scanner.engine.cancellation import CancellationHandler
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline
from mhcp_scanner.engine.progress import ProgressStage, ProgressTracker, ProgressUpdate
from mhcp_scanner.engine.verdict import VerdictGenerator
from mhcp_logging.logger import get_logger

logger = get_logger(__name__)


# ── Progress listener ──────────────────────────────────────────────

def on_progress(update: ProgressUpdate) -> None:
    """Print progress to stderr without polluting stdout."""
    bar_len = 40
    filled = int(bar_len * update.percentage / 100)
    bar = "=" * filled + "-" * (bar_len - filled)
    stage = update.stage.value if hasattr(update.stage, "value") else update.stage
    print(
        f"\r  [{bar}] {update.percentage:5.1f}%  stage={stage}",
        end="",
        file=sys.stderr,
        flush=True,
    )


# ── Seed the in-memory database with a known hash ─────────────────

def _create_test_database() -> DatabaseConnection:
    """Return an in-memory database pre-loaded with a test hash."""
    db = DatabaseConnection(":memory:")
    db.connect()
    db.execute(
        """
        CREATE TABLE hash_records (
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
        """
    )
    db.execute(
        "CREATE INDEX idx_hash_value ON hash_records (hash_value)"
    )

    known_hash = BackendSingleton.sha256(b"\x42" * 1024)
    db.execute(
        "INSERT INTO hash_records "
        "(hash_value, algorithm, source, threat_type, severity, "
        " first_seen, last_seen, metadata) "
        "VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), '{}')",
        (known_hash, "sha256", "test_vector", "trojan", "high"),
    )
    return db


class BackendSingleton:
    """Thin wrapper to compute SHA-256 without instantiating a full pipeline."""

    def __init__(self) -> None:
        self._backend = HashBackend(HashAlgorithm.SHA256)

    @classmethod
    def sha256(cls, data: bytes) -> str:
        backend = HashBackend(HashAlgorithm.SHA256)
        return backend.compute_bytes(data)


# ── Main scan loop ────────────────────────────────────────────────

def scan_directory(root: Path) -> None:
    """Recursively scan all regular files under *root*."""
    cancellation = CancellationHandler()
    tracker = ProgressTracker()
    tracker.add_listener(on_progress)

    # Allow Ctrl-C to trigger graceful cancellation.
    def _handle_sigint(signum: int, frame: Any) -> None:
        logger.warning("Cancellation requested via signal %s", signum)
        cancellation.request_cancellation()

    signal.signal(signal.SIGINT, _handle_sigint)

    # Collect files first so we know the total.
    files = sorted(p for p in root.rglob("*") if p.is_file())
    total = len(files)
    if total == 0:
        print("No files found under", root)
        return

    print(f"Scanning {total} files under {root} ...")
    tracker.update(stage=ProgressStage.PREPARING, percentage=0)

    # Set up pipeline.
    config = PipelineConfig(algorithms=["sha256", "md5", "sha512"])
    db = _create_test_database()

    from mhcp_scanner.engine.repository import HashRecordRepository

    repo = HashRecordRepository(db)
    pipeline = ScanPipeline(
        config=config,
        lookup_fn=repo.lookup,
        cancellation_handler=cancellation,
        progress_tracker=tracker,
    )

    results: list[dict[str, Any]] = []
    errors: list[str] = []
    start = time.monotonic()

    for idx, file_path in enumerate(files, 1):
        if cancellation.is_cancelled:
            print("\nScan cancelled by user.")
            break

        tracker.update(
            stage=ProgressStage.HASHING,
            percentage=int(idx / total * 100),
        )

        try:
            result = pipeline.scan_file(file_path)
            results.append(result)
        except Exception as exc:
            errors.append(f"{file_path}: {exc}")
            logger.error("Failed to scan %s: %s", file_path, exc)

    elapsed = time.monotonic() - start
    tracker.complete()

    # ── Summary ────────────────────────────────────────────────────
    print(f"\n\nScan completed in {elapsed:.2f}s")
    print(f"  Files scanned : {len(results)}")
    print(f"  Errors        : {len(errors)}")

    malicious = sum(
        1
        for r in results
        if getattr(r.get("verdict"), "is_malicious", False)
    )
    print(f"  Malicious     : {malicious}")
    print(f"  Clean/Unknown : {len(results) - malicious}")

    if errors:
        print("\nErrors:")
        for err in errors:
            print(f"  - {err}")


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <directory>")
        sys.exit(1)

    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"Error: not a directory — {root}")
        sys.exit(1)

    scan_directory(root)


if __name__ == "__main__":
    main()
