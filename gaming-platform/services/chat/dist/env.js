import { z } from "zod";
import { jwtVerifyEnvFields } from "@gp/config";
export const ChatEnvSchema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3016),
    ...jwtVerifyEnvFields,
    REALTIME_URL: z.string().url().default("http://localhost:3010"),
    // Used to authenticate publishes to the realtime hub's /internal/events.
    REALTIME_SERVICE_TOKEN: z.string().min(32, "REALTIME_SERVICE_TOKEN must be at least 32 characters"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.string().default("info"),
});
export function loadChatEnv() {
    return ChatEnvSchema.parse({
        DATABASE_URL: process.env.DATABASE_URL,
        PORT: process.env.PORT,
        JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
        JWT_ISSUER: process.env.JWT_ISSUER,
        JWT_AUDIENCE: process.env.JWT_AUDIENCE,
        REALTIME_URL: process.env.REALTIME_URL,
        REALTIME_SERVICE_TOKEN: process.env.REALTIME_SERVICE_TOKEN,
        CORS_ORIGIN: process.env.CORS_ORIGIN,
        LOG_LEVEL: process.env.LOG_LEVEL,
    });
}
