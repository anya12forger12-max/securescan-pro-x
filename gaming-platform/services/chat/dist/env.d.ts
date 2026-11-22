import { z } from "zod";
export declare const ChatEnvSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodDefault<z.ZodNumber>;
    JWT_ACCESS_SECRET: z.ZodString;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    SERVICE_TOKEN: z.ZodDefault<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    DATABASE_URL: string;
    PORT: number;
    JWT_ACCESS_SECRET: string;
    REALTIME_URL: string;
    SERVICE_TOKEN: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: string;
}, {
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    PORT?: number | undefined;
    REALTIME_URL?: string | undefined;
    SERVICE_TOKEN?: string | undefined;
    CORS_ORIGIN?: string | undefined;
    LOG_LEVEL?: string | undefined;
}>;
export type ChatEnv = z.infer<typeof ChatEnvSchema>;
export declare function loadChatEnv(): ChatEnv;
//# sourceMappingURL=env.d.ts.map