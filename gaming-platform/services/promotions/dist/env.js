import { z } from "zod";
import { baseEnvSchema, capabilityFields, jwtVerifyEnvFields } from "@gp/config";
/**
 * Promotions env.
 *
 * DATABASE_URL is required: claims and the catalogue are durable records in
 * Postgres, not an in-memory map. Failing at startup when the DB is missing is
 * deliberate -- starting a promotional service that silently loses claims (and
 * then credits wallets for them) is far worse than refusing to boot.
 *
 * Port 3022 is used because 3014 belongs to tournaments and 3016 to chat; the
 * openapi.yaml server URL and the compose healthcheck must match this value.
 *
 * This service receives only the bonus-scoped wallet credential. The full
 * wallet token is an optional local-run fallback and never reaches a deployed
 * promotions container, so a compromised process cannot mint other credit
 * types. Events are published to realtime over its capability-authenticated
 * internal endpoint; the old Redis EventBus had no subscriber.
 */
export const promotionsEnvSchema = baseEnvSchema
    .extend({
    ...capabilityFields("SERVICE_TOKEN", "PROMOTIONS_SERVICE_TOKEN", "REALTIME_SERVICE_TOKEN"),
    WALLET_SERVICE_TOKEN: z.string().min(32).optional(),
    WALLET_BONUS_SERVICE_TOKEN: z.string().min(32).optional(),
    PORT: z.coerce.number().int().positive().default(3022),
    DATABASE_URL: z.string().min(1).url(),
    ...jwtVerifyEnvFields,
    // Retained only so older deployment manifests keep parsing; no code path
    // uses Redis any more.
    REDIS_URL: z.string().min(1).url().optional(),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    REALTIME_URL: z.string().url().default("http://realtime:3010"),
    // Fail closed: a missing RG client skips self-exclusion checks and a missing
    // wallet client silently creates unpaid claims. Both are required.
    RESPONSIBLE_GAMING_URL: z.string().url(),
    WALLET_URL: z.string().url(),
})
    .refine((values) => Boolean(values.WALLET_BONUS_SERVICE_TOKEN ?? values.WALLET_SERVICE_TOKEN), {
    message: "WALLET_BONUS_SERVICE_TOKEN is required (WALLET_SERVICE_TOKEN is a local-only fallback)",
    path: ["WALLET_BONUS_SERVICE_TOKEN"],
});
export const loadEnv = promotionsEnvSchema.parse;
