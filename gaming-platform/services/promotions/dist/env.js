import { z } from "zod";
import { baseEnvSchema, capabilityFields } from "@gp/config";
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
 */
export const promotionsEnvSchema = baseEnvSchema.extend({
    ...capabilityFields("SERVICE_TOKEN", "PROMOTIONS_SERVICE_TOKEN", "WALLET_SERVICE_TOKEN"),
    PORT: z.coerce.number().int().positive().default(3022),
    DATABASE_URL: z.string().min(1).url(),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    REDIS_URL: z.string().min(1).url(),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // Fail closed: a missing RG client skips self-exclusion checks and a missing
    // wallet client silently creates unpaid claims. Both are required.
    RESPONSIBLE_GAMING_URL: z.string().url(),
    WALLET_URL: z.string().url(),
});
export const loadEnv = promotionsEnvSchema.parse;
