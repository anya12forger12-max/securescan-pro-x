import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const ADMIN_SERVICE_TOKEN = process.env.ADMIN_SERVICE_TOKEN;
const WALLET_SERVICE_TOKEN = process.env.WALLET_SERVICE_TOKEN;
const REALTIME_SERVICE_TOKEN = process.env.REALTIME_SERVICE_TOKEN;
const PROMOTIONS_SERVICE_TOKEN = process.env.PROMOTIONS_SERVICE_TOKEN;
const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN;
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Echo only a configured origin. A comma-separated allow-list in one header
 * is invalid, and credentials require an exact origin rather than `*`. */
function corsOrigin(req) {
  const requested = req.headers.origin;
  return typeof requested === "string" && CORS_ORIGINS.includes(requested)
    ? requested
    : null;
}
const UPSTREAM_MODE = process.env.UPSTREAM_MODE === "docker" ? "docker" : "local";
const ADMIN_RISK_URL =
  process.env.ADMIN_RISK_URL ??
  (UPSTREAM_MODE === "docker" ? "http://admin-risk:3013" : "http://127.0.0.1:3013");

if (!JWT_ACCESS_SECRET || JWT_ACCESS_SECRET.length < 32) {
  console.error("[gateway] JWT_ACCESS_SECRET must be at least 32 characters");
  process.exit(1);
}
const REQUIRED_SECRETS = {
  SERVICE_TOKEN,
  ADMIN_SERVICE_TOKEN,
  WALLET_SERVICE_TOKEN,
  REALTIME_SERVICE_TOKEN,
  PROMOTIONS_SERVICE_TOKEN,
  ADMIN_BOOTSTRAP_TOKEN,
};
for (const [name, value] of Object.entries(REQUIRED_SECRETS)) {
  if (!value || value.length < 32) {
    console.error(`[gateway] ${name} must be at least 32 characters`);
    process.exit(1);
  }
}

/** In Compose every peer is reachable by its service name on the shared
 * network; with `npm run start:all` everything listens on loopback. */
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
  // One-time first-admin claim. Validated by ADMIN_BOOTSTRAP_TOKEN instead of
  // RBAC because no role exists yet; admin-risk still refuses a second admin.
  { prefix: "/v1/admin-risk/bootstrap", service: "admin-risk", port: 3013, bootstrap: true },
  // Role grants are privileged and must be checked against `roles.manage`,
  // not silently dropped by the generic /v1/admin-risk route below.
  { prefix: "/v1/admin-risk/roles/grant", service: "admin-risk", port: 3013, privileged: true, permission: "roles.manage" },
  { prefix: "/v1/admin-risk", service: "admin-risk", port: 3013 },
  { prefix: "/v1/internal/audit", service: "admin-risk", port: 3013, privileged: true, permission: "audit.read" },
  { prefix: "/v1/internal/rbac", service: "admin-risk", port: 3013, privileged: true, permission: "audit.read" },
  { prefix: "/v1/events", service: "realtime", port: 3010, requirePlayer: true },
  { prefix: "/internal/events", service: "realtime", port: 3010, privileged: true },
  { prefix: "/v1/wallet", service: "wallet", port: 3011 },
  { prefix: "/internal/wallet", service: "wallet", port: 3011, privileged: true },
  { prefix: "/v1/responsible-gaming", service: "responsible-gaming", port: 3012 },
  // Creating a tournament with an arbitrary prize pool is an admin action.
  { prefix: "/v1/tournaments", service: "tournaments", port: 3014, methods: ["POST"], privileged: true, permission: "tournaments.manage" },
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

const DOWNSTREAM_PORTS = [...new Map(ROUTES.map((route) => [route.service, route.port]))];

/** Privileged routes that peer services call with a capability token, not
 * with a player JWT (chat publishing to realtime, for example). */
const SERVICE_TOKEN_ONLY = new Map([
  ["/internal/events", REALTIME_SERVICE_TOKEN],
  ["/internal/wallet", WALLET_SERVICE_TOKEN],
]);

function tokenMatches(value, expected) {
  if (typeof value !== "string" || value.length === 0 || !expected) return false;
  const provided = createHash("sha256").update(value).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(provided, expectedDigest);
}

/** The gateway owns token injection: a caller can never choose which internal
 * capability its request receives. The token is selected from the *matched
 * route*, never from the raw URL, so a crafted path cannot borrow a more
 * privileged capability than the route it actually resolves to. */
function injectedToken(target, peerToken) {
  if (peerToken) return peerToken;
  if (target.service === "admin-risk") return ADMIN_SERVICE_TOKEN;
  if (target.service === "promotions") return PROMOTIONS_SERVICE_TOKEN;
  return SERVICE_TOKEN;
}

/** Parse the request target once and refuse any path whose normalised form
 * differs from what the client sent. This blocks `/v1/internal/audit/../...`
 * and percent-encoded dot segments, which would otherwise be routed by one
 * set of rules and forwarded to a completely different upstream endpoint. */
function parseProxyUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, "http://gateway.invalid");
  } catch {
    return null;
  }
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  if (parsed.pathname !== rawPath) return null;
  if (/[\\\u0000-\u001f]/.test(parsed.pathname)) return null;
  // Encoded separators/dot segments have no legitimate use in these routes
  // and could desynchronise the proxy's router from the upstream router.
  if (/%2f|%5c|%2e/i.test(rawPath)) return null;
  return parsed;
}

/** Prefix matches must land on a segment boundary: `/v1/authx` is not `/v1/auth`. */
function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix + "/");
}

function requiredPermission(route, path) {
  if (route.permission) return route.permission;
  if (matchesPrefix(path, "/v1/internal/audit") || matchesPrefix(path, "/v1/internal/rbac"))
    return "audit.read";
  return "promotions.manage";
}

/** Fail closed: if admin-risk is down, no privileged call is allowed. */
async function hasPermission(userId, permission, log) {
  try {
    const res = await fetch(`${ADMIN_RISK_URL}/v1/internal/rbac/check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": ADMIN_SERVICE_TOKEN },
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

// The gateway is a transparent proxy. Parsing JSON into an object and then
// re-serialising it rejects legitimate empty POST bodies and can change number
// precision; keep the exact bytes and let the downstream service validate.
app.addContentTypeParser(["application/json", "application/*+json"], { parseAs: "string" }, (_req, body, done) => {
  done(null, body === "" ? undefined : body);
});

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health" || req.url === "/ready") return;
  reply.header("Vary", "Origin");
  const origin = corsOrigin(req);
  if (origin) {
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-credentials", "true");
  }
  if (req.method === "OPTIONS") {
    reply.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    // Identity and service-token headers are gateway-owned. Advertising them
    // as browser-settable invites callers to try to spoof them.
    reply.header("access-control-allow-headers", "authorization,content-type,x-request-id,x-bootstrap-token");
    return reply.code(204).send();
  }
});

app.get("/health", async () => ({ status: "ok", service: "gateway" }));

/** Aggregate readiness for orchestrators and `npm run smoke`: the gateway is
 * only ready once every downstream service reports its own DB-backed /ready. */
app.get("/ready", async (_req, reply) => {
  const checks = await Promise.all(
    DOWNSTREAM_PORTS.map(async ([service, port]) => {
      try {
        const res = await fetch(`http://${upstreamHost(service)}:${port}/ready`, {
          signal: AbortSignal.timeout(2000),
        });
        return { service, ok: res.ok, status: res.status };
      } catch (err) {
        return { service, ok: false, error: err.message };
      }
    }),
  );
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    return reply.code(503).send({ status: "not_ready", failed, services: checks.length });
  }
  return { status: "ready", services: checks.length };
});

async function proxy(req, reply) {
  // Normalise once, then route, authorise and forward using only that canonical
  // path. A URL that changes under normalisation is rejected outright so it
  // cannot pass one route's checks and reach a different upstream endpoint.
  const parsed = parseProxyUrl(req.url);
  if (!parsed) {
    return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid request path" });
  }
  const path = parsed.pathname;

  const target = ROUTES.find(
    (route) => matchesPrefix(path, route.prefix) && (!route.methods || route.methods.includes(req.method)),
  );
  if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "unknown route" });

  // Capture the caller's service token before removing it. Every downstream
  // identity header is gateway-owned; clients may not supply them.
  const callerServiceToken = req.headers["x-service-token"];
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  for (const name of [
    "x-user-id",
    "x-username",
    "x-actor",
    "x-user",
    "x-role",
    "x-roles",
    "x-permissions",
    "x-service-token",
  ]) {
    delete headers[name];
  }

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

  // Peer-to-peer routes are authenticated by their capability token alone;
  // requiring a player JWT here would make every documented service call 401.
  const peerToken = [...SERVICE_TOKEN_ONLY].find(([prefix]) => matchesPrefix(path, prefix))?.[1];
  if ((target.requirePlayer || target.bootstrap || (target.privileged && !peerToken)) && !decoded?.userId) {
    return reply.code(401).send({
      error: "UNAUTHORIZED",
      message: "a player token is required for this route",
    });
  }

  if (target.bootstrap) {
    if (!tokenMatches(req.headers["x-bootstrap-token"], ADMIN_BOOTSTRAP_TOKEN)) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid bootstrap token" });
    }
  } else if (target.privileged) {
    if (peerToken) {
      if (!tokenMatches(callerServiceToken, peerToken)) {
        return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid service token" });
      }
    } else {
      const permission = requiredPermission(target, path);
      if (!(await hasPermission(decoded.userId, permission, req.log))) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: `missing permission ${permission}`,
        });
      }
    }
  }

  if (target.privileged || target.bootstrap) {
    headers["x-service-token"] = injectedToken(target, peerToken);
  }

  const upstream = `http://${upstreamHost(target.service)}:${target.port}${parsed.pathname}${parsed.search}`;
  const init = { method: req.method, headers };
  if (req.body !== undefined) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } else {
    // An empty body with `content-type: application/json` is rejected by the
    // downstream JSON parser before a header-only route can run. A transparent
    // proxy must not invent a body type the caller did not actually send.
    delete headers["content-type"];
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
      const streamOrigin = corsOrigin(req);
      rawReply.writeHead(res.status, {
        "content-type": contentType,
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        vary: "Origin",
        ...(streamOrigin ? { "access-control-allow-origin": streamOrigin } : {}),
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
    req.log.warn({ err, service: target.service }, "upstream request failed");
    // Do not reflect upstream/internal error details back to callers.
    return reply.code(503).send({
      error: "SERVICE_UNAVAILABLE",
      message: `upstream ${target.service} unavailable`,
    });
  }
}

app.all("/v1/*", proxy);
app.all("/internal/*", proxy);

/** Static browser client. The Aviator app is a CRA SPA, so every unknown
 * non-API path resolves to index.html. The gateway remains the only service
 * exposed by Compose and serves the same origin as /v1, avoiding browser CORS
 * and credential coupling. */
const WEB_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  process.env.WEB_ROOT ?? "../../frontend/build",
);
const WEB_INDEX = join(WEB_ROOT, "index.html");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

async function webFile(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = resolve(WEB_ROOT, `.${pathname}`);
  if (candidate !== WEB_ROOT && !candidate.startsWith(WEB_ROOT + sep)) return null;
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    // Missing asset -> SPA fallback below.
  }
  try {
    await stat(WEB_INDEX);
    return WEB_INDEX;
  } catch {
    return null;
  }
}

app.get("/*", async (req, reply) => {
  const file = await webFile(req.url);
  if (!file) {
    return reply.code(404).send({
      error: "NOT_FOUND",
      message: "frontend build not found; run npm --prefix frontend run build",
    });
  }
  const body = await readFile(file);
  reply.header("cache-control", file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
  reply.type(MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
  return reply.send(body);
});

try {
  await app.listen({ port: PORT, host: process.env.HOST ?? "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "gateway failed to start");
  process.exit(1);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}
