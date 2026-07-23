# Plugin Example — Custom Providers & Algorithms

This directory shows how to extend Malware Hash Checker Pro with
plugins.

## Examples

### `custom_provider.py`

Implements a custom threat intelligence provider that queries an
external REST API for hash verdicts. The provider follows the same
callable protocol used by `HashRecordRepository.lookup`, so it can be
passed directly to `ScanPipeline(lookup_fn=...)`.

```bash
python custom_provider.py
```

### `custom_hash_algorithm.py`

Demonstrates how to register a custom hash algorithm by subclassing
`HashComputer` and extending the `HashAlgorithm` enum at runtime.

```bash
python custom_hash_algorithm.py
```

## Plugin Architecture

MHCP plugins follow these conventions:

1. **Lookup providers** are any callable with the signature
   `(hashes: dict[str, str]) -> list[dict[str, Any]]`.
2. **Hash computers** subclass `HashComputer` and implement
   `compute_file()` and `compute_bytes()`.
3. **Report generators** subclass `ReportGenerator` and implement
   `generate_scan_report()` and `generate_summary_report()`.

## Setup

```bash
pip install -e ../..
```
