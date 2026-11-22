import pg from "pg";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { createHash, randomUUID } from "node:crypto";
import { baseEnvSchema, capabilityFields, dbPoolOptions, loadEnv, registerErrorHandler } from "@gp/config";
import { ERROR_CODES, serviceTokenOk } from "@gp/shared-types";

/**
 * Admin / risk service (3013).
 *
 * Owns admin RBAC and the hash-chained audit log. The gateway calls the
 * /v1/internal/* routes with its service token before it performs any
 * privileged action, so a permission check and its audit entry always travel
 * together. The chain can be verified independently via /audit/verify.
 */
const envSchema = baseEnvSchema.extend({
  ...capabilityFields("ADMIN_SERVICE_TOKEN", "ADMIN_BOOTSTRAP_TOKEN"),
  PORT: z.coerce.number().int().positive().default(3013),
  DATABASE_URL: z.string().min(1).url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
const env = loadEnv(envSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));

/** Static RBAC model. `admin` also acts as a wildcard in hasPermission(). */
const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze([
    "promotions.manage",
    "tournaments.manage",
    "audit.read",
    "risk.review",
    "roles.manage",
  ]),
  risk: Object.freeze(["audit.read", "risk.review"]),
  support: Object.freeze(["audit.read"]),
  player: Object.freeze([]),
});

const GENESIS_HASH = "0".repeat(64);
const AUDIT_LOCK_KEY = 3013001;
const AUDIT_COLUMNS = `seq, prev_hash, hash, actor, action, target, metadata, created_at`;

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

const hasPermission = (roles, permission) =>
  roles.some((role) => role === "admin" || Boolean(ROLE_PERMISSIONS[role]?.includes(permission)));

async function rolesForUser(userId) {
  const result = await pool.query(
    `SELECT DISTINCT role FROM admin_user_roles WHERE user_id = $1 ORDER BY role`,
    [userId],
  );
  return result.rows.map((row) => row.role);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Deterministic JSON: jsonb key order is not stable, so sort keys recursively. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

const canonicalFields = (entry) =>
  stableStringify({
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    metadata: entry.metadata ?? {},
  });

const computeHash = (prevHash, entry) =>
  createHash("sha256").update(String(prevHash) + canonicalFields(entry)).digest("hex");

/**
 * Append one audit entry. Must be called inside a transaction. The row lock
 * protects the current tail; the advisory lock also serialises the first
 * insert into an empty table, where FOR UPDATE has no row to lock.
 */
async function appendAudit(client, entry) {
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [AUDIT_LOCK_KEY]);
  const tail = await client.query(
    `SELECT hash FROM admin_audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE`,
  );
  const prevHash = tail.rows[0]?.hash ?? GENESIS_HASH;
  const metadata = entry.metadata ?? {};
  const hash = computeHash(prevHash, { ...entry, metadata });
  const inserted = await client.query(
    `INSERT INTO admin_audit_log (prev_hash, hash, actor, action, target, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING ${AUDIT_COLUMNS}`,
    [prevHash, hash, entry.actor, entry.action, entry.target, JSON.stringify(metadata)],
  );
  return inserted.rows[0];
}

const CheckSchema = z.object({
  userId: z.string().min(1),
  permission: z.string().min(1),
});

const AuditSchema = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const GrantSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "risk", "support", "player"]),
});

app.post("/v1/internal/rbac/check", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = CheckSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  try {
    const roles = await rolesForUser(parsed.data.userId);
    return ok(
      reply,
      200,
      { allowed: hasPermission(roles, parsed.data.permission), roles },
      reqId(req),
    );
  } catch (err) {
    req.log.error({ err }, "rbac check failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "rbac check failed");
  }
});

app.post("/v1/internal/audit", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = AuditSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  try {
    const entry = await withTransaction((client) => appendAudit(client, parsed.data));
    return ok(reply, 201, { entry }, reqId(req));
  } catch (err) {
    req.log.error({ err }, "audit append failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "audit append failed");
  }
});

app.get("/v1/internal/audit/verify", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  try {
    const result = await pool.query(
      `SELECT seq, prev_hash, hash, actor, action, target, metadata
       FROM admin_audit_log ORDER BY seq ASC`,
    );
    let expectedPrev = GENESIS_HASH;
    let firstInvalidSeq = null;
    for (const row of result.rows) {
      if (
        row.prev_hash !== expectedPrev ||
        computeHash(row.prev_hash, row) !== row.hash ||
        !/^[0-9a-f]{64}$/.test(row.hash)
      ) {
        if (firstInvalidSeq === null) firstInvalidSeq = Number(row.seq);
      }
      expectedPrev = row.hash;
    }
    return ok(
      reply,
      200,
      {
        valid: firstInvalidSeq === null,
        count: result.rows.length,
        firstInvalidSeq,
      },
      reqId(req),
    );
  } catch (err) {
    req.log.error({ err }, "audit verification failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "audit verification failed");
  }
});

app.get("/v1/internal/audit", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const actor = headerString(req.query, "actor");
  try {
    const result = await pool.query(
      `SELECT ${AUDIT_COLUMNS} FROM admin_audit_log
       WHERE ($1::text IS NULL OR actor = $1)
       ORDER BY seq DESC LIMIT $2`,
      [actor, limit],
    );
    return ok(reply, 200, { items: result.rows }, reqId(req));
  } catch (err) {
    req.log.error({ err }, "audit listing failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "audit listing failed");
  }
});

app.get("/v1/admin-risk/roles", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN)) {
    const raw = headerString(req.headers, "authorization");
    if (!raw?.startsWith("Bearer "))
      return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid credentials");

    let userId = null;
    try {
      const decoded = await app.jwt.verify(raw.slice(7));
      if (typeof decoded?.userId === "string" && decoded.userId) userId = decoded.userId;
    } catch {
      // Invalid tokens are rejected below rather than leaking a verification detail.
    }
    if (!userId) return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid credentials");

    try {
      const roles = await rolesForUser(userId);
      if (!hasPermission(roles, "audit.read"))
        return deny(reply, 403, ERROR_CODES.FORBIDDEN, "audit.read permission required");
    } catch (err) {
      req.log.error({ err }, "roles authorization failed");
      return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "roles authorization failed");
    }
  }
  return ok(reply, 200, ROLE_PERMISSIONS, reqId(req));
});

/**
 * First-admin bootstrap. The gateway already checked ADMIN_BOOTSTRAP_TOKEN and
 * a player JWT; we repeat the token check here so a direct call to this port
 * (if it were ever exposed) cannot skip it. It only works while no admin
 * exists and only for the authenticated caller.
 */
app.post("/v1/admin-risk/bootstrap", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
  if (!serviceTokenOk({ "x-service-token": req.headers["x-bootstrap-token"] }, env.ADMIN_BOOTSTRAP_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid bootstrap token");

  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));
  const actor = headerString(req.headers, "x-user-id");
  if (!actor || actor !== parsed.data.userId) {
    return deny(reply, 403, ERROR_CODES.FORBIDDEN, "bootstrap may only grant admin to the authenticated caller");
  }

  try {
    const result = await withTransaction(async (client) => {
      // Serialise concurrent bootstrap attempts so exactly one caller wins.
      // The claim is strictly one-time, even for the admin who already won it;
      // further grants go through roles/grant with `roles.manage`.
      await client.query("SELECT pg_advisory_xact_lock(3013002)");
      const admins = await client.query("SELECT 1 FROM admin_user_roles WHERE role = 'admin' LIMIT 1");
      if (admins.rowCount) return { conflict: true };
      const assignment = await client.query(
        `INSERT INTO admin_user_roles (user_id, role, granted_by, granted_at)
         VALUES ($1, 'admin', $2, now())
         ON CONFLICT (user_id, role) DO UPDATE
           SET granted_by = EXCLUDED.granted_by, granted_at = now()
         RETURNING user_id, role, granted_by, granted_at`,
        [actor, `bootstrap:${actor}`],
      );
      const entry = await appendAudit(client, {
        actor: `bootstrap:${actor}`,
        action: "rbac.bootstrap",
        target: `${actor}:admin`,
        metadata: { userId: actor, role: "admin", bootstrap: true },
      });
      return { assignment: assignment.rows[0], entry };
    });
    if (result.conflict) {
      return deny(reply, 409, ERROR_CODES.CONFLICT, "an administrator has already been bootstrapped");
    }
    return ok(reply, 201, result, reqId(req));
  } catch (err) {
    req.log.error({ err }, "admin bootstrap failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "admin bootstrap failed");
  }
});

app.post("/v1/admin-risk/roles/grant", async (req, reply) => {
  if (!serviceTokenOk(req.headers, env.ADMIN_SERVICE_TOKEN))
    return deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");

  const parsed = GrantSchema.safeParse(req.body);
  if (!parsed.success)
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, JSON.stringify(parsed.error.flatten()));

  // The gateway derives this header from a verified player JWT and strips any
  // caller-supplied identity headers. Never fall back to a client-controlled
  // alias: the audit trail must record the actual authenticated grantor.
  const grantedBy = headerString(req.headers, "x-user-id");
  if (!grantedBy) {
    return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "grant requests must identify the granting user");
  }

  try {
    const result = await withTransaction(async (client) => {
      const assignment = await client.query(
        `INSERT INTO admin_user_roles (user_id, role, granted_by, granted_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, role) DO UPDATE
           SET granted_by = EXCLUDED.granted_by, granted_at = now()
         RETURNING user_id, role, granted_by, granted_at`,
        [parsed.data.userId, parsed.data.role, grantedBy],
      );
      const entry = await appendAudit(client, {
        actor: grantedBy,
        action: "rbac.role.grant",
        target: `${parsed.data.userId}:${parsed.data.role}`,
        metadata: { userId: parsed.data.userId, role: parsed.data.role, grantedBy },
      });
      return { assignment: assignment.rows[0], entry };
    });
    return ok(reply, 201, result, reqId(req));
  } catch (err) {
    req.log.error({ err }, "role grant failed");
    return deny(reply, 500, ERROR_CODES.INTERNAL_ERROR, "role grant failed");
  }
});

app.get("/health", async () => ({ status: "ok", service: "admin-risk" }));
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
  app.log.error({ err }, "admin-risk failed to start");
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
