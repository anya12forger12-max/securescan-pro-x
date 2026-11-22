import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { baseEnvSchema, dbPoolOptions, loadEnv } from "@gp/config";
import { ERROR_CODES, serviceTokenOk } from "@gp/shared-types";

/**
 * Realtime fan-out service (3010) -- the default REALTIME_URL of the game
 * services. Events are durable: a publish inserts into realtime_events and
 * sends pg_notify, while SSE clients are fed by a single LISTEN connection.
 * That makes replay after a restart (or across multiple instances) possible.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().min(1).url(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL, 10));

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });

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

function writeEvent(res, event) {
  res.write(`id: ${event.seq}\nevent: ${event.topic}\ndata: ${JSON.stringify(event.payload)}\n\n`);
}

/** Deliver an event once per client. lastSeq deduplicates the case where a
 * client replays from the table at the same moment the LISTEN notification
 * for that row arrives. */
function broadcast(event) {
  for (const client of clients) {
    const seq = Number(event.seq);
    if (seq <= client.lastSeq) continue;
    try {
      writeEvent(client.res, event);
      client.lastSeq = seq;
    } catch {
      clients.delete(client);
    }
  }
}

async function startListener() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  client.on("notification", async (msg) => {
    const seq = Number(msg.payload);
    if (!Number.isFinite(seq)) return;
    try {
      const result = await pool.query(
        `SELECT seq, topic, payload, published_at FROM realtime_events WHERE seq = $1`,
        [seq],
      );
      if (result.rowCount) broadcast(result.rows[0]);
    } catch (err) {
      app.log.warn({ err }, "failed to load notified event");
    }
  });
  client.on("error", (err) => {
    app.log.warn({ err }, "realtime LISTEN connection failed");
    scheduleReconnect();
  });
  client.on("end", () => scheduleReconnect());
  try {
    await client.connect();
    await client.query("LISTEN realtime_events");
    listener = client;
    app.log.info("realtime listening on realtime_events");
  } catch (err) {
    app.log.warn({ err }, "initial LISTEN failed");
    scheduleReconnect();
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
  topic: z.string().min(1).max(64),
  payload: z.unknown().default({}),
});

app.post("/internal/events", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO realtime_events (topic, payload)
       VALUES ($1, $2::jsonb)
       RETURNING seq, topic, payload, published_at`,
      [parsed.data.topic, JSON.stringify(parsed.data.payload ?? {})],
    );
    // Notify from the same connection after the INSERT commits (implicit
    // transaction), so listeners never see a seq that is not yet visible.
    await client.query("SELECT pg_notify('realtime_events', $1)", [String(result.rows[0].seq)]);
    return ok(reply, 201, { event: result.rows[0] }, reqId(req));
  } catch (err) {
    req.log.error({ err }, "event publish failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "publish failed");
  } finally {
    client.release();
  }
});

app.get("/v1/events", async (req, reply) => {
  const since = Math.max(0, Number(req.query.since ?? 0) || 0);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const result = await pool.query(
    `SELECT seq, topic, payload, published_at FROM realtime_events
     WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
    [since, limit],
  );
  const latest = await pool.query(`SELECT COALESCE(max(seq), 0)::bigint AS n FROM realtime_events`);
  return ok(reply, 200, { items: result.rows, latest: Number(latest.rows[0].n) }, reqId(req));
});

app.get("/v1/events/stream", async (req, reply) => {
  const sinceParam = req.query.since;
  let since;
  if (sinceParam === undefined) {
    const latest = await pool.query(`SELECT COALESCE(max(seq), 0)::bigint AS n FROM realtime_events`);
    since = Number(latest.rows[0].n);
  } else {
    since = Math.max(0, Number(sinceParam) || 0);
  }

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": env.CORS_ORIGIN,
  });
  res.write(": connected\n\n");

  const backlog = await pool.query(
    `SELECT seq, topic, payload, published_at FROM realtime_events
     WHERE seq > $1 ORDER BY seq ASC LIMIT 500`,
    [since],
  );
  const client = { res, lastSeq: since };
  for (const event of backlog.rows) {
    writeEvent(res, event);
    client.lastSeq = Number(event.seq);
  }
  clients.add(client);

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
      clients.delete(client);
    }
  }, 15000);
  heartbeat.unref?.();
  req.raw.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
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
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
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
