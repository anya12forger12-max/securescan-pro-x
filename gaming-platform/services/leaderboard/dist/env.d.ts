import { z } from "zod";
export declare const LeaderboardEnvSchema: z.ZodObject<{
    JWT_PUBLIC_KEY: z.ZodString;
    JWT_ISSUER: z.ZodDefault<z.ZodString>;
    JWT_AUDIENCE: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type LeaderboardEnv = z.infer<typeof LeaderboardEnvSchema>;
export declare function loadLeaderboardEnv(): LeaderboardEnv;
//# sourceMappingURL=env.d.ts.map