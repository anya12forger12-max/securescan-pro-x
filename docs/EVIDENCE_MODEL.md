# Evidence Model

## Overview

Evidence represents data collected during an assessment that supports findings. Every evidence item carries an integrity hash for tamper detection and provenance tracking.

## Evidence Types

| Type | Description |
|------|-------------|
| `structured_data` | JSON, XML, or other structured data |
| `configuration_file` | Configuration file contents |
| `log` | Log file entries |
| `metadata` | Asset or system metadata |
| `manual_note` | Manually recorded observations |
| `screenshot` | Screenshot image (referenced by path) |
| `imported_report` | Report imported from external tool |

## Classification Levels

| Level | Description |
|-------|-------------|
| `public` | Safe for unrestricted distribution |
| `internal` | Internal use only |
| `confidential` | Requires authorization to access |
| `restricted` | Highly sensitive, strict access control |

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `assessment_id` | UUID | Parent assessment |
| `finding_id` | UUID? | Associated finding |
| `evidence_type` | enum | Type of evidence |
| `title` | string | Human-readable title |
| `description` | string? | Detailed description |
| `content` | string? | Evidence content |
| `integrity_hash` | string | SHA-256 hash for tamper detection |
| `source` | string | Origin of the evidence |
| `collector` | string | Who or what collected it |
| `classification` | enum | Sensitivity level |
| `tags` | list | Categorization tags |
| `retention_days` | int | How long to retain |
| `is_deleted` | bool | Soft delete flag |
| `created_at` | datetime | Creation timestamp |
| `updated_at` | datetime | Last update timestamp |

## Integrity Verification

Each evidence item's integrity hash is computed as:

```
SHA-256(source + ":" + content)
```

The hash is computed when the evidence is created and verified on demand. Any modification to the content or source will cause verification to fail.

## Lifecycle

1. **Collection** — Evidence is added during assessment execution
2. **Storage** — Content and metadata are stored with integrity hash
3. **Verification** — Hash can be verified at any time
4. **Retention** — Evidence is retained per `retention_days`
5. **Deletion** — Soft-delete preserves audit trail

## API Endpoints

- `POST /api/v1/assessments/{id}/evidence` — Add evidence
- `GET /api/v1/assessments/{id}/evidence` — List evidence
- `GET /api/v1/assessments/{id}/evidence/{ev_id}/verify` — Verify integrity
