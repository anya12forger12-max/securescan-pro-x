# API Overview

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

Phase 1A uses local-only access. No remote authentication is required.

## Endpoints

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "application": "SecureScan Pro X"
}
```

### Workspaces

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/workspaces` | Create a workspace |
| `GET` | `/workspaces` | List workspaces |
| `GET` | `/workspaces/{id}` | Get a workspace |
| `PATCH` | `/workspaces/{id}` | Update a workspace |
| `DELETE` | `/workspaces/{id}` | Delete a workspace |

### Assets

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/assets` | Create an asset |
| `GET` | `/assets` | List assets |
| `GET` | `/assets/{id}` | Get an asset |
| `PATCH` | `/assets/{id}` | Update an asset |
| `DELETE` | `/assets/{id}` | Delete an asset |

### Assessments

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/assessments` | Create an assessment |
| `GET` | `/assessments` | List assessments |
| `GET` | `/assessments/{id}` | Get an assessment |
| `POST` | `/assessments/{id}/start` | Start an assessment |
| `POST` | `/assessments/{id}/cancel` | Cancel an assessment |
| `PATCH` | `/assessments/{id}` | Update an assessment |
| `DELETE` | `/assessments/{id}` | Delete an assessment |

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "detail": "Additional details",
  "code": "ERROR_CODE"
}
```

## Interactive Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI JSON**: http://localhost:8000/openapi.json
