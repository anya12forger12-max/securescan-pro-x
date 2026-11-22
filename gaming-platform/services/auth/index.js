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
import { baseEnvSchema, loadEnv, registerErrorHandler } from "@gp/config";
import { ERROR_CODES } from "@gp/shared-types";

/**
 * Auth service (3015).
 *
 * Mints the platform-wide HS256 access token contract
 * ({ userId, username } with a 900s default lifetime) and owns credential
 * storage plus rotating refresh tokens. Every other service verifies the same
 * JWT with the shared JWT_ACCESS_SECRET.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3015),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  JWT_EXPIRES_IN: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });
await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
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
const validationError = (reply, parsed) =>
  deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

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
const mintAccessToken = (user) =>
  jsonwebtoken.sign(
    { userId: String(user.id), username: user.username },
    env.JWT_ACCESS_SECRET,
    { algorithm: "HS256", expiresIn: env.JWT_EXPIRES_IN },
  );

const hashRefreshToken = (token) => createHash("sha256").update(token).digest("hex");

async function issueRefreshToken(executor, userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await executor.query(
    `INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashRefreshToken(token), expiresAt],
  );
  return token;
}

const PUBLIC_USER_COLUMNS = "id, username, email, created_at";
const publicUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  created_at: row.created_at,
});

function authData(user, refreshToken) {
  return {
    token: mintAccessToken(user),
    refresh_token: refreshToken,
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
const RefreshSchema = z.object({ refresh_token: z.string().min(1) });

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
      `SELECT id, username, email, created_at, password_hash
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
    const refreshToken = await issueRefreshToken(pool, row.id);
    return ok(reply, 200, authData(row, refreshToken), reqId(req));
  } catch (err) {
    req.log.error({ err }, "login failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "login failed");
  }
});

app.post("/v1/auth/refresh", async (req, reply) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) return validationError(reply, parsed);

  const tokenHash = hashRefreshToken(parsed.data.refresh_token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, user_id FROM auth_refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [tokenHash],
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid or expired refresh token");
    }

    const { id: oldId, user_id: userId } = found.rows[0];
    await client.query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = $1`, [oldId]);
    const refreshToken = await issueRefreshToken(client, userId);
    const userResult = await client.query(
      `SELECT ${PUBLIC_USER_COLUMNS} FROM auth_users WHERE id = $1`,
      [userId],
    );
    if (!userResult.rowCount) {
      await client.query("ROLLBACK");
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid or expired refresh token");
    }
    await client.query("COMMIT");
    return ok(reply, 200, authData(userResult.rows[0], refreshToken), reqId(req));
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
  if (parsed.success) {
    try {
      await pool.query(
        `UPDATE auth_refresh_tokens SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashRefreshToken(parsed.data.refresh_token)],
      );
    } catch (err) {
      // Logout is idempotent: never leak whether the token existed.
      req.log.error({ err }, "logout revoke failed");
    }
  }
  return ok(reply, 200, { ok: true }, reqId(req));
});

app.get("/v1/auth/me", async (req, reply) => {
  const raw = headerString(req.headers, "authorization");
  if (!raw?.startsWith("Bearer "))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid token");

  let decoded;
  try {
    decoded = await app.jwt.verify(raw.slice(7), { algorithms: ["HS256"] });
  } catch {
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid token");
  }
  const userId = decoded?.userId;
  if (typeof userId !== "string" || !UUID.test(userId))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid token");

  try {
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
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "auth failed to start");
  await pool.end().catch(() => undefined);
  process.exit(1);
}
