import { z } from "zod";
export declare const GameEngineEnvSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    JWT_ACCESS_SECRET: z.ZodString;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type GameEngineEnv = z.infer<typeof GameEngineEnvSchema>;
export declare function loadGameEngineEnv(): GameEngineEnv;
//# sourceMappingURL=env.d.ts.map