import { registerErrorHandler } from "@gp/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { createHash, randomUUID } from "node:crypto";
import { ERROR_CODES, moneyMul, toMoney, serviceTokenOk } from "@gp/shared-types";
/** A wallet failure is only safe to roll back when the request was definitely
 * rejected. Network timeouts and 5xx responses may hide a committed credit. */
export class WalletCreditError extends Error {
    ambiguous;
    constructor(message, ambiguous) {
        super(message);
        this.ambiguous = ambiguous;
        this.name = "WalletCreditError";
    }
}
function headerString(headers, name) {
    const value = headers[name];
    return typeof value === "string" && value.length > 0 ? value : null;
}
function success(data, requestId) {
    return { request_id: requestId, success: true, data };
}
function deny(reply, status, code, message, details) {
    const requestId = String(reply.getHeader("x-request-id") ?? "");
    return reply.code(status).send({ request_id: requestId, error: { code, message, ...(details ? { details } : {}) } });
}
const PROMOTION_TYPES = ["deposit_bonus", "free_bet", "cashback"];
/** Validate an admin-supplied promotion definition. Returns an error message or null. */
function validateNewPromotion(body) {
    if (!body || typeof body !== "object")
        return { error: "body must be an object" };
    const b = body;
    const str = (k) => typeof b[k] === "string" && b[k].length > 0 ? b[k] : null;
    const code = str("code");
    const title = str("title");
    const type = str("type");
    const bonusAmount = str("bonusAmount");
    const startsAt = str("startsAt");
    const expiresAt = str("expiresAt");
    if (!code || !title || !type || !bonusAmount || !startsAt || !expiresAt) {
        return { error: "code, title, type, bonusAmount, startsAt and expiresAt are required" };
    }
    if (!PROMOTION_TYPES.includes(type))
        return { error: "invalid promotion type" };
    if (!Number.isFinite(Number(bonusAmount)) || Number(bonusAmount) <= 0)
        return { error: "bonusAmount must be positive" };
    const maxClaims = Number(b.maxClaims);
    const wageringRequirement = Number(b.wageringRequirement ?? 0);
    if (!Number.isInteger(maxClaims) || maxClaims <= 0)
        return { error: "maxClaims must be a positive integer" };
    if (!Number.isFinite(wageringRequirement) || wageringRequirement < 0) {
        return { error: "wageringRequirement must be non-negative" };
    }
    const startsAtMs = Date.parse(startsAt);
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(expiresAtMs))
        return { error: "startsAt and expiresAt must be valid dates" };
    if (expiresAtMs <= startsAtMs)
        return { error: "expiresAt must be after startsAt" };
    return {
        value: {
            code,
            title,
            type: type,
            description: str("description") ?? "",
            bonusAmount: toMoney(bonusAmount),
            wageringRequirement,
            maxClaims,
            startsAt,
            expiresAt,
            active: b.active === undefined ? true : Boolean(b.active),
        },
    };
}
export async function buildPromotionsService(deps) {
    const { env, repo } = deps;
    const app = Fastify({ logger: { level: env.LOG_LEVEL }, genReqId: () => randomUUID() });
    registerErrorHandler(app);
    await app.register(cors, { origin: env.CORS_ORIGIN.split(","), credentials: true });
    await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
    app.addHook("onRequest", async (req, reply) => {
        const requestId = req.headers["x-request-id"] ?? randomUUID();
        req.headers["x-request-id"] = requestId;
        reply.header("x-request-id", requestId);
    });
    const reqId = (req) => String(req.headers["x-request-id"] ?? "");
    // Only a signed player JWT establishes identity. The gateway strips and
    // re-derives x-user-id from the verified token; accepting a service token
    // plus a caller-controlled header would allow cross-user impersonation.
    const requestUserId = async (req) => {
        const raw = headerString(req.headers, "authorization");
        if (raw?.startsWith("Bearer ")) {
            try {
                const decoded = await app.jwt.verify(raw.slice(7));
                return typeof decoded.userId === "string" && decoded.userId ? decoded.userId : null;
            }
            catch {
                return null;
            }
        }
        return null;
    };
    const requireUser = async (req, reply) => {
        const userId = await requestUserId(req);
        if (!userId) {
            void deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "missing or invalid user context");
            return null;
        }
        return userId;
    };
    // Compare the token in constant time against the configured value. A bare
    // "header is present" check would let any caller with an arbitrary token
    // create promotions -- i.e. mint wallet liabilities -- through /internal/*.
    const requireService = (req, reply) => {
        if (!serviceTokenOk(req.headers, env.PROMOTIONS_SERVICE_TOKEN)) {
            void deny(reply, 401, ERROR_CODES.UNAUTHORIZED, "invalid service token");
            return false;
        }
        return true;
    };
    app.get("/health", async () => ({ status: "ok", service: "promotions" }));
    // Readiness must touch the database: claims are durable, so serving them
    // from an instance that cannot reach Postgres would lose money. Production
    // injects `deps.ready` (the claim pool); the in-memory test repository
    // falls back to a repository query.
    app.get("/ready", async (_req, reply) => {
        try {
            if (deps.ready)
                await deps.ready();
            else
                await repo.listAll();
            return reply.code(200).send({ status: "ready" });
        }
        catch {
            return reply.code(503).send({ status: "not_ready", reason: "database unavailable" });
        }
    });
    // List active promotions
    app.get("/v1/promotions", async (req, reply) => {
        const userId = await requestUserId(req);
        const now = new Date().toISOString();
        const promos = await repo.listActive(now);
        // annotate with claim status if user present
        const claims = userId ? await repo.listClaimsByUser(userId) : [];
        const claimedIds = new Set(claims.map((c) => c.promotionId));
        const items = promos.map((p) => ({
            ...p,
            claimed: claimedIds.has(p.id),
        }));
        return reply.code(200).send(success({ items }, reqId(req)));
    });
    // Claim a promotion
    app.post("/v1/promotions/:code/claim", async (req, reply) => {
        const userId = await requireUser(req, reply);
        if (!userId)
            return reply;
        const { code } = req.params;
        const promo = await repo.findByCode(code);
        if (!promo) {
            return deny(reply, 404, ERROR_CODES.NOT_FOUND, "promotion not found");
        }
        // Reconcile before checking availability or the claim cap: a claim retained
        // after an ambiguous wallet response must stay retryable even if the
        // promotion has since ended, and it already occupies a cap slot.
        const existing = await repo.findClaimByUserAndPromo(userId, promo.id);
        if (existing) {
            if (deps.wallet) {
                try {
                    await deps.wallet.credit({
                        userId,
                        amount: existing.bonusAmount,
                        type: "bonus",
                        referenceType: "admin",
                        referenceId: existing.id,
                        idempotencyKey: existing.idempotencyKey,
                    });
                }
                catch (err) {
                    req.log.warn({ err }, "promotion claim reconciliation failed");
                    return deny(reply, 503, ERROR_CODES.SERVICE_UNAVAILABLE, "wallet credit status is unknown; claim retained for idempotent retry", { claimId: existing.id, idempotencyKey: existing.idempotencyKey });
                }
            }
            return reply.code(200).send(success({ claim: existing, replay: true }, reqId(req)));
        }
        if (!promo.active) {
            return deny(reply, 404, ERROR_CODES.NOT_FOUND, "promotion not found or inactive");
        }
        const now = new Date().toISOString();
        if (promo.startsAt > now || promo.expiresAt < now) {
            return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "promotion not currently available");
        }
        if (promo.claimsCount >= promo.maxClaims) {
            return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "promotion fully claimed");
        }
        // eligibility: check self-exclusion via responsible-gaming
        if (deps.rg) {
            const check = await deps.rg.check(userId, "deposit", promo.bonusAmount);
            if (!check.allowed) {
                return deny(reply, 403, ERROR_CODES.VALIDATION_ERROR, check.reason ?? "not eligible");
            }
        }
        // A stable wallet key is derived from the user + promotion, never from the
        // claim UUID. If the wallet commits but its HTTP response is lost, the
        // retried claim uses the same key and the wallet replays instead of paying
        // a second time.
        const walletKey = `promo-claim-${createHash("sha256").update(`${userId}:${promo.id}`).digest("hex")}`;
        // decimal.js, not a JS float: a float here would round a bonus differently
        // from the DB NUMERIC and the ledger would drift on every claim.
        const claim = await repo.createClaim({
            promotionId: promo.id,
            userId,
            idempotencyKey: walletKey,
            claimedAt: now,
            bonusAmount: toMoney(promo.bonusAmount),
            wageringProgress: "0",
            wageringTarget: moneyMul(promo.bonusAmount, promo.wageringRequirement),
            status: "active",
        });
        // The unique (user, promotion) constraint settles concurrent double taps.
        // A null here means another request won; never credit a wallet for it.
        if (!claim) {
            return deny(reply, 409, ERROR_CODES.IDEMPOTENCY_CONFLICT, "already claimed");
        }
        if (deps.wallet) {
            const creditInput = {
                userId,
                amount: claim.bonusAmount,
                type: "bonus",
                referenceType: "admin",
                referenceId: claim.id,
                idempotencyKey: claim.idempotencyKey,
            };
            try {
                await deps.wallet.credit(creditInput);
            }
            catch (err) {
                const ambiguous = err instanceof WalletCreditError ? err.ambiguous : true;
                if (!ambiguous) {
                    await repo.deleteClaim(claim.id);
                    return deny(reply, 503, ERROR_CODES.SERVICE_UNAVAILABLE, "wallet credit failed; claim was rolled back");
                }
                // The wallet may have committed before the response was lost. Keep the
                // claim and replay the same idempotency key: a committed credit is
                // returned as a replay, otherwise it is applied exactly once here.
                try {
                    await deps.wallet.credit(creditInput);
                }
                catch (reconcileError) {
                    req.log.warn({ err, reconcileError }, "wallet credit needs reconciliation");
                    return deny(reply, 503, ERROR_CODES.SERVICE_UNAVAILABLE, "wallet credit status is unknown; claim retained for idempotent retry", { claimId: claim.id, idempotencyKey: claim.idempotencyKey });
                }
            }
        }
        if (deps.publish) {
            // SSE is a lobby-wide broadcast, so publish only public fields. User ids
            // and bonus amounts must never be put on that channel in the first place.
            await deps.publish("config.updated", { promotionId: promo.id });
        }
        return reply.code(201).send(success({ claim }, reqId(req)));
    });
    // List my claims
    app.get("/v1/promotions/claims", async (req, reply) => {
        const userId = await requireUser(req, reply);
        if (!userId)
            return reply;
        const claims = await repo.listClaimsByUser(userId);
        return reply.code(200).send(success({ items: claims }, reqId(req)));
    });
    // ---------------------------------------------------------------------------
    // Internal admin catalogue management. Guarded by the service token: the
    // gateway's admin routes are the only intended caller, and admin-risk owns
    // the RBAC + hash-chained audit entry for each of these actions.
    // ---------------------------------------------------------------------------
    app.get("/internal/promotions", async (req, reply) => {
        if (!requireService(req, reply))
            return reply;
        return reply.code(200).send(success({ items: await repo.listAll() }, reqId(req)));
    });
    app.post("/internal/promotions", async (req, reply) => {
        if (!requireService(req, reply))
            return reply;
        const parsed = validateNewPromotion(req.body);
        if ("error" in parsed) {
            return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, parsed.error, { validation: parsed.error });
        }
        const existing = await repo.findByCode(parsed.value.code);
        if (existing) {
            return deny(reply, 409, ERROR_CODES.IDEMPOTENCY_CONFLICT, "promotion code already exists");
        }
        const promotion = await repo.createPromotion(parsed.value);
        return reply.code(201).send(success({ promotion }, reqId(req)));
    });
    app.patch("/internal/promotions/:id", async (req, reply) => {
        if (!requireService(req, reply))
            return reply;
        const { id } = req.params;
        const body = (req.body ?? {});
        const patch = {};
        if (typeof body.title === "string")
            patch.title = body.title;
        if (typeof body.description === "string")
            patch.description = body.description;
        if (typeof body.active === "boolean")
            patch.active = body.active;
        if (body.maxClaims !== undefined) {
            const n = Number(body.maxClaims);
            if (!Number.isInteger(n) || n <= 0) {
                return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "maxClaims must be a positive integer");
            }
            patch.maxClaims = n;
        }
        if (typeof body.expiresAt === "string") {
            if (!Number.isFinite(Date.parse(body.expiresAt))) {
                return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "expiresAt must be a valid date");
            }
            patch.expiresAt = body.expiresAt;
        }
        if (Object.keys(patch).length === 0) {
            return deny(reply, 400, ERROR_CODES.VALIDATION_ERROR, "no updatable fields supplied");
        }
        const promotion = await repo.updatePromotion(id, patch);
        if (!promotion)
            return deny(reply, 404, ERROR_CODES.NOT_FOUND, "promotion not found");
        return reply.code(200).send(success({ promotion }, reqId(req)));
    });
    // Internal: service token check endpoint (for gateway)
    app.post("/v1/internal/check", async (req, reply) => {
        if (!requireService(req, reply))
            return reply;
        return reply.code(200).send(success({ ok: true }, reqId(req)));
    });
    return app;
}
