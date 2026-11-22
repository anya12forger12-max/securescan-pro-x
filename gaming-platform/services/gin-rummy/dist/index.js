import { loadGinRummyEnv } from "./env.js";
import { buildGinRummyService } from "./app.js";
import { getPool } from "./db.js";
const env = loadGinRummyEnv();
const pool = getPool(env.DATABASE_URL);
const app = await buildGinRummyService(env);
const start = async () => {
    try {
        await app.listen({ port: env.PORT, host: "0.0.0.0" });
        app.log.info(`gin-rummy service listening on port ${env.PORT}`);
    }
    catch (err) {
        app.log.error(err, "gin-rummy service failed to start");
        process.exit(1);
    }
};
start();
export { pool, env };
