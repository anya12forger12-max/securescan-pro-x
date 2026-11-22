import { randomUUID } from "node:crypto";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { getPool, closePool, createMessage, listMessages, createRoom, listRooms } from "./db.js";
/**
 * The request's route path.
 *
 * Fastify 4 exposes it as `req.routerPath`; Fastify 5 removed that and
 * answers `req.routeOptions.url`. The service is on one of them depending
 * on which copy it was built from, and a probe that silently stopped
 * matching is how a container ends up "unhealthy" while serving perfectly.
 */
function requestPath(req) {
    return String(req.routeOptions?.url ?? req.routerPath ?? req.url ?? "");
}
const SendMessageSchema = z.object({
    content: z.string().min(1).max(4000),
});
const CreateRoomSchema = z.object({
    name: z.string().min(1).max(64),
});
export async function buildChatService(env) {
    const app = Fastify({ logger: { level: env.LOG_LEVEL } });
    // Realtime notification is best-effort: the message is durable in Postgres
    // before we publish, so a dead event hub must never fail a user request.
    const publish = async (topic, payload) => {
        try {
            await fetch(`${env.REALTIME_URL}/internal/events`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-service-token": env.REALTIME_SERVICE_TOKEN,
                },
                body: JSON.stringify({ topic, payload }),
                signal: AbortSignal.timeout(2000),
            });
        }
        catch (err) {
            app.log.warn({ err }, `realtime publish of ${topic} failed`);
        }
    };
    await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });
    await app.register(jwt, {
        secret: env.JWT_ACCESS_SECRET,
        sign: { expiresIn: Math.floor(900) },
    });
    // Auth middleware
    app.addHook("onRequest", async (req, reply) => {
        // the probes are not player calls: a container that cannot be probed
        // cannot be reported ready
        if (requestPath(req) === "/health" || requestPath(req) === "/ready")
            return;
        // Fastify 5 removed `req.routerPath`, so the path check that used to
        // exempt the public listing silently stopped matching -- and every route,
        // the public one included, demanded a token. `req.routeOptions.url` is
        // its replacement. The exemption is for the listing only: creating a room
        // needs a player, which the path-only check never meant to allow.
        if (req.method === "GET" && req.routeOptions.url === "/v1/chat/rooms")
            return;
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        if (!token) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        try {
            await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
    });
    // ---------- list rooms ----------
    app.get("/v1/chat/rooms", async (_req, reply) => {
        const pool = getPool(env.DATABASE_URL);
        const rooms = await listRooms(pool);
        return reply.send({ rooms });
    });
    // ---------- create room ----------
    app.post("/v1/chat/rooms", async (req, reply) => {
        const parsed = CreateRoomSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        const pool = getPool(env.DATABASE_URL);
        const id = randomUUID();
        const room = await createRoom(pool, id, parsed.data.name);
        void publish("chat.room.created", { room });
        return reply.code(201).send({ room });
    });
    // ---------- list messages ----------
    app.get("/v1/chat/rooms/:room/messages", async (req, reply) => {
        const { room } = req.params;
        // pg throws on NaN/unbounded LIMIT values; validate at the boundary.
        const parsedLimit = z.coerce.number().int().min(1).max(100).default(50).safeParse(req.query.limit ?? undefined);
        if (!parsedLimit.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsedLimit.error.flatten() });
        }
        const limit = parsedLimit.data;
        const pool = getPool(env.DATABASE_URL);
        const messages = await listMessages(pool, room, limit);
        return reply.send({ messages });
    });
    // ---------- send message ----------
    app.post("/v1/chat/rooms/:room/messages", async (req, reply) => {
        const parsed = SendMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        // FIX: the room is authoritative in the URL (the GET history route uses
        // the same :room param). Reading it from the body allowed a message to be
        // stored under a different room than the one addressed by the URL.
        const { room } = req.params;
        const { content } = parsed.data;
        // Get user from JWT (already verified by onRequest hook)
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        let decoded;
        try {
            decoded = await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
        const pool = getPool(env.DATABASE_URL);
        const message = await createMessage(pool, {
            id: randomUUID(),
            room,
            user_id: decoded.userId,
            username: decoded.username,
            content,
        });
        void publish("chat.message", { message });
        return reply.code(201).send({ message });
    });
    // ---- health and readiness ----
    app.get("/health", async () => ({ status: "ok", service: "chat" }));
    app.get("/ready", async (_req, reply) => {
        try {
            const pool = getPool(env.DATABASE_URL);
            await pool.query("SELECT 1");
            return reply.code(200).send({ status: "ready" });
        }
        catch {
            return reply.code(503).send({ status: "not_ready", reason: "database unavailable" });
        }
    });
    app.addHook("onClose", async () => {
        await closePool();
    });
    return app;
}
