-- SecureScan Pro X - Core Database Schema
-- Version: 0.1.0
-- Engine: SQLite (async via aiosqlite)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ============================================================
-- Users & Authentication
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'viewer')),
    is_active INTEGER NOT NULL DEFAULT 1,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret TEXT,
    last_login_at TEXT,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================
-- Sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================
-- Workspaces
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT REFERENCES users(id),
    is_default INTEGER NOT NULL DEFAULT 0,
    settings TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

-- ============================================================
-- Assets
-- ============================================================

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('host', 'network', 'web', 'cloud', 'container')),
    identifier TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, identifier)
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_identifier ON assets(identifier);

-- ============================================================
-- Assessments
-- ============================================================

CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'queued', 'running', 'paused', 'completed',
        'failed', 'cancelled', 'archived', 'pending_approval',
        'approved', 'scheduled', 'retrying', 'interrupted'
    )),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    profile_id TEXT,
    policy_id TEXT,
    config TEXT DEFAULT '{}',
    progress REAL NOT NULL DEFAULT 0.0,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessments_workspace ON assessments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status);
CREATE INDEX IF NOT EXISTS idx_assessments_priority ON assessments(priority);

-- ============================================================
-- Assessment Targets
-- ============================================================

CREATE TABLE IF NOT EXISTS assessment_targets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    target_identifier TEXT NOT NULL,
    target_type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_targets_assessment ON assessment_targets(assessment_id);

-- ============================================================
-- Findings
-- ============================================================

CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'mitigated', 'accepted', 'false_positive')),
    cvss_score REAL,
    cvss_vector TEXT,
    cwe_id TEXT,
    cve_id TEXT,
    plugin_id TEXT,
    evidence TEXT DEFAULT '[]',
    recommendation TEXT,
    references TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    confidence REAL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    raw_output TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_findings_assessment ON findings(assessment_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_cwe ON findings(cwe_id);
CREATE INDEX IF NOT EXISTS idx_findings_cve ON findings(cve_id);

-- ============================================================
-- Evidence
-- ============================================================

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN (
        'screenshot', 'log_output', 'config_snippet', 'network_capture',
        'file_content', 'command_output', 'api_response'
    )),
    classification TEXT NOT NULL DEFAULT 'internal' CHECK (classification IN (
        'public', 'internal', 'confidential', 'restricted'
    )),
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    description TEXT,
    filename TEXT,
    mime_type TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,
    verified_by TEXT REFERENCES users(id),
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_finding ON evidence(finding_id);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence(evidence_type);

-- ============================================================
-- Reports
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('json', 'markdown', 'html', 'csv', 'pdf')),
    title TEXT NOT NULL,
    content TEXT,
    content_hash TEXT,
    file_path TEXT,
    generated_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_assessment ON reports(assessment_id);

-- ============================================================
-- Audit Log
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    resource_type TEXT,
    resource_id TEXT,
    action TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- ============================================================
-- Plugin Registry
-- ============================================================

CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    version TEXT NOT NULL DEFAULT '1.0.0',
    author TEXT,
    plugin_type TEXT NOT NULL CHECK (plugin_type IN (
        'scanner', 'analyzer', 'reporter', 'notifier', 'utility'
    )),
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN (
        'active', 'inactive', 'error', 'disabled'
    )),
    config_schema TEXT DEFAULT '{}',
    permissions TEXT DEFAULT '[]',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    entry_point TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plugins_type ON plugins(plugin_type);
CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status);

-- ============================================================
-- Scan Jobs
-- ============================================================

CREATE TABLE IF NOT EXISTS scan_jobs (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    plugin_id TEXT REFERENCES plugins(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'running', 'completed', 'failed', 'cancelled'
    )),
    target TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    progress REAL NOT NULL DEFAULT 0.0,
    result_summary TEXT DEFAULT '{}',
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_assessment ON scan_jobs(assessment_id);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);

-- ============================================================
-- Tags
-- ============================================================

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding_tags (
    finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (finding_id, tag_id)
);

-- ============================================================
-- Notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_type TEXT NOT NULL DEFAULT 'info',
    is_read INTEGER NOT NULL DEFAULT 0,
    link TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

-- ============================================================
-- Full-Text Search (FTS5)
-- ============================================================

CREATE VIRTUAL TABLE IF NOT EXISTS findings_fts USING fts5(
    title, description, recommendation, cve_id, cwe_id,
    content=findings, content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
    name, identifier,
    content=assets, content_rowid=rowid
);

-- ============================================================
-- Triggers for FTS synchronization
-- ============================================================

CREATE TRIGGER IF NOT EXISTS findings_ai AFTER INSERT ON findings BEGIN
    INSERT INTO findings_fts(rowid, title, description, recommendation, cve_id, cwe_id)
    VALUES (new.rowid, new.title, new.description, new.recommendation, new.cve_id, new.cwe_id);
END;

CREATE TRIGGER IF NOT EXISTS findings_ad AFTER DELETE ON findings BEGIN
    INSERT INTO findings_fts(findings_fts, rowid, title, description, recommendation, cve_id, cwe_id)
    VALUES ('delete', old.rowid, old.title, old.description, old.recommendation, old.cve_id, old.cwe_id);
END;

CREATE TRIGGER IF NOT EXISTS findings_au AFTER UPDATE ON findings BEGIN
    INSERT INTO findings_fts(findings_fts, rowid, title, description, recommendation, cve_id, cwe_id)
    VALUES ('delete', old.rowid, old.title, old.description, old.recommendation, old.cve_id, old.cwe_id);
    INSERT INTO findings_fts(rowid, title, description, recommendation, cve_id, cwe_id)
    VALUES (new.rowid, new.title, new.description, new.recommendation, new.cve_id, new.cwe_id);
END;
