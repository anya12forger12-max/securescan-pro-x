import { z } from "zod";
export declare const ChatEnvSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    JWT_ACCESS_SECRET: z.ZodString;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    REALTIME_SERVICE_TOKEN: z.ZodString;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type ChatEnv = z.infer<typeof ChatEnvSchema>;
export declare function loadChatEnv(): ChatEnv;
//# sourceMappingURL=env.d.ts.map