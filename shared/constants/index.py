"""Shared constants used across the application."""

# Application
APP_NAME = "SecureScan Pro X"
APP_VERSION = "0.1.0"

# Severity levels (ordered by severity)
SEVERITY_LEVELS = ["critical", "high", "medium", "low", "info"]

# Asset types
ASSET_TYPES = ["host", "network", "web", "cloud", "container"]

# Assessment statuses
ASSESSMENT_STATUSES = ["pending", "running", "completed", "failed", "cancelled"]

# Finding statuses
FINDING_STATUSES = ["open", "confirmed", "fixed", "false_positive"]

# RBAC Roles
ROLES = ["admin", "analyst", "viewer", "auditor"]

# Permissions
PERMISSIONS = [
    "workspace:create",
    "workspace:read",
    "workspace:update",
    "workspace:delete",
    "asset:create",
    "asset:read",
    "asset:update",
    "asset:delete",
    "assessment:create",
    "assessment:read",
    "assessment:start",
    "assessment:cancel",
    "assessment:delete",
    "report:create",
    "report:read",
    "report:export",
    "plugin:install",
    "plugin:uninstall",
    "plugin:configure",
    "settings:read",
    "settings:update",
    "audit:read",
]

# Role-Permission mapping
ROLE_PERMISSIONS = {
    "admin": PERMISSIONS,  # All permissions
    "analyst": [
        "workspace:create", "workspace:read", "workspace:update",
        "asset:create", "asset:read", "asset:update",
        "assessment:create", "assessment:read", "assessment:start", "assessment:cancel",
        "report:create", "report:read", "report:export",
        "plugin:read",
        "settings:read",
    ],
    "viewer": [
        "workspace:read",
        "asset:read",
        "assessment:read",
        "report:read",
    ],
    "auditor": [
        "workspace:read",
        "asset:read",
        "assessment:read",
        "report:read",
        "report:export",
        "audit:read",
    ],
}

# API
API_V1_PREFIX = "/api/v1"
API_HEALTH_ENDPOINT = "/health"

# Database
DEFAULT_DB_PATH = "~/.securescan/data/securescan.db"

# Plugin
PLUGIN_MANIFEST_FILE = "plugin.yaml"
PLUGIN_MIN_SECURESCAN_VERSION = "0.1.0"
