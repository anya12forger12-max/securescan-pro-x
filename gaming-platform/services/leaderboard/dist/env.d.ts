import { z } from "zod";
export declare const LeaderboardEnvSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodNumber>;
    JWT_ACCESS_SECRET: z.ZodString;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    DATABASE_URL: string;
    PORT: number;
    JWT_ACCESS_SECRET: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: string;
}, {
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    PORT?: number | undefined;
    CORS_ORIGIN?: string | undefined;
    LOG_LEVEL?: string | undefined;
}>;
export type LeaderboardEnv = z.infer<typeof LeaderboardEnvSchema>;
export declare function loadLeaderboardEnv(): LeaderboardEnv;
//# sourceMappingURL=env.d.ts.map