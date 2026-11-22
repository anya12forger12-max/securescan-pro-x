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
/** A wallet failure is only safe to roll back when the request was definitely
 * rejected. Network timeouts and 5xx responses may hide a committed credit. */
export declare class WalletCreditError extends Error {
    readonly ambiguous: boolean;
    constructor(message: string, ambiguous: boolean);
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