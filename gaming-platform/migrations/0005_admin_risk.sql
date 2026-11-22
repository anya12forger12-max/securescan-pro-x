-- Admin-risk (3013): static RBAC catalogue, user role grants and the
-- hash-chained audit log written by every privileged admin action.

CREATE TABLE IF NOT EXISTS admin_roles (
  name        text PRIMARY KEY,
  description text
);

CREATE TABLE IF NOT EXISTS admin_user_roles (
  user_id    text NOT NULL,
  role       text NOT NULL REFERENCES admin_roles(name),
  granted_by text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  seq        bigserial PRIMARY KEY,
  prev_hash  text NOT NULL,
  hash       text NOT NULL,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_user_roles_role ON admin_user_roles(role);
CREATE INDEX IF NOT EXISTS idx_admin_user_roles_granted_by ON admin_user_roles(granted_by);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_seq_desc ON admin_audit_log(seq DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor_seq ON admin_audit_log(actor, seq DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action_seq ON admin_audit_log(action, seq DESC);

INSERT INTO admin_roles (name, description) VALUES
  ('admin',   'Full administrative access to all privileged actions'),
  ('risk',    'Risk review and audit log access'),
  ('support', 'Read-only audit log access'),
  ('player',  'No administrative privileges')
ON CONFLICT (name) DO NOTHING;
