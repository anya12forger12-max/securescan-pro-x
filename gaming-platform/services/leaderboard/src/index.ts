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

// app.close() runs the service's onClose hook, which drains requests and ends
// every pooled Postgres client before Compose kills the container.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}

export { pool, env };
