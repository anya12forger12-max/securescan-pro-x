import { z } from "zod";
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
export declare const promotionsEnvSchema: z.ZodObject<{
    SERVICE_TOKEN: z.ZodString;
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
} & {
    PORT: z.ZodDefault<z.ZodNumber>;
    DATABASE_URL: z.ZodString;
    JWT_ACCESS_SECRET: z.ZodString;
    REDIS_URL: z.ZodString;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<["fatal", "error", "warn", "info", "debug", "trace", "silent"]>>;
    RESPONSIBLE_GAMING_URL: z.ZodOptional<z.ZodString>;
    WALLET_URL: z.ZodOptional<z.ZodString>;
}, z.UnknownKeysParam, z.ZodTypeAny, {
    SERVICE_TOKEN: string;
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    REDIS_URL: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
    RESPONSIBLE_GAMING_URL?: string | undefined;
    WALLET_URL?: string | undefined;
}, {
    SERVICE_TOKEN: string;
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    REDIS_URL: string;
    NODE_ENV?: "development" | "test" | "production" | undefined;
    PORT?: number | undefined;
    CORS_ORIGIN?: string | undefined;
    LOG_LEVEL?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent" | undefined;
    RESPONSIBLE_GAMING_URL?: string | undefined;
    WALLET_URL?: string | undefined;
}>;
export type PromotionsEnv = z.infer<typeof promotionsEnvSchema>;
export declare const loadEnv: (data: unknown, params?: z.util.InexactPartial<z.ParseParams>) => {
    SERVICE_TOKEN: string;
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    REDIS_URL: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
    RESPONSIBLE_GAMING_URL?: string | undefined;
    WALLET_URL?: string | undefined;
};
//# sourceMappingURL=env.d.ts.map