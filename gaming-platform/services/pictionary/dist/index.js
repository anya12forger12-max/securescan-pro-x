import { loadPictionaryEnv } from "./env.js";
import { buildPictionaryService } from "./app.js";
import { getPool } from "./db.js";
const env = loadPictionaryEnv();
const pool = getPool(env.DATABASE_URL);
const app = await buildPictionaryService(env);
const start = async () => {
    try {
        await app.listen({ port: env.PORT, host: "0.0.0.0" });
        app.log.info(`pictionary service listening on port ${env.PORT}`);
    }
    catch (err) {
        app.log.error(err, "pictionary service failed to start");
        process.exit(1);
    }
};
start();
export { pool, env };
