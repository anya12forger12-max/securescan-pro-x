import { z } from "zod";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { getPool, closePool, createLeaderboardEntry, getLeaderboard, getUserBestScores, getUserStats, verifyGameResult } from "./db.js";
import type { LeaderboardEnv } from "./env.js";

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

interface JwtPayload {
  userId: string;
  username: string;
}

const SubmitScoreSchema = z.object({
  game_type: z.string().min(1).max(32),
  score: z.coerce.number().int().min(0).max(1000000000),
  session_id: z.string().uuid(),
});
const LimitSchema = z.coerce.number().int().min(1).max(100).default(50);

export async function buildLeaderboardService(env: LeaderboardEnv) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: Math.floor(900) },
  });

  // ---------- get leaderboard (public) ----------
  app.get("/v1/leaderboard/:gameType", async (req, reply) => {
    const { gameType } = req.params as { gameType: string };
    const parsed = LimitSchema.safeParse((req.query as { limit?: string }).limit ?? undefined);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const limit = parsed.data;
    const pool = getPool(env.DATABASE_URL);
    const entries = await getLeaderboard(pool, gameType, limit);
    return reply.send({ gameType, entries });
  });

  // ---------- submit score (auth required) ----------
  app.post("/v1/leaderboard/scores", async (req, reply) => {
    const parsed = SubmitScoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    }
    const token = authHeader.replace("Bearer ", "");
    let decoded: JwtPayload;
    try {
      decoded = await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const verified = await verifyGameResult(pool, {
      sessionId: parsed.data.session_id,
      userId: decoded.userId,
      gameType: parsed.data.game_type,
    });
    if (!verified) {
      return reply.code(403).send({ error: "INVALID_GAME_RESULT", message: "score must come from a completed game the player joined" });
    }
    const entry = await createLeaderboardEntry(pool, {
      user_id: decoded.userId,
      username: decoded.username,
      game_type: parsed.data.game_type,
      score: parsed.data.score,
      session_id: parsed.data.session_id,
    });
    return reply.code(201).send({ entry });
  });

  // ---------- get user scores (auth required) ----------
  app.get("/v1/leaderboard/me", async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    }
    const token = authHeader.replace("Bearer ", "");
    let decoded: JwtPayload;
    try {
      decoded = await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const entries = await getUserBestScores(pool, decoded.userId);
    const stats = await getUserStats(pool, decoded.userId);
    return reply.send({ entries, stats });
  });

  // ---- health and readiness ----
  app.get("/health", async () => ({ status: "ok", service: "leaderboard" }));
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
