import { loadCodenamesEnv } from "./env.js";
import { buildCodenamesService } from "./app.js";
import { getPool } from "./db.js";
const env = loadCodenamesEnv();
const pool = getPool(env.DATABASE_URL);
const app = await buildCodenamesService(env);
const start = async () => {
    try {
        await app.listen({ port: env.PORT, host: "0.0.0.0" });
        app.log.info(`codenames service listening on port ${env.PORT}`);
    }
    catch (err) {
        app.log.error(err, "codenames service failed to start");
        process.exit(1);
    }
};
start();
export { pool, env };
