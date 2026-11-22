import { z } from "zod";

export const ChatEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3016),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  REALTIME_URL: z.string().url().default("http://localhost:3010"),
  // Used to authenticate publishes to the realtime hub's /internal/events.
  SERVICE_TOKEN: z.string().min(32, "SERVICE_TOKEN must be at least 32 characters").default("dev-only-service-token-change-me-000000"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.string().default("info"),
});

export type ChatEnv = z.infer<typeof ChatEnvSchema>;

export function loadChatEnv(): ChatEnv {
  return ChatEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    PORT: process.env.PORT,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    REALTIME_URL: process.env.REALTIME_URL,
    SERVICE_TOKEN: process.env.SERVICE_TOKEN,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    LOG_LEVEL: process.env.LOG_LEVEL,
  });
}
