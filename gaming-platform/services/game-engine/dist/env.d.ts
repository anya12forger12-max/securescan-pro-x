import { z } from "zod";
export declare const GameEngineEnvSchema: z.ZodObject<{
    JWT_PUBLIC_KEY: z.ZodString;
    JWT_ISSUER: z.ZodDefault<z.ZodString>;
    JWT_AUDIENCE: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type GameEngineEnv = z.infer<typeof GameEngineEnvSchema>;
export declare function loadGameEngineEnv(): GameEngineEnv;
//# sourceMappingURL=env.d.ts.map