import { z } from "zod";
export const CodenamesEnvSchema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3017),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    REALTIME_URL: z.string().url().default("http://localhost:3010"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.string().default("info"),
});
export function loadCodenamesEnv() {
    return CodenamesEnvSchema.parse({
        DATABASE_URL: process.env.DATABASE_URL,
        PORT: process.env.PORT,
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
        REALTIME_URL: process.env.REALTIME_URL,
        CORS_ORIGIN: process.env.CORS_ORIGIN,
        LOG_LEVEL: process.env.LOG_LEVEL,
    });
}
