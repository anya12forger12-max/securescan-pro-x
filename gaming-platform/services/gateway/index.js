import Fastify from "fastify";
import jwt from "jsonwebtoken";
import pg from "pg";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRateLimiter } from "./rate-limit.js";
import { registerAviatorSocket } from "./aviator-ws.js";
import {
  assertDistinctSecrets,
  dbPoolOptions,
  jwtVerifyOptions,
  normalizePem,
  parseCorsOrigins,
} from "@gp/config";

const PORT = Number(process.env.PORT ?? 3000);
const JWT_PUBLIC_KEY = normalizePem(process.env.JWT_PUBLIC_KEY);
const JWT_VERIFY_OPTIONS = jwtVerifyOptions(process.env);
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const ADMIN_SERVICE_TOKEN = process.env.ADMIN_SERVICE_TOKEN;
const WALLET_SERVICE_TOKEN = process.env.WALLET_SERVICE_TOKEN;
const REALTIME_SERVICE_TOKEN = process.env.REALTIME_SERVICE_TOKEN;
const PROMOTIONS_SERVICE_TOKEN = process.env.PROMOTIONS_SERVICE_TOKEN;
const CRASH_SERVICE_TOKEN = process.env.CRASH_SERVICE_TOKEN;
const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN;
// Normalise once and use the same canonical list for CORS and CSP. Browsers
// send `Origin` without a trailing slash, so a raw allow-list entry such as
// `http://localhost:3000/` would silently fail CORS while still appearing in
// connect-src. Malformed entries are kept as-is and rejected by both checks.
const CORS_ORIGINS = parseCorsOrigins(process.env.CORS_ORIGIN);

/** Echo only a configured origin. A comma-separated allow-list in one header
 * is invalid, and credentials require an exact origin rather than `*`. */
function corsOrigin(req) {
  const requested = req.headers.origin;
  return typeof requested === "string" && CORS_ORIGINS.includes(requested)
    ? requested
    : null;
}

/**
 * CSP source lists are space-separated, so a comma-separated CORS_ORIGIN
 * allow-list must be expanded into individual exact origins. Never emit `*`
 * (or a wildcard host): a credentialed browser client still needs an exact
 * scheme/host/port match. Malformed entries are ignored instead of producing
 * an invalid header; normalise through URL so trailing slashes are harmless.
 */
function cspConnectSrc(origins) {
  const sources = ["'self'"];
  for (const value of origins) {
    if (/[\s,;*'"\\]/.test(value)) continue;
    let origin;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) continue;
      origin = url.origin;
    } catch {
      continue;
    }
    if (!sources.includes(origin)) sources.push(origin);
  }
  return sources.join(" ");
}
const CONNECT_SRC = cspConnectSrc(CORS_ORIGINS);

/** Baseline response hardening. The CRA client loads only same-origin
 * scripts/styles, so a self-only policy (with inline styles for React and data
 * URIs for images/fonts) does not break it. `connect-src` also includes every
 * configured browser origin so a separately built frontend using
 * REACT_APP_API_URL can reach the gateway. Auth responses additionally get a
 * no-store cache policy in the request hook; static build assets keep theirs. */
const BASE_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    `img-src 'self' data:; font-src 'self' data:; connect-src ${CONNECT_SRC}; ` +
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
});

const UPSTREAM_MODE = process.env.UPSTREAM_MODE === "docker" ? "docker" : "local";
const ADMIN_RISK_URL =
  process.env.ADMIN_RISK_URL ??
  (UPSTREAM_MODE === "docker" ? "http://admin-risk:3013" : "http://127.0.0.1:3013");

if (!JWT_PUBLIC_KEY.includes("BEGIN PUBLIC KEY")) {
  console.error("[gateway] JWT_PUBLIC_KEY must be a PEM-encoded RSA public key");
  process.exit(1);
}
assertDistinctSecrets(process.env);

if (!process.env.DATABASE_URL) {
  console.error("[gateway] DATABASE_URL is required to verify access-token records");
  process.exit(1);
}
const TOKEN_VERSION_CACHE_MS = (() => {
  const parsed = Number(process.env.TOKEN_VERSION_CACHE_MS ?? 15_000);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, 60_000) : 15_000;
})();
const tokenPool = new pg.Pool(dbPoolOptions(process.env.DATABASE_URL));
const tokenCache = new Map(); // jti -> { at, valid, userId, version }
const TOKEN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRED_SECRETS = {
  SERVICE_TOKEN,
  ADMIN_SERVICE_TOKEN,
  WALLET_SERVICE_TOKEN,
  REALTIME_SERVICE_TOKEN,
  PROMOTIONS_SERVICE_TOKEN,
  CRASH_SERVICE_TOKEN,
  ADMIN_BOOTSTRAP_TOKEN,
};
for (const [name, value] of Object.entries(REQUIRED_SECRETS)) {
  if (!value || value.length < 32) {
    console.error(`[gateway] ${name} must be at least 32 characters`);
    process.exit(1);
  }
}

/** Player-facing abuse controls. Service-to-service routes are excluded: they
 * already carry a scoped capability token and have their own budgets. Counts
 * live in Redis so several gateway replicas share one quota. */
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";
const rateLimitConfig = {
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  authMax: Number(process.env.RATE_LIMIT_AUTH_MAX) || 10,
  userMax: Number(process.env.RATE_LIMIT_USER_MAX) || 120,
  mutateMax: Number(process.env.RATE_LIMIT_MUTATE_MAX) || 30,
  streamMax: Number(process.env.RATE_LIMIT_STREAM_MAX) || 20,
  // Fail closed by default once a shared limiter is configured; an explicit
  // "false" keeps the deliberate local-only development mode working.
  failClosed:
    process.env.RATE_LIMIT_FAIL_CLOSED !== "false" && Boolean(process.env.REDIS_URL),
  redisUrl: process.env.REDIS_URL,
};
const rateLimiter = RATE_LIMIT_ENABLED ? createRateLimiter(rateLimitConfig) : null;

// Anonymous IP limits only mean something if req.ip is the browser, not the
// host's TLS terminator. The documented deployment uses exactly one loopback
// proxy hop; allow that hop to supply X-Forwarded-For and no more. Set to 0 for
// direct development access with no proxy in front of the gateway.
const TRUST_PROXY_HOPS = (() => {
  const parsed = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
})();
// Bound the establishment of every upstream request. SSE streams are excluded
// once their headers arrive; their socket lifetime is independent of this cap.
const UPSTREAM_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 30_000;
})();

/**
 * SSE connections are long-lived, so they carry a separate *concurrent* socket
 * cap in addition to the ordinary per-user read budget for establishing them.
 * The cap reuses RATE_LIMIT_STREAM_MAX but describes live sockets rather than
 * requests per minute and is a resource guard independent of RATE_LIMIT_ENABLED.
 * Buckets keep the same verified-user / anonymous-IP split as the normal
 * request limiters.
 *
 * Slots are Redis leases shared by every gateway replica, so N replicas cannot
 * admit N x streamMax sockets against the single realtime hub. When no shared
 * limiter is configured (local development) a process-local fallback is used.
 */
const STREAM_LEASE_MS = 120_000;
const STREAM_HEARTBEAT_MS = 30_000;
const activeStreams = new Map();
const streamBucket = (req, userId) =>
  userId ? `user:${userId}` : `ip:anon:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;

function acquireLocalStreamSlot(key) {
  const active = activeStreams.get(key) ?? 0;
  if (active >= rateLimitConfig.streamMax) return false;
  activeStreams.set(key, active + 1);
  return true;
}

function releaseLocalStreamSlot(key) {
  const active = activeStreams.get(key) ?? 0;
  if (active <= 1) activeStreams.delete(key);
  else activeStreams.set(key, active - 1);
}

/** Only genuinely unauthenticated auth endpoints are keyed by IP. `/v1/auth/me`
 * carries a player JWT and must not share a NAT's quota with login attempts. */
// Logout is deliberately not in the IP-limited auth bucket: it only revokes the
// caller's own token family, and sharing a NAT's login/refresh quota could block
// sign-out with 429, leaving a valid refresh cookie on a shared device. It still
// uses the per-user write bucket below.
const IP_LIMITED_AUTH_PATH = /^\/v1\/auth\/(register|login|refresh)\/?$/;

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
  crash: process.env.UPSTREAM_CRASH_HOST ?? "crash",
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
  // Reading the audit log and inspecting RBAC need audit.read. Appending to
  // the hash-chained log is a separate admin-only capability: support/risk
  // must not be able to write entries they are allowed to read.
  { prefix: "/v1/internal/audit", service: "admin-risk", port: 3013, methods: ["GET"], privileged: true, permission: "audit.read" },
  { prefix: "/v1/internal/audit", service: "admin-risk", port: 3013, methods: ["POST"], privileged: true, permission: "audit.append" },
  // Preserve the previous fallback for any other method on these prefixes.
  { prefix: "/v1/internal/audit", service: "admin-risk", port: 3013, privileged: true, permission: "audit.read" },
  // Peer-only: this forwards to admin-risk's generic RBAC lookup, which accepts
  // an arbitrary `userId` in the body. Exposing it to `audit.read` users lets
  // support/risk enumerate any player's roles; the gateway's own permission
  // checks call admin-risk directly and do not need this public route.
  { prefix: "/v1/internal/rbac", service: "admin-risk", port: 3013, privileged: true },
  { prefix: "/v1/events", service: "realtime", port: 3010, requirePlayer: true },
  { prefix: "/internal/events", service: "realtime", port: 3010, privileged: true },
  { prefix: "/v1/wallet", service: "wallet", port: 3011 },
  { prefix: "/internal/wallet", service: "wallet", port: 3011, privileged: true },
  { prefix: "/v1/responsible-gaming", service: "responsible-gaming", port: 3012 },
  // Creating a tournament with an arbitrary prize pool is an admin action.
  // This rule must match only the collection POST: a broad prefix match also
  // swallowed POST /v1/tournaments/:id/join and blocked ordinary players.
  { prefix: "/v1/tournaments", service: "tournaments", port: 3014, methods: ["POST"], exact: true, privileged: true, permission: "tournaments.manage" },
  { prefix: "/v1/tournaments", service: "tournaments", port: 3014 },
  { prefix: "/v1/chat", service: "chat", port: 3016 },
  { prefix: "/v1/codenames", service: "codenames", port: 3017 },
  { prefix: "/v1/game", service: "game-engine", port: 3018 },
  { prefix: "/v1/gin-rummy", service: "gin-rummy", port: 3019 },
  { prefix: "/v1/leaderboard", service: "leaderboard", port: 3020 },
  { prefix: "/v1/pictionary", service: "pictionary", port: 3021 },
  // Unified Aviator/crash game. The internal lifecycle API is declared before
  // the broad promotions `/internal` rule, which would otherwise swallow it.
  { prefix: "/v1/crash", service: "crash", port: 3023 },
  { prefix: "/internal/crash", service: "crash", port: 3023, privileged: true },
  // Spec-compatible player/operator aliases. The crash service owns these
  // resources; `rewrite` maps the public path onto its implementation route
  // without exposing a second copy of the ledger.
  { prefix: "/v1/rounds", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/rounds/, "/v1/crash/rounds") },
  { prefix: "/v1/bets", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/bets/, "/v1/crash/bets") },
  { prefix: "/v1/fairness/verify", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/fairness/, "/v1/crash/fairness") },
  { prefix: "/v1/stats/top", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/stats/, "/v1/crash/stats") },
  { prefix: "/v1/rules", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/rules/, "/v1/crash/rules") },
  { prefix: "/v1/settings", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/settings/, "/v1/crash/settings") },
  { prefix: "/v1/me", service: "crash", port: 3023, rewrite: () => "/v1/crash/me" },
  // Operator endpoints carry their own API key and signed body; the crash
  // service verifies both, so the gateway only needs to route them.
  { prefix: "/v1/operator", service: "crash", port: 3023, rewrite: (p) => p.replace(/^\/v1\/operator/, "/v1/crash/operator") },
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
  ["/internal/crash", CRASH_SERVICE_TOKEN],
  // admin-risk's RBAC lookup is a peer capability: it trusts the caller's
  // service token and accepts any target userId, so a player JWT must never
  // unlock it through the proxy.
  ["/v1/internal/rbac", ADMIN_SERVICE_TOKEN],
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
  if (target.service === "crash") return CRASH_SERVICE_TOKEN;
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

/** Most routes are prefix-scoped, but a few capabilities apply only to the
 * exact collection path. Without this, a privileged POST /v1/tournaments rule
 * also captured POST /v1/tournaments/:id/join. */
function matchesRoute(path, route) {
  if (!route.exact) return matchesPrefix(path, route.prefix);
  return path === route.prefix || path === route.prefix + "/";
}

function requiredPermission(route, path, method) {
  if (route.permission) return route.permission;
  if (method === "POST" && matchesPrefix(path, "/v1/internal/audit")) return "audit.append";
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

/**
 * Privileged catalogue mutations create wallet liabilities or alter live
 * tournaments. The services that own them do not hold an admin-risk capability,
 * so the gateway writes the hash-chained audit entry using the verified player
 * subject (admin-risk binds `actor` to x-user-id). A failure is logged but does
 * not roll back the already-committed mutation: dropping an audit write must not
 * leave the caller with an ambiguous result about the primary action.
 */
async function recordAdminAudit(req, actorId, action, target, metadata) {
  try {
    const res = await fetch(`${ADMIN_RISK_URL}/v1/internal/audit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-token": ADMIN_SERVICE_TOKEN,
        "x-user-id": actorId,
      },
      body: JSON.stringify({ actor: actorId, action, target, metadata }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      req.log.error({ status: res.status, action }, "admin audit append rejected");
      return false;
    }
    return true;
  } catch (err) {
    req.log.error({ err, action }, "admin audit append failed");
    return false;
  }
}

/**
 * Write-ahead audit descriptor for a privileged mutation. The entry is
 * appended before the upstream mutation is sent; the upstream call is made only
 * after the append succeeds. A create still has no response-side id yet, so its
 * target carries the immutable request id and the descriptor's metadata carries
 * the operator-provided resource identity (for example a promotion code).
 */
function auditedMutation(req, method, path, body) {
  const requestId = String(req.headers["x-request-id"] ?? "");
  // The transparent proxy keeps JSON bodies as raw strings. Decode a copy for
  // audit metadata only; the original bytes are still forwarded unchanged.
  let auditedBody = body;
  if (typeof body === "string") {
    try {
      auditedBody = JSON.parse(body);
    } catch {
      auditedBody = {};
    }
  }
  // `matchesRoute()` deliberately accepts one trailing slash for collection
  // routes. Audit detection must canonicalize the same way or a privileged
  // mutation can commit without a hash-chained audit entry.
  const rawPath = String(path ?? "");
  const auditPath = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const resourceId = (value) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : `request:${requestId}`;

  if (method === "POST" && auditPath === "/internal/promotions") {
    const bodyValue = auditedBody ?? {};
    const source = bodyValue.data?.promotion ?? bodyValue;
    return {
      action: "promotion.create",
      target: `promotion:${resourceId(source.code)}`,
      metadata: { phase: "intent", method, path: auditPath, requestId, code: source.code ?? null },
    };
  }
  if (method === "PATCH" && matchesPrefix(auditPath, "/internal/promotions/")) {
    return { action: "promotion.update", target: auditPath.slice("/internal/promotions/".length) };
  }
  if (method === "POST" && auditPath === "/v1/tournaments") {
    const source = auditedBody?.tournament ?? auditedBody;
    return {
      action: "tournament.create",
      target: `tournament:${resourceId(source.title)}`,
      metadata: { phase: "intent", method, path: auditPath, requestId, title: source.title ?? null },
    };
  }
  return null;
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  trustProxy: TRUST_PROXY_HOPS,
});
app.addHook("onClose", async () => {
  await tokenPool.end();
});

/**
 * A valid RS256 signature is necessary but not sufficient: auth records every
 * issued jti and bumps `auth_users.token_version` on logout/replay. Checking
 * both at the edge makes a revoked token unusable without waiting for exp.
 * Positive results are cached briefly; a negative result is cached only for
 * the same bounded window so newly minted jtis cannot be stuck out of date.
 */
function pruneTokenCache(now) {
  if (tokenCache.size < 5000) return;
  for (const [key, value] of tokenCache) {
    if (now - value.at >= TOKEN_VERSION_CACHE_MS) tokenCache.delete(key);
  }
}

async function accessTokenActive(decoded, log) {
  const { userId, jti } = decoded ?? {};
  const version = Number(decoded?.ver);
  if (
    typeof userId !== "string" || !TOKEN_UUID.test(userId) ||
    typeof jti !== "string" || !TOKEN_UUID.test(jti) ||
    !Number.isInteger(version) || version < 1
  )
    return false;

  const now = Date.now();
  if (TOKEN_VERSION_CACHE_MS > 0) {
    const cached = tokenCache.get(jti);
    if (cached && now - cached.at < TOKEN_VERSION_CACHE_MS) {
      return cached.valid &&
        cached.userId === userId &&
        cached.version === version;
    }
  }

  try {
    const result = await tokenPool.query(
      `SELECT t.user_id::text AS "userId", t.token_version
       FROM auth_access_tokens t
       JOIN auth_users u ON u.id = t.user_id
       WHERE t.jti = $1 AND t.user_id = $2 AND t.token_version = $3
         AND t.revoked_at IS NULL AND t.expires_at > now()
         AND u.token_version = t.token_version`,
      [jti, userId, version],
    );
    const row = result.rows[0];
    const valid = Boolean(row && row.userId === userId && Number(row.token_version) === version);
    if (TOKEN_VERSION_CACHE_MS > 0) {
      pruneTokenCache(now);
      tokenCache.set(jti, {
        at: now,
        valid,
        userId: valid ? userId : null,
        version: valid ? version : null,
      });
    }
    return valid;
  } catch (err) {
    // Fail closed: an unverifiable token must not be treated as anonymous and
    // forwarded with a stale identity header.
    log?.warn({ err, jti }, "access-token record lookup failed");
    return null;
  }
}

async function resolveBearer(req) {
  const raw = req.headers.authorization;
  if (typeof raw !== "string" || !raw.startsWith("Bearer ")) return { status: "none" };
  let decoded;
  try {
    decoded = jwt.verify(raw.slice(7), JWT_PUBLIC_KEY, JWT_VERIFY_OPTIONS);
  } catch {
    return { status: "invalid" };
  }
  const active = await accessTokenActive(decoded, req.log);
  if (active === null) return { status: "unavailable" };
  if (!active) return { status: "invalid" };
  return { status: "valid", claims: decoded };
}

// The gateway is a transparent proxy. Parsing JSON into an object and then
// re-serialising it rejects legitimate empty POST bodies and can change number
// precision; keep the exact bytes and let the downstream service validate.
app.addContentTypeParser(["application/json", "application/*+json"], { parseAs: "string" }, (_req, body, done) => {
  done(null, body === "" ? undefined : body);
});

app.addHook("onRequest", async (req, reply) => {
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    reply.header(name, value);
  }
  // Auth responses carry tokens and account data: never let a proxy or the
  // browser cache them. Static build assets keep their own cache policy.
  if (matchesPrefix(req.url.split(/[?#]/, 1)[0], "/v1/auth")) {
    reply.header("cache-control", "no-store");
  }
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

/**
 * Aggregate readiness for orchestrators and `npm run smoke`: the gateway is
 * only ready once every downstream service reports its own DB-backed /ready.
 *
 * This endpoint is intentionally excluded from the player rate limiter (probes
 * must not fail closed with Redis), so without a short cache each call fans out
 * to every peer. Cache the aggregate briefly and coalesce concurrent calls so
 * a burst of probes can trigger at most one fan-out per window.
 */
const READY_CACHE_MS = (() => {
  const value = Number(process.env.READY_CACHE_MS ?? 2000);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 10_000) : 2000;
})();
let readyCache = null; // { at, status, body }
let readyInFlight = null;

async function collectReadiness() {
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
  return failed.length
    ? { status: 503, body: { status: "not_ready", failed, services: checks.length } }
    : { status: 200, body: { status: "ready", services: checks.length } };
}

app.get("/ready", async (_req, reply) => {
  reply.header("cache-control", "no-store");
  const now = Date.now();
  if (readyCache && now - readyCache.at < READY_CACHE_MS)
    return reply.code(readyCache.status).send(readyCache.body);
  if (!readyInFlight) {
    readyInFlight = collectReadiness()
      .then((result) => {
        readyCache = { at: Date.now(), ...result };
        return result;
      })
      .finally(() => {
        readyInFlight = null;
      });
  }
  const result = await readyInFlight;
  return reply.code(result.status).send(result.body);
});

/** Rate-limit player traffic before it reaches any downstream service.
 * Keys are derived from a verified JWT subject or, for unauthenticated auth
 * routes, the socket address. A client-supplied x-service-token is never a
 * valid reason to skip the check. */
app.addHook("onRequest", async (req, reply) => {
  if (!rateLimiter) return;
  const path = req.url.split(/[?#]/, 1)[0];
  if (!path.startsWith("/v1/") && !path.startsWith("/internal/")) return;
  if (req.method === "OPTIONS") return;
  // Capability-authenticated peer routes are not player traffic.
  if (path.startsWith("/internal/")) return;
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

  // Registration/login/refresh are anonymous by definition; do not require a
  // token record lookup for them. Every other path with a Bearer credential is
  // checked here so rate-limit buckets and proxy identity use the same truth.
  let authResult = { status: "none" };
  if (!IP_LIMITED_AUTH_PATH.test(path)) {
    authResult = await resolveBearer(req);
    if (authResult.status === "unavailable") {
      return reply.code(503).send({
        error: "SERVICE_UNAVAILABLE",
        message: "access-token verification unavailable",
      });
    }
  }

  const applyLimit = (result) => {
    reply.header("x-ratelimit-limit", String(result.limit));
    reply.header("x-ratelimit-remaining", String(result.remaining));
    reply.header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
    if (result.allowed) return undefined;
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    reply.header("retry-after", String(retryAfter));
    return reply.code(429).send({
      error: result.unavailable ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
      message: result.unavailable ? "rate limiter unavailable" : "too many requests",
      retryAfter,
    });
  };

  // An invalid token is still counted by IP; the proxy will reject it before
  // forwarding if the route requires a player identity.
  const verifiedUserId = () =>
    authResult.status === "valid" ? authResult.claims.userId : null;

  // Anonymous stream attempts are limited by IP; a verified player's stream
  // establishment is a normal read request and falls through to the per-user
  // read bucket below. The separate live-socket lease cap in proxy() still
  // bounds how many long-lived streams one user may hold open. Skipping the
  // request bucket entirely let a single JWT hammer stream establishment
  // without ever seeing a 429, even after the socket had been closed.
  if (matchesPrefix(path, "/v1/events/stream")) {
    const streamUser = verifiedUserId();
    if (!streamUser || req.method !== "GET") {
      return applyLimit(await rateLimiter.check(`ip:anon:${ip}:stream`, rateLimitConfig.streamMax));
    }
  }

  let limit;
  let key;
  if (IP_LIMITED_AUTH_PATH.test(path)) {
    limit = rateLimitConfig.authMax;
    // Auth and generic anonymous traffic must not share a bucket: on a NAT,
    // ordinary public reads would otherwise exhaust everyone's login quota.
    key = `ip:auth:${ip}`;
  } else {
    const userId = verifiedUserId();
    const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
    limit = mutating ? rateLimitConfig.mutateMax : rateLimitConfig.userMax;
    key = userId ? `user:${userId}:${mutating ? "write" : "read"}` : `ip:anon:${ip}`;
  }

  return applyLimit(await rateLimiter.check(key, limit));
});

/** The SPA needs to know which privileged controls to render. This reports
 * only the caller's own permissions, resolved through the same RBAC service
 * that guards the routes, so hiding a button never loosens the server check.
 * Registered after the rate-limit hook: Fastify snapshots hooks at route
 * registration, so an earlier route would silently bypass every player limit. */
const KNOWN_PERMISSIONS = [
  "promotions.manage",
  "tournaments.manage",
  "audit.read",
  "audit.append",
  "risk.review",
  "roles.manage",
];
app.get("/v1/me/permissions", async (req, reply) => {
  const authResult = await resolveBearer(req);
  if (authResult.status === "unavailable") {
    return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "token verification unavailable" });
  }
  if (authResult.status !== "valid") {
    return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid token" });
  }
  const decoded = authResult.claims;
  const granted = await Promise.all(
    KNOWN_PERMISSIONS.map(async (permission) =>
      (await hasPermission(decoded.userId, permission, req.log)) ? permission : null),
  );
  return reply.send({ permissions: granted.filter(Boolean) });
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
    (route) => matchesRoute(path, route) && (!route.methods || route.methods.includes(req.method)),
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

  // Assert identity only from a verified, unrevoked player token. Services
  // still receive the original Authorization header and verify it independently.
  // Login/register/refresh are anonymous capabilities: a stale Authorization
  // header must not be able to block a credential exchange.
  const authResult = IP_LIMITED_AUTH_PATH.test(path)
    ? { status: "none" }
    : await resolveBearer(req);
  if (authResult.status === "unavailable") {
    return reply.code(503).send({
      error: "SERVICE_UNAVAILABLE",
      message: "access-token verification unavailable",
    });
  }
  const decoded = authResult.status === "valid" ? authResult.claims : null;
  if (decoded) {
    headers["x-user-id"] = decoded.userId;
    if (typeof decoded.username === "string") headers["x-username"] = decoded.username;
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
      const permission = requiredPermission(target, path, req.method);
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

  // Live-socket cap for SSE, keyed exactly like the request buckets: verified
  // player subject or source IP. Slots are taken only after authorisation and
  // released on the response's "close", including upstream failures and any
  // early client disconnect while waiting for the stream headers.
  let releaseStream = () => {};
  if (matchesPrefix(path, "/v1/events/stream")) {
    const key = streamBucket(req, decoded?.userId);
    const member = randomUUID();
    const acquired = rateLimiter
      ? await rateLimiter.acquireLease(key, member, rateLimitConfig.streamMax, STREAM_LEASE_MS)
      : acquireLocalStreamSlot(key);
    if (!acquired) {
      return reply.code(429).send({
        error: "TOO_MANY_STREAMS",
        message: "concurrent event stream limit reached",
      });
    }
    // Long-lived streams refresh their lease so a healthy socket never looks
    // expired to another replica. The timer is unref'd and always cleared on
    // release, so it cannot keep the process alive or leak after disconnect.
    const heartbeat = rateLimiter
      ? setInterval(() => void rateLimiter.touchLease(key, member, STREAM_LEASE_MS), STREAM_HEARTBEAT_MS)
      : null;
    heartbeat?.unref?.();
    let released = false;
    releaseStream = () => {
      if (released) return;
      released = true;
      if (heartbeat) clearInterval(heartbeat);
      if (rateLimiter) void rateLimiter.releaseLease(key, member);
      else releaseLocalStreamSlot(key);
    };
    // ServerResponse "close" fires after ordinary responses finish and when a
    // hijacked SSE socket goes away, so one hook covers every exit path.
    reply.raw.once("close", releaseStream);
  }

  const upstreamPath = target.rewrite ? target.rewrite(parsed.pathname) : parsed.pathname;
  const upstream = `http://${upstreamHost(target.service)}:${target.port}${upstreamPath}${parsed.search}`;
  const init = { method: req.method, headers };
  if (req.body !== undefined) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } else {
    // An empty body with `content-type: application/json` is rejected by the
    // downstream JSON parser before a header-only route can run. A transparent
    // proxy must not invent a body type the caller did not actually send.
    delete headers["content-type"];
  }

  const mutation = auditedMutation(req, req.method, path, req.body);
  if (mutation) {
    const audited = await recordAdminAudit(req, decoded.userId, mutation.action, mutation.target, mutation.metadata);
    if (!audited) {
      return reply.code(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "admin audit append failed" } });
    }
  }

  let upstreamTimer;
  try {
    const controller = new AbortController();
    upstreamTimer = setTimeout(
      () => controller.abort(new Error("upstream request timed out")),
      UPSTREAM_TIMEOUT_MS,
    );
    const res = await fetch(upstream, { ...init, signal: controller.signal });
    const contentType = res.headers.get("content-type") ?? "";
    const requestId = res.headers.get("x-request-id");
    // Money-affecting Aviator routes mark a cached replay so clients and
    // support can distinguish it from a fresh wager without trusting the body.
    const idempotentReplay = res.headers.get("x-idempotent-replay");
    // Auth's cookie refresh flow relies on the exact HttpOnly Set-Cookie value
    // surviving the proxy. Keep every value as a separate header: joining them
    // with commas would corrupt Expires attributes.
    const setCookies =
      res.headers.getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);

    // SSE responses never end, so buffering with res.text() would hang. Pipe
    // the upstream body straight to the client and let the socket close decide
    // when the stream is over.
    if (contentType.includes("text/event-stream") && res.body) {
      // The stream is long-lived; stop the establishment timer once headers
      // have arrived instead of killing an active SSE socket.
      clearTimeout(upstreamTimer);
      upstreamTimer = undefined;
      // hijack() bypasses Fastify's header serializer, so copy the headers the
      // hooks already set (rate-limit counters, CORS credentials, request id).
      const pendingHeaders = reply.getHeaders();
      reply.hijack();
      const rawReply = reply.raw;
      const streamOrigin = corsOrigin(req);
      rawReply.writeHead(res.status, {
        ...BASE_SECURITY_HEADERS,
        ...pendingHeaders,
        "content-type": contentType,
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        vary: "Origin",
        ...(streamOrigin ? { "access-control-allow-origin": streamOrigin } : {}),
        ...(requestId ? { "x-request-id": requestId } : {}),
        ...(setCookies.length ? { "set-cookie": setCookies } : {}),
      });
      const reader = res.body.getReader();
      // Register the close signal before pumping. `events.once` only reacts to
      // a *future* event: a client that disconnected while the upstream fetch
      // was in flight had already emitted "close", so racing once("drain")
      // against once("close") parked forever after a destroyed write returned
      // false, leaking the upstream stream and its MAX_STREAMS slot.
      let clientClosed = false;
      const closed = new Promise((resolve) => rawReply.once("close", resolve));
      rawReply.on("close", () => {
        clientClosed = true;
        void reader.cancel().catch(() => undefined);
      });
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || clientClosed || rawReply.destroyed || rawReply.writableEnded) break;
            // Honour socket backpressure. Without this the gateway drains the
            // realtime hub as fast as it can and buffers Slowloris-style clients
            // in gateway memory instead of throttling the bounded upstream queue.
            if (!rawReply.write(value)) {
              // Swallow loser rejections to avoid an unhandled rejection after
              // one side wins the race.
              const drained = once(rawReply, "drain").catch(() => undefined);
              await Promise.race([drained, closed]);
            }
            if (clientClosed || rawReply.destroyed || rawReply.writableEnded) break;
          }
        } catch (err) {
          req.log.warn({ err }, "event stream closed");
        } finally {
          // Always release the upstream reader, including when the client went
          // away before the "close" listener above could be installed.
          void reader.cancel().catch(() => undefined);
          rawReply.end();
          releaseStream();
        }
      };
      void pump();
      return;
    }

    const text = await res.text();
    clearTimeout(upstreamTimer);
    upstreamTimer = undefined;
    reply.code(res.status);
    if (contentType) reply.header("content-type", contentType);
    if (requestId) reply.header("x-request-id", requestId);
    if (idempotentReplay === "1") reply.header("x-idempotent-replay", "1");
    if (setCookies.length) reply.header("set-cookie", setCookies);
    return reply.send(text);
  } catch (err) {
    if (upstreamTimer) clearTimeout(upstreamTimer);
    releaseStream();
    req.log.warn({ err, service: target.service }, "upstream request failed");
    // Do not reflect upstream/internal error details back to callers.
    return reply.code(503).send({
      error: "SERVICE_UNAVAILABLE",
      message: `upstream ${target.service} unavailable`,
    });
  }
}

// Aviator protocol v1 socket. Registered before the catch-all proxy because a
// WebSocket handshake cannot be forwarded through the plain fetch proxy.
registerAviatorSocket(app, {
  verifyToken: resolveBearer,
  allowedOrigin: (origin) => Boolean(corsOrigin({ headers: { origin } })),
  upstream: (service, port) => `http://${upstreamHost(service)}:${port}`,
  realtimeToken: REALTIME_SERVICE_TOKEN,
  maxPerUser: 4,
  log: app.log,
});

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
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    // A malformed escape is a bad request, not an internal server error.
    return null;
  }
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
      try {
        await rateLimiter?.close();
      } finally {
        process.exit(0);
      }
    }
  });
}
