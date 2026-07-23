# Minimal Example — Malware Hash Checker Pro

This example demonstrates the simplest way to scan a file using the
MHCP scanner pipeline.

## Setup

```bash
pip install -e ../..
pip install -r requirements.txt  # if any
```

## Usage

```bash
python scan_file.py /path/to/suspect.bin
```

## What This Example Does

1. Creates a `PipelineConfig` with SHA-256 hashing enabled.
2. Instantiates a `ScanPipeline` with the default configuration.
3. Calls `scan_file()` on the target path.
4. Prints the computed hashes and verdict to stdout.

No database, no plugins — just pure hash computation and verdict
generation using the built-in `VerdictGenerator`.
