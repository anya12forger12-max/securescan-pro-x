-- SecureScan Pro X - Seed Data
-- Default admin user, demo workspace, and built-in plugins

-- ============================================================
-- Default Admin User (password: admin123!@#SecureScan)
-- In production, this MUST be changed on first login
-- ============================================================

INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name, role)
VALUES (
    '00000000000000000000000000000001',
    'admin',
    'admin@securescan.local',
    '$2b$12$LJ3m4ris3Gz2Rggn3v3bSOk0JxQ3p7kHq5JX3uR1mN8vY6wE2tOa',
    'Administrator',
    'admin'
);

-- ============================================================
-- Default Viewer User
-- ============================================================

INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name, role)
VALUES (
    '00000000000000000000000000000002',
    'viewer',
    'viewer@securescan.local',
    '$2b$12$LJ3m4ris3Gz2Rggn3v3bSOk0JxQ3p7kHq5JX3uR1mN8vY6wE2tOa',
    'Viewer User',
    'viewer'
);

-- ============================================================
-- Default Workspace
-- ============================================================

INSERT OR IGNORE INTO workspaces (id, name, description, owner_id, is_default)
VALUES (
    '00000000000000000000000000000010',
    'Default Workspace',
    'Primary workspace for security assessments',
    '00000000000000000000000000000001',
    1
);

-- ============================================================
-- Built-in Plugins
-- ============================================================

INSERT OR IGNORE INTO plugins (id, name, display_name, description, plugin_type, status, is_builtin, version, entry_point)
VALUES
(
    'p0000000000000000000000000000001',
    'port_scanner',
    'Port Scanner',
    'Scans target hosts for open TCP/UDP ports and identifies services',
    'scanner',
    'active',
    1,
    '1.0.0',
    'plugins.builtin.port_scanner'
),
(
    'p0000000000000000000000000000002',
    'header_checker',
    'HTTP Header Checker',
    'Checks HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)',
    'scanner',
    'active',
    1,
    '1.0.0',
    'plugins.builtin.header_checker'
),
(
    'p0000000000000000000000000000003',
    'password_checker',
    'Password Strength Checker',
    'Evaluates password strength against common patterns and breaches',
    'scanner',
    'active',
    1,
    '1.0.0',
    'plugins.builtin.password_checker'
),
(
    'p0000000000000000000000000000004',
    'ssl_analyzer',
    'SSL/TLS Analyzer',
    'Analyzes SSL/TLS certificate validity, protocol versions, and cipher suites',
    'scanner',
    'active',
    1,
    '1.0.0',
    'plugins.builtin.ssl_analyzer'
),
(
    'p0000000000000000000000000000005',
    'risk_scorer',
    'Risk Scorer',
    'Calculates CVSS-based risk scores and prioritizes findings',
    'analyzer',
    'active',
    1,
    '1.0.0',
    'plugins.builtin.risk_scorer'
),
(
    'p0000000000000000000000000000006',
    'html_reporter',
    'HTML Report Generator',
    'Generates styled HTML assessment reports with charts',
    'reporter',
    'active',
    1,
    '1.0.0',
    'plugins.builtin.html_reporter'
);

-- ============================================================
-- Default Tags
-- ============================================================

INSERT OR IGNORE INTO tags (id, name, color) VALUES
    ('t0000000000000000000000000000001', 'network', '#3b82f6'),
    ('t0000000000000000000000000000002', 'web', '#8b5cf6'),
    ('t0000000000000000000000000000003', 'authentication', '#ef4444'),
    ('t0000000000000000000000000000004', 'configuration', '#f59e0b'),
    ('t0000000000000000000000000000005', 'compliance', '#22c55e'),
    ('t0000000000000000000000000000006', 'crypto', '#06b6d4');
