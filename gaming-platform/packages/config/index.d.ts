import type { z } from "zod";
import type { FastifyInstance } from "fastify";

/** Capability credentials, declared only by the services that hold them. */
export declare const capabilityTokenFields: {
  SERVICE_TOKEN: z.ZodString;
  ADMIN_SERVICE_TOKEN: z.ZodString;
  WALLET_SERVICE_TOKEN: z.ZodString;
  REALTIME_SERVICE_TOKEN: z.ZodString;
  PROMOTIONS_SERVICE_TOKEN: z.ZodString;
  CRASH_SERVICE_TOKEN: z.ZodString;
  ADMIN_BOOTSTRAP_TOKEN: z.ZodString;
};

/** Pick a subset of capability fields for use with `.extend()`. */
export declare function capabilityFields<K extends keyof typeof capabilityTokenFields>(
  ...names: K[]
): { [P in K]: z.ZodString };

/** RS256 access-token configuration. Only auth receives the private key. */
export declare const JWT_ALGORITHM: "RS256";
export declare const JWT_ISSUER: "gaming-platform";
export declare const JWT_AUDIENCE: "gaming-platform-api";

export declare function normalizePem(value: unknown): string;

export declare const jwtVerifyEnvFields: {
  JWT_PUBLIC_KEY: z.ZodString;
  JWT_ISSUER: z.ZodDefault<z.ZodString>;
  JWT_AUDIENCE: z.ZodDefault<z.ZodString>;
};

export declare const jwtSignEnvFields: {
  JWT_PUBLIC_KEY: z.ZodString;
  JWT_ISSUER: z.ZodDefault<z.ZodString>;
  JWT_AUDIENCE: z.ZodDefault<z.ZodString>;
  JWT_PRIVATE_KEY: z.ZodString;
};

export declare function jwtVerifyOptions(env: {
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
}): {
  algorithms: ["RS256"];
  issuer: string;
  audience: string;
};

export declare function jwtVerifyPluginOptions(env: {
  JWT_PUBLIC_KEY: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
}): {
  secret: { public: string };
  verify: {
    algorithms: ["RS256"];
    issuer: string;
    audience: string;
  };
};

/** Reject a deployment that accidentally reuses one secret for two purposes. */
export declare function assertDistinctSecrets(
  env?: Record<string, unknown>,
): void;

/** Base environment schema shared by every service (no credentials). */
export declare const baseEnvSchema: z.ZodObject<{
  NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
}>;

/** Parse a comma-separated CORS_ORIGIN into exact browser Origin strings. */
export declare function parseCorsOrigins(value?: string): string[];

/**
 * Bounded Postgres pool settings. DB_POOL_MAX overrides fallbackMax for the
 * whole fleet; leaks are bounded by idle/connection timeouts.
 */
export declare function dbPoolOptions(
  connectionString: string,
  fallbackMax?: number,
): {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

/** Parse process.env against a service schema; exits the process on failure. */
export declare function loadEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T>;

/** Attach the platform's uniform JSON error envelope to a Fastify app. */
export declare function registerErrorHandler(app: FastifyInstance): void;

/** fetch with an abort timeout. */
export declare function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs?: number,
): Promise<Response>;
