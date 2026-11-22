import { z } from "zod";
export declare const CodenamesEnvSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodNumber>;
    JWT_ACCESS_SECRET: z.ZodString;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    PORT: number;
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    REALTIME_URL: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: string;
}, {
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    PORT?: number | undefined;
    REALTIME_URL?: string | undefined;
    CORS_ORIGIN?: string | undefined;
    LOG_LEVEL?: string | undefined;
}>;
export type CodenamesEnv = z.infer<typeof CodenamesEnvSchema>;
export declare function loadCodenamesEnv(): CodenamesEnv;
//# sourceMappingURL=env.d.ts.map