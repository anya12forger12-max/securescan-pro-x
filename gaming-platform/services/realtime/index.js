import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { baseEnvSchema, capabilityFields, dbPoolOptions, loadEnv, parseCorsOrigins } from "@gp/config";
import { ERROR_CODES, boundedInt, serviceTokenOk } from "@gp/shared-types";

/**
 * Realtime fan-out service (3010) -- the default REALTIME_URL of the game
 * services. Events are durable: a publish inserts into realtime_events and
 * sends pg_notify, while SSE clients are fed by a single LISTEN connection.
 * That makes replay after a restart (or across multiple instances) possible.
 */
const envSchema = baseEnvSchema.extend({
  ...capabilityFields("REALTIME_SERVICE_TOKEN"),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().min(1).url(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MAX_STREAMS: z.coerce.number().int().positive().default(500),
  EVENT_RETENTION_HOURS: z.coerce.number().int().positive().default(168),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL, 10));

const CORS_ORIGINS = parseCorsOrigins(env.CORS_ORIGIN);
const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: CORS_ORIGINS });

/** Echo only an exact configured origin. A comma-separated list is not a
 * valid Access-Control-Allow-Origin value and credentials require an exact
 * match rather than `*`. */
function streamOrigin(req) {
  const requested = req.headers.origin;
  return typeof requested === "string" && CORS_ORIGINS.includes(requested) ? requested : null;
}

app.addHook("onRequest", async (req, reply) => {
  const requestId = req.headers["x-request-id"] ?? randomUUID();
  req.headers["x-request-id"] = requestId;
  reply.header("x-request-id", requestId);
});

const reqId = (req) => String(req.headers["x-request-id"] ?? "");
const ok = (reply, status, data, requestId) =>
  reply.code(status).send({ request_id: requestId, success: true, data });
const deny = (reply, status, code, message) =>
  reply.code(status).send({
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    error: { code, message },
  });

const clients = new Set();
let listener = null;
let reconnectTimer = null;
let shuttingDown = false;
// A LISTEN reconnect must replay the durable log to streams that stayed open
// during the outage. Notifications arriving during a snapshot (or reconnect)
// replay are buffered so an older replayed row cannot be skipped by a newer
// live seq. A depth counter covers overlapping client/reconnect replays.
let replayDepth = 0;
let draining = false;
const pendingNotifications = new Set();
// Notifications are delivered one at a time so a faster query for seq N+1
// cannot advance lastSeq past a still-in-flight seq N and hide it forever.
let deliveryChain = Promise.resolve();

// A client that stops reading must not let its queue grow without bound.
const MAX_CLIENT_QUEUE = 256;

/** Bound durable history as well: prune rows past the retention window in the
 * background. The timer is unref'd so it never keeps the process alive. Since
 * pruning can remove rows behind a client's `since` cursor, both polling and
 * SSE replay report an explicit retention gap before sending whatever rows
 * remain (see retentionSnapshot/formatGap below). */
const pruneTimer = setInterval(async () => {
  if (shuttingDown) return;
  try {
    await pool.query(
      `DELETE FROM realtime_events
       WHERE published_at < now() - ($1::int * interval '1 hour')`,
      [env.EVENT_RETENTION_HOURS],
    );
  } catch (err) {
    app.log.warn({ err }, "realtime event retention prune failed");
  }
}, Math.min((env.EVENT_RETENTION_HOURS * 3_600_000) / 2, 3_600_000));
pruneTimer.unref?.();

/** Every stored event is replayed to every authenticated player, so every
 * payload is redacted on write and read. Topic-specific exceptions used to let
 * `config.updated` publish user ids and bonus amounts to the whole lobby.
 * Unknown fields (e.g. a `marker` used by tests) are preserved. */
const SENSITIVE_KEYS = new Set([
  "userId",
  "user_id",
  "amount",
  "payout",
  "cashoutAt",
  "cashout_at",
  "autoCashout",
  "auto_cashout",
  "losers",
  "balanceAfter",
  "balance_after",
  "sessionId",
  "session_id",
  "referenceId",
  "reference_id",
  "email",
  "username",
]);

/** Recursive, idempotent redaction for public-broadcast payloads. Dates are
 * returned untouched so JSON.stringify can serialize them normally. */
function sanitizeEventData(value) {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeEventData);
  if (value === null || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key) || key === "__proto__") continue;
    clean[key] = sanitizeEventData(item);
  }
  return clean;
}

/** Applied on write and on every read so older rows cannot leak either. */
const sanitizePayload = (payload) => sanitizeEventData(payload ?? {});

function publicEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return event;
  return { ...event, payload: sanitizePayload(event.payload) };
}

/** SSE `event:` is a single line: a topic containing CR/LF would start forged
 * frames (for example a fake `data:` line with a huge seq) and permanently
 * desynchronise browser cursors. Publishing validates topics, but rows written
 * by an older version may still be replayed, so sanitise on the way out too. */
const safeTopic = (topic) =>
  /^[a-z][a-z0-9._-]{0,63}$/.test(String(topic)) ? topic : "event";

/** pg returns bigserial as a string; send the full normalized event so SSE
 * clients can use `seq` directly instead of guessing from the frame id. */
function formatEvent(event) {
  const safe = publicEvent(event);
  const normalized = {
    ...safe,
    seq: Number(safe.seq),
    topic: safeTopic(safe.topic),
    published_at:
      safe.published_at instanceof Date ? safe.published_at.toISOString() : safe.published_at,
  };
  return `id: ${normalized.seq}\nevent: ${normalized.topic}\ndata: ${JSON.stringify(normalized)}\n\n`;
}

/**
 * Retention pruning can delete rows in front of a client's `since` cursor, so
 * replaying `seq > since` would silently skip the missing history. The oldest
 * retained seq tells clients that a gap occurred; a null oldest means every
 * row has been pruned, which is a gap for any non-zero cursor. Both /v1/events
 * and the SSE replay path use this snapshot so the signal is consistent.
 */
async function retentionSnapshot(since) {
  const result = await pool.query(
    `SELECT min(seq)::bigint AS oldest, COALESCE(max(seq), 0)::bigint AS latest FROM realtime_events`,
  );
  const row = result.rows[0] ?? {};
  const oldest = row.oldest === null || row.oldest === undefined ? null : Number(row.oldest);
  const latest = Number(row.latest ?? 0);
  return { gap: oldest === null ? since > 0 : since < oldest, oldest, latest };
}

/**
 * SSE control frame for a retention gap. It deliberately has no `id:` line so
 * the last numeric event id seen by a client stays unchanged, and no `seq`
 * field in its data so old consumers that only understand normal events ignore
 * it. The earliest retained events are replayed immediately afterwards.
 */
function formatGap(since, oldest, latest) {
  return `event: gap\ndata: ${JSON.stringify({
    gap: true,
    resync_required: true,
    since,
    oldest_seq: oldest,
    latest_seq: latest,
  })}\n\n`;
}

/** Flush one client's queue in seq order. write() returning false means the
 * socket buffer is full; wait for `drain` before writing more. */
function flushClient(client) {
  if (client.closed || client.writing || !client.writable || !clients.has(client)) return;
  client.writing = true;
  try {
    while (client.queue.length) {
      let accepted;
      try {
        accepted = client.res.write(client.queue[0]);
      } catch {
        clients.delete(client);
        client.closed = true;
        client.queue.length = 0;
        return;
      }
      client.queue.shift();
      if (!accepted) {
        client.writable = false;
        client.writing = false;
        client.res.once("drain", () => {
          client.writable = true;
          flushClient(client);
        });
        return;
      }
    }
  } finally {
    client.writing = false;
  }
}

/** Deliver an event once per client. lastSeq deduplicates the case where a
 * client replays from the table at the same moment the LISTEN notification
 * for that row arrives. Frames are queued in broadcast order; a consumer that
 * never drains is dropped so the durable log can be replayed on reconnect. */
function broadcast(event) {
  for (const client of clients) {
    const seq = Number(event.seq);
    if (seq <= client.lastSeq) continue;
    client.lastSeq = seq;
    client.queue.push(formatEvent(event));
    if (client.queue.length > MAX_CLIENT_QUEUE) {
      clients.delete(client);
      client.closed = true;
      client.queue.length = 0;
      app.log.warn({ seq }, "dropping backpressured realtime client");
      try {
        client.res.end();
      } catch {
        /* already closed */
      }
      continue;
    }
    flushClient(client);
  }
}

/** Load one notified seq from the durable log. Reading by seq (rather than
 * trusting the payload) keeps ordering and full event metadata consistent. */
async function deliverNotification(seq) {
  const result = await pool.query(
    `SELECT seq, topic, payload, published_at FROM realtime_events WHERE seq = $1`,
    [seq],
  );
  if (result.rowCount) broadcast(result.rows[0]);
}

/** Notifications received while a replay is in flight are held until the
 * snapshot finishes, then replayed in seq order. */
async function drainNotifications() {
  if (replayDepth > 0 || draining || pendingNotifications.size === 0) return;
  draining = true;
  try {
    while (pendingNotifications.size) {
      const batch = [...pendingNotifications].sort((a, b) => a - b);
      pendingNotifications.clear();
      for (const seq of batch) await enqueueDelivery(seq);
    }
  } catch (err) {
    app.log.warn({ err }, "failed to drain buffered realtime notifications");
  } finally {
    draining = false;
  }
}

function enqueueDelivery(seq) {
  deliveryChain = deliveryChain
    .then(() => deliverNotification(seq))
    .catch((err) => app.log.warn({ err, seq }, "failed to deliver notified event"));
  return deliveryChain;
}

function onNotification(msg) {
  const seq = Number(msg.payload);
  if (!Number.isFinite(seq)) return;
  if (replayDepth > 0 || draining) {
    pendingNotifications.add(seq);
    return;
  }
  void enqueueDelivery(seq).then(() => drainNotifications());
}

/** Replay every durable row after `floor` to the still-open streams. Called
 * after LISTEN is re-established, so events published during the outage are
 * no longer lost just because the notification connection was down. */
async function replayEventsAfter(floor) {
  if (clients.size === 0) return;
  const batchSize = 500;
  let cursor = floor;
  for (;;) {
    const result = await pool.query(
      `SELECT seq, topic, payload, published_at FROM realtime_events
       WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
      [cursor, batchSize],
    );
    if (!result.rowCount) return;
    for (const event of result.rows) {
      // broadcast -> formatEvent is the single sanitizer choke point for all
      // SSE frames, including rows replayed after a LISTEN reconnect.
      broadcast(event);
      cursor = Number(event.seq);
    }
    if (result.rows.length < batchSize) return;
  }
}

async function startListener() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  client.on("notification", onNotification);
  client.on("error", (err) => {
    app.log.warn({ err }, "realtime LISTEN connection failed");
    scheduleReconnect();
  });
  client.on("end", () => scheduleReconnect());
  // Hold notifications from the moment LISTEN is acquired until the durable
  // replay has caught up, otherwise a live seq could overtake a replayed one.
  replayDepth++;
  try {
    await client.connect();
    await client.query("LISTEN realtime_events");
    listener = client;
    app.log.info("realtime listening on realtime_events");
    const floors = [...clients].map((entry) => entry.lastSeq);
    if (floors.length) await replayEventsAfter(Math.min(...floors));
  } catch (err) {
    app.log.warn({ err }, "initial LISTEN failed");
    scheduleReconnect();
  } finally {
    replayDepth--;
    void drainNotifications();
  }
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  listener = null;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startListener();
  }, 2000);
  reconnectTimer.unref?.();
}

const EventSchema = z.object({
  // Only a safe SSE event name may be published. Control characters would be
  // written verbatim into the `event:` line and could forge additional frames.
  topic: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/, "invalid event topic"),
  payload: z.unknown().default({}),
});

app.post("/internal/events", async (req, reply) => {
  // Publishing is capability scoped so a compromised game process cannot
  // forge arbitrary realtime events with the general service token.
  if (!serviceTokenOk(req.headers, env.REALTIME_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const payload = sanitizePayload(parsed.data.payload ?? {});
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO realtime_events (topic, payload)
       VALUES ($1, $2::jsonb)
       RETURNING seq, topic, payload, published_at`,
      [parsed.data.topic, JSON.stringify(payload)],
    );
    // Notify from the same connection after the INSERT commits (implicit
    // transaction), so listeners never see a seq that is not yet visible.
    await client.query("SELECT pg_notify('realtime_events', $1)", [String(result.rows[0].seq)]);
    return ok(reply, 201, { event: publicEvent(result.rows[0]) }, reqId(req));
  } catch (err) {
    req.log.error({ err }, "event publish failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "publish failed");
  } finally {
    client.release();
  }
});

app.get("/v1/events", async (req, reply) => {
  const since = boundedInt(req.query.since, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = boundedInt(req.query.limit, 50, 1, 200);
  // Keep `items` and `latest` unchanged for existing pollers; only add the
  // gap metadata when the cursor predates the oldest retained row. The query
  // still returns the earliest available events in seq order after the gap.
  const { gap, oldest, latest } = await retentionSnapshot(since);
  const result = await pool.query(
    `SELECT seq, topic, payload, published_at FROM realtime_events
     WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
    [since, limit],
  );
  return ok(
    reply,
    200,
    {
      items: result.rows.map(publicEvent),
      latest,
      gap,
      ...(gap ? { gap_since: since, oldest_seq: oldest, resync_required: true } : {}),
    },
    reqId(req),
  );
});

app.get("/v1/events/stream", async (req, reply) => {
  const sinceParam = req.query.since;
  const requested =
    sinceParam === undefined ? null : boundedInt(sinceParam, 0, 0, Number.MAX_SAFE_INTEGER);
  // One snapshot supplies both the replay cursor and the retention check. A
  // request without `since` is explicitly live-only, so it has no gap to
  // report even if older rows have already been pruned.
  const { gap, oldest, latest } = await retentionSnapshot(requested ?? 0);
  const since = requested ?? latest;
  const gapDetected = requested !== null && gap;

  // Bound concurrent fan-out. The check sits immediately before hijack/add
  // with no await in between, so two simultaneous requests cannot both take
  // the last slot.
  if (clients.size >= env.MAX_STREAMS) {
    return deny(reply, 429, "TOO_MANY_STREAMS", "event stream limit reached");
  }

  reply.hijack();
  const res = reply.raw;
  const allowedOrigin = streamOrigin(req);
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
  });
  res.write(": connected\n\n");
  if (gapDetected) {
    // Tell the client before replaying the earliest retained rows. Without
    // this marker a pruned `since` would look like an uneventful reconnection;
    // normal numeric-id event frames follow it unchanged.
    res.write(formatGap(since, oldest, latest));
  }

  // Register before taking the snapshot: a publish between the snapshot query
  // and clients.add() would otherwise notify existing streams only and leave
  // this one permanently behind. Live notifications are buffered meanwhile.
  const client = {
    res,
    lastSeq: since,
    queue: [],
    writable: true,
    writing: false,
    closed: false,
  };
  clients.add(client);

  const heartbeat = setInterval(() => {
    if (client.closed || !client.writable) return;
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
      clients.delete(client);
      client.closed = true;
      client.queue.length = 0;
    }
  }, 15000);
  heartbeat.unref?.();
  // Use the response lifetime, not IncomingMessage: on a GET request "close"
  // can fire as soon as the request is complete while the SSE response stays
  // open, which would silently stop delivering live events to this client.
  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
    client.closed = true;
    client.queue.length = 0;
  });

  replayDepth++;
  try {
    await replayEventsAfter(since);
  } catch (err) {
    req.log.error({ err }, "event snapshot replay failed");
    clearInterval(heartbeat);
    clients.delete(client);
    client.closed = true;
    client.queue.length = 0;
    res.end();
  } finally {
    replayDepth--;
    void drainNotifications();
  }
});

app.get("/health", async () => ({
  status: "ok",
  service: "realtime",
  clients: clients.size,
  listening: listener !== null,
}));
app.get("/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch (err) {
    return reply.code(503).send({ status: "error", message: err.message });
  }
});

app.addHook("onClose", async () => {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  clearInterval(pruneTimer);
  if (listener) {
    try {
      await listener.query("UNLISTEN realtime_events");
      await listener.end();
    } catch {
      listener.end();
    }
  }
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      /* already closed */
    }
  }
  clients.clear();
  await pool.end();
});

await startListener();

try {
  await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "realtime failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}

// app.close() runs the onClose hook, which drops SSE clients and ends both the
// LISTEN connection and the pool before the container is killed.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}
