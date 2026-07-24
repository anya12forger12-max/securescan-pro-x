# Assessment API Reference

## Base URL

```
/api/v1/assessments
```

## Endpoints

### Create Assessment

```
POST /api/v1/assessments?workspace_id={workspace_id}
```

**Request Body:**
```json
{
  "name": "Quarterly Security Review",
  "description": "Q1 2026 security assessment",
  "priority": "high",
  "profile_id": "profile-001",
  "policy_id": "policy-001",
  "asset_ids": ["asset-001", "asset-002"],
  "tags": ["quarterly", "production"]
}
```

**Response:** `201 Created`
```json
{
  "id": "assess-00000001",
  "workspace_id": "ws-1",
  "name": "Quarterly Security Review",
  "status": "draft",
  "priority": "high",
  "progress_percent": 0,
  ...
}
```

### List Assessments

```
GET /api/v1/assessments?workspace_id={workspace_id}&status={status}&offset=0&limit=50
```

### Get Assessment

```
GET /api/v1/assessments/{assessment_id}
```

### Update Assessment

```
PATCH /api/v1/assessments/{assessment_id}
```

### Delete Assessment

```
DELETE /api/v1/assessments/{assessment_id}
```

## Lifecycle Endpoints

### Queue Assessment

```
POST /api/v1/assessments/{assessment_id}/queue
```

Transitions: Draft → Queued

### Start Assessment

```
POST /api/v1/assessments/{assessment_id}/start
```

Transitions through the full pipeline to Completed (demo mode).

### Pause Assessment

```
POST /api/v1/assessments/{assessment_id}/pause
```

Transitions: Running → Paused

### Resume Assessment

```
POST /api/v1/assessments/{assessment_id}/resume
```

Transitions: Paused → Running

### Cancel Assessment

```
POST /api/v1/assessments/{assessment_id}/cancel
```

Transitions: Any non-terminal state → Cancelled

### Retry Assessment

```
POST /api/v1/assessments/{assessment_id}/retry
```

Transitions: Failed → Queued

### Archive Assessment

```
POST /api/v1/assessments/{assessment_id}/archive
```

Transitions: Completed → Archived

## Data Endpoints

### Timeline

```
GET /api/v1/assessments/{assessment_id}/timeline
```

Returns chronological events for the assessment.

### Statistics

```
GET /api/v1/assessments/{assessment_id}/statistics
```

Returns computed statistics including severity breakdown.

### Dashboard

```
GET /api/v1/assessments/dashboard?workspace_id={workspace_id}
```

Returns aggregated dashboard data.

### Search

```
GET /api/v1/assessments/search?workspace_id={workspace_id}&q={query}
```

## Findings

### Add Finding

```
POST /api/v1/assessments/{assessment_id}/findings
```

**Request Body:**
```json
{
  "title": "Missing Security Headers",
  "severity": "high",
  "category": "web_security",
  "confidence": 0.9,
  "summary": "Website lacks CSP and X-Frame-Options headers",
  "recommendation": "Add Content-Security-Policy and X-Frame-Options headers",
  "cvss_score": 7.5,
  "cwe_ids": ["CWE-693"]
}
```

## Evidence

### List Evidence

```
GET /api/v1/assessments/{assessment_id}/evidence?evidence_type={type}
```

### Add Evidence

```
POST /api/v1/assessments/{assessment_id}/evidence
```

### Verify Evidence Integrity

```
GET /api/v1/assessments/{assessment_id}/evidence/{evidence_id}/verify
```

## Reports

### Generate Report

```
POST /api/v1/assessments/{assessment_id}/reports
```

**Request Body:**
```json
{
  "format": "html"
}
```

Formats: `json`, `markdown`, `html`, `csv`

### List Reports

```
GET /api/v1/assessments/{assessment_id}/reports
```

## Tags

### Add Tag

```
POST /api/v1/assessments/{assessment_id}/tags
```

**Request Body:**
```json
{
  "tag": "production"
}
```

## Notes

### Add Note

```
POST /api/v1/assessments/{assessment_id}/notes
```

**Request Body:**
```json
{
  "content": "Follow-up required on critical findings",
  "author": "analyst-1",
  "is_pinned": true
}
```

## Error Responses

| Status | Description |
|--------|-------------|
| 404 | Resource not found |
| 409 | Invalid state transition |
| 422 | Validation error |
