# Reporting Example — Generating Scan Reports

This directory demonstrates how to produce scan reports in multiple
formats using the `mhcp_reports` package.

## Example

### `generate_report.py`

Generates a JSON and CSV report from a set of mock scan results,
showing how to:

- Configure `ReportOptions` with titles, format, and metadata flags.
- Use the `ReportGenerator` protocol to produce serialised output.
- Write reports to disk and display summaries.

```bash
python generate_report.py
```

## Supported Formats

| Format | Extension | MIME Type             |
|--------|-----------|-----------------------|
| JSON   | `.json`   | `application/json`    |
| CSV    | `.csv`    | `text/csv`            |
| HTML   | `.html`   | `text/html`           |
| PDF    | `.pdf`    | `application/pdf`     |
| TEXT   | `.txt`    | `text/plain`          |
| XML    | `.xml`    | `application/xml`     |

## Setup

```bash
pip install -e ../..
```
