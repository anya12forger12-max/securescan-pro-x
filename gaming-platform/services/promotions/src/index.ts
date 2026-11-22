import { dbPoolOptions, fetchWithTimeout, loadEnv } from "@gp/config";
import pg from "pg";
import { EventBus } from "@gp/event-bus";
import { promotionsEnvSchema } from "./env.js";
import { PgPromotionsRepository } from "./repo.js";
import { buildPromotionsService } from "./app.js";
import type {
  ResponsibleGamingCheck,
  ResponsibleGamingClient,
  WalletCreditInput,
  WalletClient,
} from "./app.js";
/** Entry point. Env is validated before anything binds a port or opens a socket. */
const env = loadEnv(promotionsEnvSchema);
const pool = new pg.Pool(dbPoolOptions(env.DATABASE_URL));
const bus = new EventBus(env.REDIS_URL);
const repo = new PgPromotionsRepository(pool);
const wallet: WalletClient | null = env.WALLET_URL
  ? {
      credit: async (input: WalletCreditInput): Promise<boolean> => {
        let res: Response;
        try {
          res = await fetchWithTimeout(`${env.WALLET_URL}/internal/wallet/credit`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-service-token": env.SERVICE_TOKEN },
            body: JSON.stringify(input),
          });
        }
        catch (err) {
          throw new Error(`wallet credit request failed: ${(err as Error).message}`);
        }
        // buildPromotionsService rolls the claim back on a rejection.
        // Returning false here used to keep the claim and its liability.
        if (!res.ok) {
          throw new Error(`wallet credit rejected with HTTP ${res.status}`);
        }
        return true;
      },
    }
  : null;
const rg: ResponsibleGamingClient | null = env.RESPONSIBLE_GAMING_URL
  ? {
      check: async (userId: string, action: string, amount: string): Promise<ResponsibleGamingCheck> => {
        try {
          const res = await fetchWithTimeout(`${env.RESPONSIBLE_GAMING_URL}/v1/internal/check`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-service-token": env.SERVICE_TOKEN },
            body: JSON.stringify({ userId, action, amount }),
          });
          if (!res.ok)
            return { allowed: false, reason: "rg unavailable" };
          const data = (await res.json()) as { data?: { decision?: { allowed?: boolean; reason?: string } } };
          return { allowed: data.data?.decision?.allowed ?? false, reason: data.data?.decision?.reason };
        }
        catch {
          return { allowed: false, reason: "rg unavailable" };
        }
      },
    }
  : null;
const app = await buildPromotionsService({
  env,
  repo,
  wallet,
  rg,
  publish: (t, p) => bus.publish(t, p),
  ready: () => pool.query("SELECT 1"),
});
const stop = async (): Promise<void> => {
  app.log.info("shutting down promotions service");
  try {
    await app.close();
    await pool.end();
    await bus.close();
  }
  finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}
catch (err) {
  app.log.error({ err }, "promotions service failed to start");
  await pool.end().catch(() => undefined);
  await bus.close().catch(() => undefined);
  process.exit(1);
}
export { promotionsEnvSchema } from "./env.js";
export { buildPromotionsService } from "./app.js";
