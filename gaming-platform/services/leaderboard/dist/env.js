import { z } from "zod";
import { jwtVerifyEnvFields } from "@gp/config";
export const LeaderboardEnvSchema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3020),
    ...jwtVerifyEnvFields,
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.string().default("info"),
});
export function loadLeaderboardEnv() {
    return LeaderboardEnvSchema.parse({
        DATABASE_URL: process.env.DATABASE_URL,
        PORT: process.env.PORT,
        JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
        JWT_ISSUER: process.env.JWT_ISSUER,
        JWT_AUDIENCE: process.env.JWT_AUDIENCE,
        CORS_ORIGIN: process.env.CORS_ORIGIN,
        LOG_LEVEL: process.env.LOG_LEVEL,
    });
}
