import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import jsonwebtoken from "jsonwebtoken";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  baseEnvSchema,
  dbPoolOptions,
  jwtSignEnvFields,
  jwtVerifyOptions,
  jwtVerifyPluginOptions,
  loadEnv,
  normalizePem,
  parseCorsOrigins,
  registerErrorHandler,
} from "@gp/config";
import { ERROR_CODES } from "@gp/shared-types";

/**
 * Auth service (3015).
 *
 * The only process holding JWT_PRIVATE_KEY. It mints RS256 access tokens
 * ({ userId, username, ver, jti, iss, aud } with a 900s default lifetime) and
 * owns credential storage plus rotating refresh tokens. Every other service
 * verifies with the matching public key and pinned issuer/audience.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3015),
  DATABASE_URL: z.string().min(1).url(),
  ...jwtSignEnvFields,
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  JWT_EXPIRES_IN: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));

// The browser talks to the gateway over the configured origin. Origins are
// normalised once so `http://localhost:3000/` behaves exactly like the bare
// form for both CORS and the cookie's Secure decision.
const CORS_ORIGINS = parseCorsOrigins(env.CORS_ORIGIN);
const REFRESH_COOKIE = "gp_refresh_token";
const REFRESH_COOKIE_PATH = "/v1/auth";
const REFRESH_COOKIE_MAX_AGE = env.REFRESH_TTL_DAYS * 24 * 60 * 60;
const isSecureOrigin = (value) => /^https:\/\//i.test(value);
/** Decide Secure from the origin actually making the request. Deriving it from
 * the whole allow-list with `.some()` would set Secure on a local http client
 * whenever any unrelated https origin was configured, making refresh impossible. */
const refreshCookieSecure = (req) => {
  const origin = headerString(req.headers, "origin");
  if (origin && CORS_ORIGINS.includes(origin)) return isSecureOrigin(origin);
  // The trusted reverse proxy owns protocol metadata; a caller must not be able
  // to force a Secure cookie by sending X-Forwarded-Proto themselves. Without an
  // Origin, fall back to the globally configured allow-list.
  return CORS_ORIGINS.length > 0 && CORS_ORIGINS.every(isSecureOrigin);
};

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: CORS_ORIGINS });
await app.register(jwt, jwtVerifyPluginOptions(env));
registerErrorHandler(app);

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
const validationError = (reply, parsed) => {
  const flat = parsed.error.flatten();
  const details = [
    ...flat.formErrors,
    ...Object.entries(flat.fieldErrors).flatMap(([field, errors]) =>
      errors.map((message) => `${field}: ${message}`)),
  ];
  return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, details.join("; ") || "invalid request");
};

// ---------------------------------------------------------------------------
// Credentials: scrypt with a fresh 16-byte salt, encoded as
// scrypt$<saltHex>$<hashHex>. Verification is always constant-time.
// ---------------------------------------------------------------------------
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const HEX = /^[0-9a-f]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12)
    throw new Error("password must be at least 12 characters");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  if (!HEX.test(saltHex) || saltHex.length % 2 !== 0) return false;
  if (!HEX.test(hashHex) || hashHex.length % 2 !== 0) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Equalise the response path for a missing user and a wrong password.
const DUMMY_PASSWORD_HASH = await hashPassword("timing-equalizer-password");

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
const mintAccessToken = (user) => {
  const jti = randomUUID();
  const ver = Number(user.token_version ?? 1);
  const token = jsonwebtoken.sign(
    { userId: String(user.id), username: user.username, ver },
    normalizePem(env.JWT_PRIVATE_KEY),
    {
      algorithm: "RS256",
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      jwtid: jti,
    },
  );
  return {
    token,
    jti,
    ver,
    expiresAt: new Date(Date.now() + env.JWT_EXPIRES_IN * 1000),
  };
};

/** Persist the jti before returning the token. The gateway refuses any signed
 * token without a matching, unrevoked record at the current generation. */
async function issueAccessToken(user, executor = pool) {
  const issued = mintAccessToken(user);
  await executor.query(
    `INSERT INTO auth_access_tokens (jti, user_id, token_version, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [issued.jti, user.id, issued.ver, issued.expiresAt],
  );
  return issued;
}

const hashRefreshToken = (token) => createHash("sha256").update(token).digest("hex");

// Refresh tokens travel in an HttpOnly cookie for browser clients. The cookie
// is scoped to /v1/auth so it is never attached to ordinary game API calls.
const serializeRefreshCookie = (token, maxAge, secure) =>
  [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAge}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");

// The browser cannot read the HttpOnly refresh cookie, so without a hint it
// would POST /v1/auth/refresh on every anonymous page load and get a 400 (plus
// a console error). This companion cookie carries no credential - only the
// fact that a session cookie exists - and is cleared with it on logout and on
// refresh failure.
const SESSION_HINT_COOKIE = "gp_session";
const serializeSessionHint = (maxAge, secure) =>
  [
    `${SESSION_HINT_COOKIE}=${maxAge > 0 ? "1" : ""}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
const sessionCookies = (token, maxAge, req) => {
  const secure = refreshCookieSecure(req);
  return [
    serializeRefreshCookie(token, maxAge, secure),
    serializeSessionHint(maxAge, secure),
  ];
};
const setRefreshCookie = (reply, token, req) =>
  reply.header("set-cookie", sessionCookies(token, REFRESH_COOKIE_MAX_AGE, req));
const clearRefreshCookie = (reply, req) =>
  reply.header("set-cookie", sessionCookies("", 0, req));
const clearSessionHint = (reply, req) =>
  reply.header("set-cookie", serializeSessionHint(0, refreshCookieSecure(req)));

/** Cookie first: a browser must never fall back to an attacker-supplied body
 * token while it has a refresh cookie. Body tokens remain available only to
 * non-browser clients that have no refresh cookie at all.
 *
 * Return `null` only when there is no refresh cookie. An empty refresh cookie
 * returns `""` so callers cannot silently fall through to a body token. */
function requestRefreshToken(req) {
  const header = headerString(req.headers, "cookie");
  if (header) {
    for (const part of header.split(";")) {
      const separator = part.indexOf("=");
      if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE) continue;
      const raw = part.slice(separator + 1).trim();
      if (!raw) return "";
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
    // A cookie header exists but carries no refresh cookie: fall through to
    // the body so legacy non-browser clients keep working.
  }
  return null;
}

/** Every login starts a family; rotation keeps the family id. Sign-out revokes
 * the whole family so a concurrently rotated token cannot survive logout. */
async function issueRefreshToken(executor, userId, familyId = randomUUID()) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await executor.query(
    `INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at, family_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashRefreshToken(token), expiresAt, familyId],
  );
  return token;
}

// token_version is not returned by publicUser(), but mintAccessToken needs it
// so every issued token is bound to the current revocation generation.
const PUBLIC_USER_COLUMNS = "id, username, email, created_at, token_version";
const publicUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  created_at: row.created_at,
});

async function authData(user, executor = pool) {
  // Never include the refresh token here: it lives only in the HttpOnly cookie
  // and must be unreachable from JavaScript (and from XSS).
  const access = await issueAccessToken(user, executor);
  return {
    token: access.token,
    token_type: "Bearer",
    expires_in: env.JWT_EXPIRES_IN,
    user: publicUser(user),
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const RegisterSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_]+$/, "username may only contain letters, numbers and underscores"),
  email: z.string().email(),
  password: z.string().min(12).max(200),
});
const LoginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});
// A body token is accepted only from clients that cannot use cookies. Browser
// clients send no body at all and rely on the HttpOnly refresh cookie.
const RefreshSchema = z.object({ refresh_token: z.string().min(1).optional() });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.post("/v1/auth/register", async (req, reply) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return validationError(reply, parsed);

  const { username, email, password } = parsed.data;
  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, err.message);
  }

  try {
    const result = await pool.query(
      `INSERT INTO auth_users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_USER_COLUMNS}`,
      [username, email, passwordHash],
    );
    return ok(reply, 201, { user: publicUser(result.rows[0]) }, reqId(req));
  } catch (err) {
    if (err.code === "23505")
      return deny(reply, 409, ERROR_CODES.CONFLICT, "username or email already registered");
    req.log.error({ err }, "registration failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "registration failed");
  }
});

app.post("/v1/auth/login", async (req, reply) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return validationError(reply, parsed);

  const { identifier, password } = parsed.data;
  try {
    const result = await pool.query(
      `SELECT id, username, email, created_at, password_hash, token_version
       FROM auth_users WHERE username = $1 OR email = $1 LIMIT 1`,
      [identifier],
    );
    const row = result.rows[0];
    const valid = row
      ? await verifyPassword(password, row.password_hash)
      : await verifyPassword(password, DUMMY_PASSWORD_HASH);
    if (!row || !valid)
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid credentials");

    await pool.query(`UPDATE auth_users SET last_login_at = now() WHERE id = $1`, [row.id]);
    // Mint the access record first so a failed insert cannot leave a live
    // refresh cookie with no usable access token.
    const data = await authData(row);
    const refreshToken = await issueRefreshToken(pool, row.id);
    setRefreshCookie(reply, refreshToken, req);
    return ok(reply, 200, data, reqId(req));
  } catch (err) {
    req.log.error({ err }, "login failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "login failed");
  }
});

app.post("/v1/auth/refresh", async (req, reply) => {
  const parsed = RefreshSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(reply, parsed);

  const cookieToken = requestRefreshToken(req);
  const refreshTokenInput = cookieToken ?? parsed.data.refresh_token;
  if (!refreshTokenInput) {
    clearSessionHint(reply, req);
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "refresh token required");
  }

  const tokenHash = hashRefreshToken(refreshTokenInput);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Include revoked rows so replaying a rotated token is detectable. The
    // row lock is still taken on the matching token so two concurrent replays
    // cannot both race past the family revocation below.
    const found = await client.query(
      `SELECT id, user_id, family_id, revoked_at FROM auth_refresh_tokens
       WHERE token_hash = $1 AND expires_at > now()
       FOR UPDATE`,
      [tokenHash],
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      clearSessionHint(reply, req);
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid or expired refresh token");
    }

    const { id: oldId, user_id: userId, family_id: familyId, revoked_at: revokedAt } = found.rows[0];
    if (revokedAt) {
      // A revoked token was reused: assume theft and revoke every still-live
      // token in the family, including the one an attacker may have obtained
      // from a previous rotation.
      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = now()
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId],
      );
      // A replayed refresh token is treated as theft: revoke every access
      // token already minted for this user, not just refresh siblings.
      await client.query(
        `UPDATE auth_users SET token_version = token_version + 1 WHERE id = $1`,
        [userId],
      );
      await client.query(
        `UPDATE auth_access_tokens SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await client.query("COMMIT");
      clearSessionHint(reply, req);
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid or expired refresh token");
    }
    await client.query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = $1`, [oldId]);
    const refreshToken = await issueRefreshToken(client, userId, familyId);
    const userResult = await client.query(
      `SELECT ${PUBLIC_USER_COLUMNS} FROM auth_users WHERE id = $1`,
      [userId],
    );
    if (!userResult.rowCount) {
      await client.query("ROLLBACK");
      clearSessionHint(reply, req);
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid or expired refresh token");
    }
    const data = await authData(userResult.rows[0], client);
    await client.query("COMMIT");
    if (cookieToken) {
      // Cookie clients never receive the rotated token in JSON: only the new
      // HttpOnly cookie carries it, so XSS cannot read or exfiltrate it.
      setRefreshCookie(reply, refreshToken, req);
      return ok(reply, 200, data, reqId(req));
    }
    // Body-token clients have no cookie and still need the rotated token to
    // continue; they are non-browser callers by definition.
    return ok(reply, 200, { ...data, refresh_token: refreshToken }, reqId(req));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err }, "refresh failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "refresh failed");
  } finally {
    client.release();
  }
});

app.post("/v1/auth/logout", async (req, reply) => {
  const parsed = RefreshSchema.safeParse(req.body ?? {});
  const parsedToken = parsed.success ? parsed.data.refresh_token : undefined;
  const token = requestRefreshToken(req) ?? parsedToken;
  if (token) {
    const client = await pool.connect();
    try {
      // Lock the presented row and revoke in one transaction. Refresh rotates
      // under the same row lock: without it, rotation can commit a new sibling
      // after logout read the family but before its UPDATE snapshot starts,
      // leaving a live token that restores the session after sign-out.
      await client.query("BEGIN");
      // Include revoked rows: an already-rotated token still points at the
      // family whose new sibling this logout must kill.
      const found = await client.query(
        `SELECT family_id, user_id FROM auth_refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hashRefreshToken(token)],
      );
      if (found.rowCount && found.rows[0].family_id) {
        await client.query(
          `UPDATE auth_refresh_tokens SET revoked_at = now()
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [found.rows[0].family_id],
        );
      } else {
        await client.query(
          `UPDATE auth_refresh_tokens SET revoked_at = now()
           WHERE token_hash = $1 AND revoked_at IS NULL`,
          [hashRefreshToken(token)],
        );
      }
      if (found.rowCount) {
        // Refresh revocation alone leaves already-issued access tokens valid
        // until exp. Bump the generation in the same transaction so the edge
        // rejects them immediately (bounded by its short version cache TTL).
        await client.query(
          `UPDATE auth_users SET token_version = token_version + 1 WHERE id = $1`,
          [found.rows[0].user_id],
        );
        await client.query(
          `UPDATE auth_access_tokens SET revoked_at = now()
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [found.rows[0].user_id],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Logout is idempotent: never leak whether the token existed.
      req.log.error({ err }, "logout revoke failed");
    } finally {
      client.release();
    }
  }
  // Always expire the browser credential, even if the body/cookie was absent
  // or database revocation failed; a stale cookie must not outlive logout.
  clearRefreshCookie(reply, req);
  return ok(reply, 200, { ok: true }, reqId(req));
});

app.get("/v1/auth/me", async (req, reply) => {
  const raw = headerString(req.headers, "authorization");
  if (!raw?.startsWith("Bearer "))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid token");

  let decoded;
  try {
    decoded = await app.jwt.verify(raw.slice(7), jwtVerifyOptions(env));
  } catch {
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid token");
  }
  const userId = decoded?.userId;
  const jti = decoded?.jti;
  const ver = Number(decoded?.ver);
  if (
    typeof userId !== "string" || !UUID.test(userId) ||
    typeof jti !== "string" || !UUID.test(jti) ||
    !Number.isInteger(ver) || ver < 1
  )
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid token");

  try {
    // Signature validity alone is not enough after logout or refresh replay.
    const active = await pool.query(
      `SELECT 1 FROM auth_access_tokens t
       JOIN auth_users u ON u.id = t.user_id
       WHERE t.jti = $1 AND t.user_id = $2 AND t.token_version = $3
         AND t.revoked_at IS NULL AND t.expires_at > now()
         AND u.token_version = t.token_version`,
      [jti, userId, ver],
    );
    if (!active.rowCount)
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "token has been revoked");

    const result = await pool.query(
      `SELECT ${PUBLIC_USER_COLUMNS} FROM auth_users WHERE id = $1`,
      [userId],
    );
    if (!result.rowCount) return deny(reply, 404, ERROR_CODES.NOT_FOUND, "user not found");
    return ok(reply, 200, { user: publicUser(result.rows[0]) }, reqId(req));
  } catch (err) {
    req.log.error({ err }, "user lookup failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "could not load user");
  }
});

app.get("/health", async () => ({ status: "ok", service: "auth" }));
app.get("/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch (err) {
    return reply.code(503).send({ status: "error", message: err.message });
  }
});

try {
  await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "auth failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}

// Drain in-flight requests and let the onClose hook end the pool before the
// container is killed; without this SIGTERM drops active transactions.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}
