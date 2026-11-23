import { z } from "zod";
import { dbPoolOptions, fetchWithTimeout, loadEnv } from "@gp/config";
import pg from "pg";
import { EventBus } from "@gp/event-bus";
import { promotionsEnvSchema } from "./env.js";
import { PgPromotionsRepository } from "./repo.js";
import { buildPromotionsService, WalletCreditError } from "./app.js";
import type {
  ResponsibleGamingCheck,
  ResponsibleGamingClient,
  WalletCreditInput,
  WalletClient,
} from "./app.js";
/**
 * The recovered env schema predates scoped wallet credentials and still marks
 * WALLET_SERVICE_TOKEN as mandatory. Compose now gives this service only the
 * bonus-scoped token, so extend the schema here: either credential can satisfy
 * local runs, at least one is required, and the scoped token always wins.
 */
const walletTokenEnvSchema = promotionsEnvSchema
  .extend({
    WALLET_SERVICE_TOKEN: z.string().min(32).optional(),
    WALLET_BONUS_SERVICE_TOKEN: z.string().min(32).optional(),
  })
  .refine((values) => Boolean(values.WALLET_BONUS_SERVICE_TOKEN ?? values.WALLET_SERVICE_TOKEN), {
    message: "WALLET_BONUS_SERVICE_TOKEN is required (WALLET_SERVICE_TOKEN is a local-only fallback)",
    path: ["WALLET_BONUS_SERVICE_TOKEN"],
  });

/** Entry point. Env is validated before anything binds a port or opens a socket. */
const env = loadEnv(walletTokenEnvSchema);
const walletServiceToken = env.WALLET_BONUS_SERVICE_TOKEN ?? env.WALLET_SERVICE_TOKEN;
if (!walletServiceToken) {
  // Unreachable after the refine above; keeps the header value a definite string.
  console.error("[promotions] missing wallet capability token");
  process.exit(1);
}
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
            headers: { "content-type": "application/json", "x-service-token": walletServiceToken },
            body: JSON.stringify(input),
          });
        }
        catch (err) {
          // The request never got a usable response; the wallet may still have
          // committed before the connection failed.
          throw new WalletCreditError(`wallet credit request failed: ${(err as Error).message}`, true);
        }
        // A 4xx is a deterministic rejection and may be rolled back. 5xx/408
        // can follow a committed ledger write, so the claim must be retained
        // and reconciled with the same idempotency key instead.
        if (!res.ok) {
          throw new WalletCreditError(
            `wallet credit rejected with HTTP ${res.status}`,
            res.status >= 500 || res.status === 408,
          );
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
  // The wallet capability may be supplied under the scoped bonus name in
  // Compose. Normalise it back to the field the service type expects.
  env: { ...env, WALLET_SERVICE_TOKEN: walletServiceToken },
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
  await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
}
catch (err) {
  app.log.error({ err }, "promotions service failed to start");
  await pool.end().catch(() => undefined);
  await bus.close().catch(() => undefined);
  process.exit(1);
}
export { promotionsEnvSchema } from "./env.js";
export { buildPromotionsService } from "./app.js";
