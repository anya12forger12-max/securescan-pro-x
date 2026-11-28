-- v2 operator signatures bind a nonce to the request and must be single-use.
-- The primary key makes concurrent replays safe without a read-then-write race;
-- expired rows are cleaned opportunistically by the crash service.
CREATE TABLE IF NOT EXISTS operator_signature_nonces (
  key_hash   text        NOT NULL,
  nonce      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_hash, nonce)
);

CREATE INDEX IF NOT EXISTS idx_operator_signature_nonces_expires
  ON operator_signature_nonces (expires_at);
