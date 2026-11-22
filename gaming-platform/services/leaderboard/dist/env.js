import { z } from "zod";
export const LeaderboardEnvSchema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3020),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.string().default("info"),
});
export function loadLeaderboardEnv() {
    return LeaderboardEnvSchema.parse({
        DATABASE_URL: process.env.DATABASE_URL,
        PORT: process.env.PORT,
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
        CORS_ORIGIN: process.env.CORS_ORIGIN,
        LOG_LEVEL: process.env.LOG_LEVEL,
    });
}
