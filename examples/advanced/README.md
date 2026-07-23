# Advanced Example — Batch Scanning & Custom Verdicts

This directory contains two advanced usage examples for Malware Hash
Checker Pro.

## Examples

### `batch_scanner.py`

Demonstrates scanning multiple files with:
- Progress tracking via `ProgressTracker` listener callbacks.
- Cancellation support through `CancellationHandler`.
- Multi-algorithm hashing (SHA-256 + MD5 + SHA-512).
- In-memory SQLite database for hash lookups.
- Structured logging with the `MHCPLogger`.

```bash
python batch_scanner.py /path/to/directory/
```

### `custom_verdict.py`

Shows how to extend the built-in `VerdictGenerator` to produce custom
verdict types beyond `KNOWN_MALICIOUS`, `UNKNOWN`, and `CLEAN`:

- `SUSPICIOUS` — heuristic-based classification when the hash is not
  in the database but exhibits suspicious metadata patterns.
- `PARENT_CONTROLLED` — verdict produced when a parental-control
  policy blocks a file regardless of hash match.

```bash
python custom_verdict.py
```

## Setup

```bash
pip install -e ../..
```
