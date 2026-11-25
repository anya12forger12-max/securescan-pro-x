import { randomUUID } from "node:crypto";
import { z } from "zod";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { parseCorsOrigins } from "@gp/config";
import { getPool, closePool, createSession, getSession, endSession, joinSession, listSessionPlayers, isSessionParticipant } from "./db.js";
import type { GameEngineEnv } from "./env.js";

/**
 * The request's route path.
 *
 * Fastify 4 exposes it as `req.routerPath`; Fastify 5 removed that and
 * answers `req.routeOptions.url`. The service is on one of them depending
 * on which copy it was built from, and a probe that silently stopped
 * matching is how a container ends up "unhealthy" while serving perfectly.
 */
function requestPath(req: FastifyRequest): string {
  return String(req.routeOptions?.url ?? (req as FastifyRequest & { routerPath?: string }).routerPath ?? req.url ?? "");
}

function headerBearer(value: string | undefined): string | null {
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : null;
}

// Roulette and slot remain Aviator-shell placeholders with no scoring backend,
// so accepting sessions for them creates unscorable games. Crash is now backed
// by the unified crash service: a cash-out is authoritative state and the
// leaderboard verifies it against crash_bets for this exact session.
const CreateSessionSchema = z.object({
  game_type: z.enum(["pictionary", "codenames", "gin-rummy", "crash"]),
});
const JoinSessionSchema = z.object({
  id: z.string().uuid(),
});

export async function buildGameEngineService(env: GameEngineEnv) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  await app.register(cors, { origin: parseCorsOrigins(env.CORS_ORIGIN) });
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: Math.floor(900) },
  });

  // Auth middleware
  app.addHook("onRequest", async (req, reply) => {
    // the probes are not player calls: a container that cannot be probed
    // cannot be reported ready
    if (requestPath(req) === "/health" || requestPath(req) === "/ready") return;
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
      }
      await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
  });

  // ---------- create session ----------
  app.post("/v1/game/sessions", async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    // Get user from JWT
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded = await app.jwt.verify<{ userId: string }>(token);
    const pool = getPool(env.DATABASE_URL);
    const session = await createSession(pool, {
      id: randomUUID(),
      game_type: parsed.data.game_type,
      host_id: decoded.userId,
    });
    // Host joins the session
    await joinSession(pool, session.id, decoded.userId);
    return reply.code(201).send({ session });
  });

  // ---------- get session ----------
  app.get("/v1/game/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const token = headerBearer(req.headers.authorization);
    if (!token)
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    let decoded: { userId: string };
    try {
      decoded = await app.jwt.verify<{ userId: string }>(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const session = await getSession(pool, id);
    if (!session) {
      return reply.code(404).send({ error: "SESSION_NOT_FOUND", message: "session not found" });
    }
    // Session metadata and the player list are only meaningful to people in
    // the game; an authenticated outsider must not be able to enumerate them
    // by guessing/learning a UUID.
    if (!(await isSessionParticipant(pool, id, decoded.userId))) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "only session players may view this session" });
    }
    const players = await listSessionPlayers(pool, id);
    return reply.send({ session, players });
  });

  // ---------- join session ----------
  app.post("/v1/game/sessions/:id/join", async (req, reply) => {
    const parsed = JoinSessionSchema.safeParse(req.params as { id: string });
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    }
    const decoded = await app.jwt.verify<{ userId: string }>(token);
    const pool = getPool(env.DATABASE_URL);
    const session = await getSession(pool, parsed.data.id);
    if (!session) {
      return reply.code(404).send({ error: "SESSION_NOT_FOUND", message: "session not found" });
    }
    if (session.status !== "waiting") {
      return reply.code(409).send({ error: "SESSION_NOT_WAITING", message: "session is not accepting players" });
    }
    const player = await joinSession(pool, parsed.data.id, decoded.userId);
    if (!player) {
      return reply.code(409).send({ error: "ALREADY_JOINED", message: "player already joined this session" });
    }
    return reply.send({ player });
  });

  // ---------- end session ----------
  app.post("/v1/game/sessions/:id/end", async (req, reply) => {
    const { id } = req.params as { id: string };
    const token = headerBearer(req.headers.authorization);
    if (!token)
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    let decoded: { userId: string };
    try {
      decoded = await app.jwt.verify<{ userId: string }>(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const session = await getSession(pool, id);
    if (!session)
      return reply.code(404).send({ error: "SESSION_NOT_FOUND", message: "session not found" });
    if (session.host_id !== decoded.userId)
      return reply.code(403).send({ error: "FORBIDDEN", message: "only the host may end a session" });
    await endSession(pool, id);
    return reply.send({ ok: true });
  });

  // ---- health and readiness ----
  app.get("/health", async () => ({ status: "ok", service: "game-engine" }));
  app.get("/ready", async (_req, reply) => {
    try {
      const pool = getPool(env.DATABASE_URL);
      await pool.query("SELECT 1");
      return reply.code(200).send({ status: "ready" });
    } catch {
      return reply.code(503).send({ status: "not_ready", reason: "database unavailable" });
    }
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
