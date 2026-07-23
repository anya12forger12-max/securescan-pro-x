"""Minimal example — scan a single file for known hashes.

Usage:
    python scan_file.py /path/to/suspect.bin
"""

from __future__ import annotations

import sys
from pathlib import Path

from mhcp_hashing.algorithm import HashAlgorithm
from mhcp_scanner.engine.backend import HashBackend
from mhcp_scanner.engine.pipeline import PipelineConfig, ScanPipeline
from mhcp_scanner.engine.verdict import VerdictGenerator


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <file_path>")
        sys.exit(1)

    target = Path(sys.argv[1])
    if not target.exists():
        print(f"Error: file not found — {target}")
        sys.exit(1)

    # 1. Configure the pipeline to compute SHA-256 and MD5.
    config = PipelineConfig(algorithms=["sha256", "md5"])

    # 2. Build the pipeline (no database lookup, just hashing).
    pipeline = ScanPipeline(config=config)

    # 3. Run the scan.
    result = pipeline.scan_file(target)

    # 4. Extract and display hashes.
    hashes = result.get("hashes", result.get("computed_hashes", {}))
    print("Computed hashes:")
    for algo_name, digest in hashes.items():
        print(f"  {algo_name}: {digest}")

    # 5. Show the verdict.
    verdict = result.get("verdict", result.get("verdict_type", "unknown"))
    if hasattr(verdict, "human_readable"):
        print(f"\nVerdict:\n  {verdict.human_readable}")
    else:
        print(f"\nVerdict: {verdict}")

    # 6. Optionally print the full result dict for debugging.
    print(f"\nFull result keys: {list(result.keys())}")


if __name__ == "__main__":
    main()
