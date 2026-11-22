import { loadChatEnv } from "./env.js";
import { buildChatService } from "./app.js";
import { getPool } from "./db.js";

const env = loadChatEnv();
const pool = getPool(env.DATABASE_URL);
const app = await buildChatService(env);

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`chat service listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err, "chat service failed to start");
    process.exit(1);
  }
};

start();

export { pool, env };
