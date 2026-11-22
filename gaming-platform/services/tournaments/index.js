import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { baseEnvSchema, loadEnv } from "@gp/config";
import { ERROR_CODES, serviceTokenOk, toMoney } from "@gp/shared-types";

/**
 * Tournaments service (3014). The promotions env comment reserves this port,
 * but no compiled service shipped an implementation. This provides the basic
 * catalogue + registration lifecycle so the port is no longer a placeholder.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3014),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });
await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });

app.addHook("onRequest", async (req, reply) => {
  const requestId = req.headers["x-request-id"] ?? randomUUID();
  req.headers["x-request-id"] = requestId;
  reply.header("x-request-id", requestId);
});
app.addHook("onClose", async () => {
  await pool.end();
});

const headerString = (headers, name) =>
  typeof headers[name] === "string" && headers[name].length > 0 ? headers[name] : null;
const reqId = (req) => String(req.headers["x-request-id"] ?? "");
const ok = (reply, status, data, requestId) =>
  reply.code(status).send({ request_id: requestId, success: true, data });
const deny = (reply, status, code, message) =>
  reply.code(status).send({
    request_id: String(reply.getHeader("x-request-id") ?? ""),
    error: { code, message },
  });

async function requestUserId(req) {
  const raw = headerString(req.headers, "authorization");
  if (raw?.startsWith("Bearer ")) {
    try {
      const decoded = await app.jwt.verify(raw.slice(7));
      return typeof decoded.userId === "string" && decoded.userId ? decoded.userId : null;
    } catch {
      return null;
    }
  }
  if (serviceTokenOk(req.headers, env.SERVICE_TOKEN))
    return headerString(req.headers, "x-user-id");
  return null;
}

const GameTypes = ["crash", "roulette", "slot", "pictionary", "codenames", "gin-rummy"];
const CreateSchema = z.object({
  gameType: z.enum(GameTypes),
  title: z.string().min(1).max(120),
  maxPlayers: z.coerce.number().int().min(2).max(1000),
  entryFee: z.coerce.number().nonnegative().finite().default(0),
  prizePool: z.coerce.number().nonnegative().finite().default(0),
  startsAt: z.string().datetime().optional(),
});

app.post("/v1/tournaments", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");

  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  const b = parsed.data;
  const result = await pool.query(
    `INSERT INTO tournaments
      (id, game_type, title, max_players, entry_fee, prize_pool, starts_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      randomUUID(),
      b.gameType,
      b.title,
      b.maxPlayers,
      toMoney(b.entryFee),
      toMoney(b.prizePool),
      b.startsAt ?? null,
      userId,
    ],
  );
  return ok(reply, 201, { tournament: result.rows[0] }, reqId(req));
});

app.get("/v1/tournaments", async (req, reply) => {
  const status = req.query.status;
  const result = status
    ? await pool.query(`SELECT * FROM tournaments WHERE status = $1 ORDER BY created_at DESC`, [status])
    : await pool.query(`SELECT * FROM tournaments ORDER BY created_at DESC`);
  return ok(reply, 200, { items: result.rows }, reqId(req));
});

app.get("/v1/tournaments/:id", async (req, reply) => {
  const { id } = req.params;
  const result = await pool.query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  if (!result.rowCount)
    return deny(reply, 404, ERROR_CODES.NOT_FOUND, "tournament not found");
  const players = await pool.query(
    `SELECT user_id, joined_at FROM tournament_players WHERE tournament_id = $1 ORDER BY joined_at`,
    [id],
  );
  return ok(reply, 200, { tournament: result.rows[0], players: players.rows }, reqId(req));
});

app.post("/v1/tournaments/:id/join", async (req, reply) => {
  const userId = await requestUserId(req);
  if (!userId)
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");

  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tournament = await client.query(
      `SELECT max_players, status FROM tournaments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!tournament.rowCount) {
      await client.query("ROLLBACK");
      return deny(reply, 404, ERROR_CODES.NOT_FOUND, "tournament not found");
    }
    if (tournament.rows[0].status !== "registering") {
      await client.query("ROLLBACK");
      return deny(reply, 409, ERROR_CODES.CONFLICT, "registration is closed");
    }
    const count = await client.query(
      `SELECT count(*)::int AS n FROM tournament_players WHERE tournament_id = $1`,
      [id],
    );
    if (count.rows[0].n >= tournament.rows[0].max_players) {
      await client.query("ROLLBACK");
      return deny(reply, 409, ERROR_CODES.CONFLICT, "tournament is full");
    }
    await client.query(
      `INSERT INTO tournament_players (id, tournament_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id, user_id) DO NOTHING`,
      [randomUUID(), id, userId],
    );
    await client.query("COMMIT");
    return ok(reply, 200, { joined: true }, reqId(req));
  } catch (err) {
    await client.query("ROLLBACK");
    req.log.error({ err }, "tournament join failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "join failed");
  } finally {
    client.release();
  }
});

app.get("/health", async () => ({ status: "ok", service: "tournaments" }));
app.get("/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch (err) {
    return reply.code(503).send({ status: "error", message: err.message });
  }
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "tournaments failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}
