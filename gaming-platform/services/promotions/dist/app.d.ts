import type { FastifyInstance } from "fastify";
import type { PromotionsEnv } from "./env.js";
import type { PromotionsRepository } from "./repo.js";
export interface WalletCreditInput {
    userId: string;
    amount: string;
    type: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
}
export interface WalletClient {
    credit(input: WalletCreditInput): Promise<unknown>;
}
export interface ResponsibleGamingCheck {
    allowed: boolean;
    reason?: string;
}
export interface ResponsibleGamingClient {
    check(userId: string, action: string, amount: string): Promise<ResponsibleGamingCheck>;
}
export interface PromotionsDeps {
    env: PromotionsEnv;
    repo: PromotionsRepository;
    wallet?: WalletClient | null;
    rg?: ResponsibleGamingClient | null;
    publish?: (topic: string, payload: unknown) => unknown | Promise<unknown>;
    ready?: () => unknown | Promise<unknown>;
}
export declare function buildPromotionsService(deps: PromotionsDeps): Promise<FastifyInstance>;
//# sourceMappingURL=app.d.ts.map