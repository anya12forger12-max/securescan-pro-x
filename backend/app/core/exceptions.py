"""Exception hierarchy for SecureScan Pro X.

All application exceptions inherit from SecureScanError.
Exceptions are typed to enable precise error handling.
"""

from __future__ import annotations


class SecureScanError(Exception):
    """Base exception for all SecureScan Pro X errors."""


# ── Configuration Errors ──────────────────────────────────────────

class ConfigurationError(SecureScanError):
    """Raised when configuration is invalid or missing."""


class ConfigurationNotFoundError(ConfigurationError):
    """Raised when a required configuration file is not found."""


# ── Database Errors ───────────────────────────────────────────────

class DatabaseError(SecureScanError):
    """Raised when a database operation fails."""


class DatabaseConnectionError(DatabaseError):
    """Raised when database connection fails."""


class MigrationError(DatabaseError):
    """Raised when a database migration fails."""


# ── Workspace Errors ──────────────────────────────────────────────

class WorkspaceError(SecureScanError):
    """Raised when a workspace operation fails."""


class WorkspaceNotFoundError(WorkspaceError):
    """Raised when a workspace does not exist."""


class WorkspaceExistsError(WorkspaceError):
    """Raised when trying to create a workspace with a duplicate name."""


# ── Asset Errors ──────────────────────────────────────────────────

class AssetError(SecureScanError):
    """Raised when an asset operation fails."""


class AssetNotFoundError(AssetError):
    """Raised when an asset does not exist."""


class AssetExistsError(AssetError):
    """Raised when trying to create a duplicate asset."""


# ── Assessment Errors ─────────────────────────────────────────────

class AssessmentError(SecureScanError):
    """Raised when an assessment operation fails."""


class AssessmentNotFoundError(AssessmentError):
    """Raised when an assessment does not exist."""


class AssessmentTimeoutError(AssessmentError):
    """Raised when an assessment exceeds its timeout."""


class AssessmentCancelledError(AssessmentError):
    """Raised when an assessment is cancelled."""


# ── Plugin Errors ─────────────────────────────────────────────────

class PluginError(SecureScanError):
    """Raised when a plugin operation fails."""


class PluginNotFoundError(PluginError):
    """Raised when a plugin is not found."""


class PluginLoadError(PluginError):
    """Raised when a plugin fails to load."""


class PluginPermissionError(PluginError):
    """Raised when a plugin lacks required permissions."""


class PluginSignatureError(PluginError):
    """Raised when a plugin signature verification fails."""


class PluginSandboxError(PluginError):
    """Raised when a plugin violates sandbox restrictions."""


# ── Permission Errors ─────────────────────────────────────────────

class PermissionError(SecureScanError):
    """Raised when a permission check fails."""


class AuthenticationError(SecureScanError):
    """Raised when authentication fails."""


class SessionExpiredError(AuthenticationError):
    """Raised when a session has expired."""


# ── Validation Errors ─────────────────────────────────────────────

class ValidationError(SecureScanError):
    """Raised when input validation fails."""


# ── Export Errors ──────────────────────────────────────────────────

class ExportError(SecureScanError):
    """Raised when an export operation fails."""


class ImportError(SecureScanError):
    """Raised when an import operation fails."""


# ── Backup Errors ─────────────────────────────────────────────────

class BackupError(SecureScanError):
    """Raised when a backup operation fails."""


class BackupNotFoundError(BackupError):
    """Raised when a backup file does not exist."""


class RestoreError(BackupError):
    """Raised when a restore operation fails."""
