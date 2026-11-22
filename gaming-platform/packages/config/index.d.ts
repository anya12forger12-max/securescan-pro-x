import type { z } from "zod";
import type { FastifyInstance } from "fastify";

/** Capability credentials, declared only by the services that hold them. */
export declare const capabilityTokenFields: {
  SERVICE_TOKEN: z.ZodString;
  ADMIN_SERVICE_TOKEN: z.ZodString;
  WALLET_SERVICE_TOKEN: z.ZodString;
  REALTIME_SERVICE_TOKEN: z.ZodString;
  PROMOTIONS_SERVICE_TOKEN: z.ZodString;
  ADMIN_BOOTSTRAP_TOKEN: z.ZodString;
};

/** Pick a subset of capability fields for use with `.extend()`. */
export declare function capabilityFields<K extends keyof typeof capabilityTokenFields>(
  ...names: K[]
): { [P in K]: z.ZodString };

/** Base environment schema shared by every service (no credentials). */
export declare const baseEnvSchema: z.ZodObject<{
  NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
}>;

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
