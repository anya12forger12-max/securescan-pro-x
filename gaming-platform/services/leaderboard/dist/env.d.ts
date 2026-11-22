import { z } from "zod";
export declare const LeaderboardEnvSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    JWT_ACCESS_SECRET: z.ZodString;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type LeaderboardEnv = z.infer<typeof LeaderboardEnvSchema>;
export declare function loadLeaderboardEnv(): LeaderboardEnv;
//# sourceMappingURL=env.d.ts.map