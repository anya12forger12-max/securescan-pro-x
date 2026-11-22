import { loadLeaderboardEnv } from "./env.js";
import { buildLeaderboardService } from "./app.js";
import { getPool } from "./db.js";

const env = loadLeaderboardEnv();
const pool = getPool(env.DATABASE_URL);
const app = await buildLeaderboardService(env);

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`leaderboard service listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err, "leaderboard service failed to start");
    process.exit(1);
  }
};

start();

export { pool, env };
