import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { createHash, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 3000);
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const ADMIN_RISK_URL = process.env.ADMIN_RISK_URL ?? "http://admin-risk:3013";

if (!JWT_ACCESS_SECRET || JWT_ACCESS_SECRET.length < 32) {
  console.error("[gateway] JWT_ACCESS_SECRET must be at least 32 characters");
  process.exit(1);
}
if (!SERVICE_TOKEN || SERVICE_TOKEN.length < 32) {
  console.error("[gateway] SERVICE_TOKEN must be at least 32 characters");
  process.exit(1);
}

/** In Compose every peer is reachable by its service name on the shared
 * network; with `npm run start:all` everything listens on loopback. */
const UPSTREAM_MODE = process.env.UPSTREAM_MODE === "docker" ? "docker" : "local";
const SERVICE_HOSTS = {
  auth: process.env.UPSTREAM_AUTH_HOST ?? "auth",
  "admin-risk": process.env.UPSTREAM_ADMIN_RISK_HOST ?? "admin-risk",
  realtime: process.env.UPSTREAM_REALTIME_HOST ?? "realtime",
  wallet: process.env.UPSTREAM_WALLET_HOST ?? "wallet",
  "responsible-gaming": process.env.UPSTREAM_RG_HOST ?? "responsible-gaming",
  tournaments: process.env.UPSTREAM_TOURNAMENTS_HOST ?? "tournaments",
  chat: process.env.UPSTREAM_CHAT_HOST ?? "chat",
  codenames: process.env.UPSTREAM_CODENAMES_HOST ?? "codenames",
  "game-engine": process.env.UPSTREAM_GAME_ENGINE_HOST ?? "game-engine",
  "gin-rummy": process.env.UPSTREAM_GIN_RUMMY_HOST ?? "gin-rummy",
  leaderboard: process.env.UPSTREAM_LEADERBOARD_HOST ?? "leaderboard",
  pictionary: process.env.UPSTREAM_PICTIONARY_HOST ?? "pictionary",
  promotions: process.env.UPSTREAM_PROMOTIONS_HOST ?? "promotions",
};
const upstreamHost = (service) =>
  UPSTREAM_MODE === "docker" ? SERVICE_HOSTS[service] : "127.0.0.1";

const ROUTES = [
  { prefix: "/v1/auth", service: "auth", port: 3015 },
  { prefix: "/v1/admin-risk", service: "admin-risk", port: 3013 },
  { prefix: "/v1/internal/audit", service: "admin-risk", port: 3013, privileged: true },
  { prefix: "/v1/internal/rbac", service: "admin-risk", port: 3013, privileged: true },
  { prefix: "/v1/events", service: "realtime", port: 3010 },
  { prefix: "/internal/events", service: "realtime", port: 3010, privileged: true },
  { prefix: "/v1/wallet", service: "wallet", port: 3011 },
  { prefix: "/internal/wallet", service: "wallet", port: 3011, privileged: true },
  { prefix: "/v1/responsible-gaming", service: "responsible-gaming", port: 3012 },
  { prefix: "/v1/tournaments", service: "tournaments", port: 3014 },
  { prefix: "/v1/chat", service: "chat", port: 3016 },
  { prefix: "/v1/codenames", service: "codenames", port: 3017 },
  { prefix: "/v1/game", service: "game-engine", port: 3018 },
  { prefix: "/v1/gin-rummy", service: "gin-rummy", port: 3019 },
  { prefix: "/v1/leaderboard", service: "leaderboard", port: 3020 },
  { prefix: "/v1/pictionary", service: "pictionary", port: 3021 },
  { prefix: "/internal", service: "promotions", port: 3022, privileged: true },
  { prefix: "/v1/internal", service: "promotions", port: 3022, privileged: true },
  { prefix: "/v1/promotions", service: "promotions", port: 3022 },
];

/** Privileged routes that peer services call with their own service token,
 * not with a player JWT (chat publishing to realtime, for example). */
const SERVICE_TOKEN_ONLY = ["/internal/events"];

function serviceTokenMatches(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const provided = createHash("sha256").update(value).digest();
  const expected = createHash("sha256").update(SERVICE_TOKEN).digest();
  return timingSafeEqual(provided, expected);
}

function requiredPermission(url) {
  if (url.startsWith("/v1/internal/audit") || url.startsWith("/v1/internal/rbac"))
    return "audit.read";
  return "promotions.manage";
}

/** Fail closed: if admin-risk is down, no privileged call is allowed. */
async function hasPermission(userId, permission, log) {
  try {
    const res = await fetch(`${ADMIN_RISK_URL}/v1/internal/rbac/check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ userId, permission }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body?.data?.allowed);
  } catch (err) {
    log.warn({ err }, "RBAC check failed");
    return false;
  }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  reply.header("access-control-allow-origin", CORS_ORIGIN);
  reply.header("access-control-allow-credentials", "true");
  if (req.method === "OPTIONS") {
    reply.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    // Identity and service-token headers are gateway-owned. Advertising them
    // as browser-settable invites callers to try to spoof them.
    reply.header("access-control-allow-headers", "authorization,content-type,x-request-id");
    return reply.code(204).send();
  }
});

app.get("/health", async () => ({ status: "ok", service: "gateway" }));

async function proxy(req, reply) {
  const target = ROUTES.find((route) => req.url.startsWith(route.prefix));
  if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "unknown route" });

  // Capture the caller's service token before removing it. Every downstream
  // identity header is gateway-owned; clients may not supply them.
  const callerServiceToken = req.headers["x-service-token"];
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  delete headers["x-user-id"];
  delete headers["x-username"];
  delete headers["x-service-token"];

  // Assert identity only from a verified player JWT. Services still receive
  // the original Authorization header and can verify it independently.
  let decoded = null;
  const raw = headers.authorization;
  if (typeof raw === "string" && raw.startsWith("Bearer ")) {
    try {
      decoded = jwt.verify(raw.slice(7), JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
      if (typeof decoded.userId === "string") headers["x-user-id"] = decoded.userId;
      if (typeof decoded.username === "string") headers["x-username"] = decoded.username;
    } catch {
      // Invalid tokens are passed through; the downstream service rejects them.
    }
  }

  if (target.privileged) {
    const peerCall = SERVICE_TOKEN_ONLY.some((prefix) => req.url.startsWith(prefix));
    if (peerCall) {
      if (!serviceTokenMatches(callerServiceToken)) {
        return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid service token" });
      }
    } else {
      if (!decoded?.userId) {
        return reply.code(401).send({
          error: "UNAUTHORIZED",
          message: "a player token is required for this admin route",
        });
      }
      const permission = requiredPermission(req.url);
      if (!(await hasPermission(decoded.userId, permission, req.log))) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: `missing permission ${permission}`,
        });
      }
    }
    headers["x-service-token"] = SERVICE_TOKEN;
  }

  const upstream = `http://${upstreamHost(target.service)}:${target.port}${req.url}`;
  const init = { method: req.method, headers };
  if (req.body !== undefined) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }

  try {
    const res = await fetch(upstream, init);
    const contentType = res.headers.get("content-type") ?? "";
    const requestId = res.headers.get("x-request-id");

    // SSE responses never end, so buffering with res.text() would hang. Pipe
    // the upstream body straight to the client and let the socket close decide
    // when the stream is over.
    if (contentType.includes("text/event-stream") && res.body) {
      reply.hijack();
      const rawReply = reply.raw;
      rawReply.writeHead(res.status, {
        "content-type": contentType,
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": CORS_ORIGIN,
        ...(requestId ? { "x-request-id": requestId } : {}),
      });
      const reader = res.body.getReader();
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            rawReply.write(value);
          }
        } catch (err) {
          req.log.warn({ err }, "event stream closed");
        } finally {
          rawReply.end();
        }
      };
      void pump();
      req.raw.on("close", () => void reader.cancel().catch(() => undefined));
      return;
    }

    const text = await res.text();
    reply.code(res.status);
    if (contentType) reply.header("content-type", contentType);
    if (requestId) reply.header("x-request-id", requestId);
    return reply.send(text);
  } catch (err) {
    return reply.code(503).send({
      error: "SERVICE_UNAVAILABLE",
      message: `upstream ${target.service} unavailable: ${err.message}`,
    });
  }
}

app.all("/v1/*", proxy);
app.all("/internal/*", proxy);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "gateway failed to start");
  process.exit(1);
}
