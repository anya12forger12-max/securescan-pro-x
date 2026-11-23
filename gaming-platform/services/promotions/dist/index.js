import { dbPoolOptions, fetchWithTimeout, loadEnv } from "@gp/config";
import pg from "pg";
import { PgPromotionsRepository } from "./repo.js";
import { promotionsEnvSchema } from "./env.js";
import { buildPromotionsService, WalletCreditError } from "./app.js";
/** Entry point. Env is validated before anything binds a port or opens a socket. */
const env = loadEnv(promotionsEnvSchema);
const walletServiceToken = env.WALLET_BONUS_SERVICE_TOKEN ?? env.WALLET_SERVICE_TOKEN;
if (!walletServiceToken) {
    // Unreachable after the schema refine; keeps the header value a definite string.
    console.error("[promotions] missing wallet capability token");
    process.exit(1);
}
// Only the narrow bonus capability is sent. The full wallet token is never
// shipped to this container, so there is no legacy header to fall back to.
const walletHeaders = {
    "content-type": "application/json",
    "x-service-token": walletServiceToken,
};
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));
const repo = new PgPromotionsRepository(pool);
const wallet = env.WALLET_URL
    ? {
        credit: async (input) => {
            let res;
            try {
                res = await fetchWithTimeout(`${env.WALLET_URL}/internal/wallet/credit`, {
                    method: "POST",
                    headers: walletHeaders,
                    body: JSON.stringify(input),
                });
            }
            catch (err) {
                // The request never got a usable response; the wallet may still have
                // committed before the connection failed.
                throw new WalletCreditError(`wallet credit request failed: ${err.message}`, true);
            }
            // A 4xx is a deterministic rejection and may be rolled back. 5xx/408
            // can follow a committed ledger write, so the claim must be retained
            // and reconciled with the same idempotency key instead.
            if (!res.ok) {
                throw new WalletCreditError(`wallet credit rejected with HTTP ${res.status}`, res.status >= 500 || res.status === 408);
            }
            return true;
        },
    }
    : null;
const rg = env.RESPONSIBLE_GAMING_URL
    ? {
        check: async (userId, action, amount) => {
            try {
                const res = await fetchWithTimeout(`${env.RESPONSIBLE_GAMING_URL}/v1/internal/check`, {
                    method: "POST",
                    headers: { "content-type": "application/json", "x-service-token": env.SERVICE_TOKEN },
                    body: JSON.stringify({ userId, action, amount }),
                });
                if (!res.ok)
                    return { allowed: false, reason: "rg unavailable" };
                const data = (await res.json());
                return { allowed: data.data?.decision?.allowed ?? false, reason: data.data?.decision?.reason };
            }
            catch {
                return { allowed: false, reason: "rg unavailable" };
            }
        },
    }
    : null;
/** Publish through realtime's capability-authenticated internal endpoint. The
 * old EventBus wrote to Redis, which realtime never subscribes to, so events
 * silently vanished. Publishing is best-effort: the claim is already durable.
 * Payloads are redacted at the source as well as by realtime on write. */
const publish = async (topic, payload) => {
    try {
        await fetchWithTimeout(`${env.REALTIME_URL}/internal/events`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-service-token": env.REALTIME_SERVICE_TOKEN,
            },
            body: JSON.stringify({ topic, payload }),
        }, 2000);
    }
    catch (err) {
        console.warn(`[promotions] realtime publish of ${topic} failed:`, err.message);
    }
};
const app = await buildPromotionsService({
    env: { ...env, WALLET_SERVICE_TOKEN: walletServiceToken },
    repo,
    wallet,
    rg,
    publish,
    ready: () => pool.query("SELECT 1"),
});
const stop = async () => {
    app.log.info("shutting down promotions service");
    try {
        await app.close();
        await pool.end();
    }
    finally {
        process.exit(0);
    }
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
try {
    await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
}
catch (err) {
    app.log.error({ err }, "promotions service failed to start");
    await pool.end().catch(() => undefined);
    process.exit(1);
}
export { promotionsEnvSchema } from "./env.js";
export { buildPromotionsService } from "./app.js";
