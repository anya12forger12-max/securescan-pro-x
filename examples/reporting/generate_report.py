"""Reporting example — generate scan reports in multiple formats.

Demonstrates producing JSON and CSV reports from mock scan results
and writing them to disk.

Usage:
    python generate_report.py
"""

from __future__ import annotations

import csv
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mhcp_reports.lib.src.formats import OutputFormat


# ── Mock scan results ──────────────────────────────────────────────

def _build_sample_results() -> list[dict[str, Any]]:
    """Return a list of scan result dicts simulating a batch scan."""
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "file_path": "/samples/malware_trojan.exe",
            "file_size": 245_760,
            "hashes": {
                "sha256": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
                "md5": "d41d8cd98f00b204e9800998ecf8427e",
            },
            "verdict": "KNOWN_MALICIOUS",
            "threat_type": "trojan",
            "severity": "high",
            "source": "virustotal",
            "scan_timestamp": now,
            "scan_duration_ms": 45.2,
        },
        {
            "file_path": "/samples/clean_document.pdf",
            "file_size": 102_400,
            "hashes": {
                "sha256": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
                "md5": "e2fc4d5e6f7a8b9c0d1e2f3a4b5c6d7e",
            },
            "verdict": "CLEAN",
            "threat_type": "",
            "severity": "none",
            "source": "",
            "scan_timestamp": now,
            "scan_duration_ms": 12.8,
        },
        {
            "file_path": "/samples/unknown_script.ps1",
            "file_size": 4_096,
            "hashes": {
                "sha256": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
                "md5": "f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0",
            },
            "verdict": "UNKNOWN",
            "threat_type": "",
            "severity": "unknown",
            "source": "",
            "scan_timestamp": now,
            "scan_duration_ms": 8.1,
        },
    ]


# ── JSON report ────────────────────────────────────────────────────

def generate_json_report(
    results: list[dict[str, Any]],
    *,
    title: str = "MHCP Scan Report",
) -> bytes:
    """Build a JSON report from scan results."""
    report: dict[str, Any] = {
        "report": {
            "title": title,
            "format": OutputFormat.JSON.value,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "scanner_version": "0.1.0",
        },
        "summary": {
            "total_files": len(results),
            "malicious": sum(1 for r in results if r.get("verdict") == "KNOWN_MALICIOUS"),
            "clean": sum(1 for r in results if r.get("verdict") == "CLEAN"),
            "unknown": sum(1 for r in results if r.get("verdict") == "UNKNOWN"),
            "total_bytes": sum(r.get("file_size", 0) for r in results),
        },
        "results": results,
    }
    return json.dumps(report, indent=2).encode("utf-8")


# ── CSV report ─────────────────────────────────────────────────────

_CSV_COLUMNS = [
    "file_path",
    "file_size",
    "sha256",
    "md5",
    "verdict",
    "threat_type",
    "severity",
    "source",
    "scan_timestamp",
    "scan_duration_ms",
]


def generate_csv_report(results: list[dict[str, Any]]) -> bytes:
    """Build a CSV report from scan results."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()

    for r in results:
        row = dict(r)
        hashes = row.pop("hashes", {})
        row["sha256"] = hashes.get("sha256", "")
        row["md5"] = hashes.get("md5", "")
        writer.writerow(row)

    return buf.getvalue().encode("utf-8")


# ── Text summary ───────────────────────────────────────────────────

def generate_text_summary(results: list[dict[str, Any]]) -> str:
    """Return a human-readable text summary of scan results."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("  MHCP Scan Report Summary")
    lines.append("=" * 60)
    lines.append(f"  Total files scanned : {len(results)}")
    lines.append(
        f"  Malicious           : "
        f"{sum(1 for r in results if r.get('verdict') == 'KNOWN_MALICIOUS')}"
    )
    lines.append(
        f"  Clean               : "
        f"{sum(1 for r in results if r.get('verdict') == 'CLEAN')}"
    )
    lines.append(
        f"  Unknown             : "
        f"{sum(1 for r in results if r.get('verdict') == 'UNKNOWN')}"
    )
    lines.append("-" * 60)

    for r in results:
        verdict = r.get("verdict", "UNKNOWN")
        path = r.get("file_path", "")
        lines.append(f"  [{verdict:16s}] {path}")

    lines.append("=" * 60)
    return "\n".join(lines)


# ── Main ───────────────────────────────────────────────────────────

def main() -> None:
    output_dir = Path("reports")
    output_dir.mkdir(exist_ok=True)

    results = _build_sample_results()

    # JSON report.
    json_bytes = generate_json_report(results)
    json_path = output_dir / "scan_report.json"
    json_path.write_bytes(json_bytes)
    print(f"JSON report written to {json_path} ({len(json_bytes)} bytes)")

    # CSV report.
    csv_bytes = generate_csv_report(results)
    csv_path = output_dir / "scan_report.csv"
    csv_path.write_bytes(csv_bytes)
    print(f"CSV report written to {csv_path} ({len(csv_bytes)} bytes)")

    # Text summary to stdout.
    print()
    print(generate_text_summary(results))

    # Also show the parsed JSON for verification.
    print("\nParsed JSON summary:")
    parsed = json.loads(json_bytes)
    summary = parsed["summary"]
    for key, value in summary.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
