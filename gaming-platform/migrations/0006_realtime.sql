-- Durable event log for the realtime hub (3010).
--
-- Replacing the in-memory buffer with a table makes SSE replay work across
-- restarts and lets multiple realtime instances share the same event stream.
-- Publishers INSERT a row and send pg_notify; listeners fan the notification
-- out to connected browsers.

CREATE TABLE IF NOT EXISTS realtime_events (
  seq         bigserial PRIMARY KEY,
  topic       text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_realtime_events_topic_seq ON realtime_events(topic, seq);
