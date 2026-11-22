import type { Pool as PoolType } from "pg";
export type DbTimestamp = Date | string;
export type ClaimStatus = "active" | "completed";
export interface PromotionRow {
    id: string;
    code: string;
    type: string;
    title: string;
    description: string;
    bonus_amount: string;
    wagering_requirement: string;
    max_claims: number;
    claims_count: number;
    starts_at: DbTimestamp;
    expires_at: DbTimestamp;
    active: boolean;
}
export interface ClaimRow {
    id: string;
    promotion_id: string;
    user_id: string;
    claimed_at: DbTimestamp;
    bonus_amount: string;
    wagering_progress: string;
    wagering_target: string;
    status: ClaimStatus;
}
export interface DeletedClaimRow {
    promotion_id: string;
}
export interface Promotion {
    id: string;
    code: string;
    type: string;
    title: string;
    description: string;
    bonusAmount: string;
    wageringRequirement: number;
    maxClaims: number;
    claimsCount: number;
    startsAt: string;
    expiresAt: string;
    active: boolean;
}
export interface Claim {
    id: string;
    promotionId: string;
    userId: string;
    claimedAt: string;
    bonusAmount: string;
    wageringProgress: string;
    wageringTarget: string;
    status: ClaimStatus;
}
export interface NewClaimInput {
    promotionId: string;
    userId: string;
    claimedAt: string;
    bonusAmount: string;
    wageringProgress: string;
    wageringTarget: string;
    status: ClaimStatus;
}
export interface NewPromotionInput {
    code: string;
    title: string;
    type: string;
    description: string;
    bonusAmount: string;
    wageringRequirement: number;
    maxClaims: number;
    startsAt: string;
    expiresAt: string;
    active?: boolean;
}
export interface PromotionPatch {
    title?: string;
    description?: string;
    active?: boolean;
    maxClaims?: number;
    expiresAt?: string;
}
export interface PromotionsRepository {
    listActive(now: string): Promise<Promotion[]>;
    listAll(): Promise<Promotion[]>;
    findByCode(code: string): Promise<Promotion | null>;
    findById(id: string): Promise<Promotion | null>;
    createClaim(claim: NewClaimInput): Promise<Claim | null>;
    deleteClaim(claimId: string): Promise<boolean>;
    findClaimByUserAndPromo(userId: string, promotionId: string): Promise<Claim | null>;
    listClaimsByUser(userId: string): Promise<Claim[]>;
    updateClaimProgress(claimId: string, progress: string): Promise<void>;
    completeClaim(claimId: string): Promise<void>;
    createPromotion(input: NewPromotionInput): Promise<Promotion>;
    updatePromotion(id: string, patch: PromotionPatch): Promise<Promotion | null>;
}
export declare class InMemoryPromotionsRepository implements PromotionsRepository {
    promotions: Promotion[];
    claims: Claim[];
    seed(promos: Promotion[]): void;
    listActive(now: string): Promise<Promotion[]>;
    findByCode(code: string): Promise<Promotion | null>;
    findById(id: string): Promise<Promotion | null>;
    createClaim(claim: NewClaimInput): Promise<Claim | null>;
    deleteClaim(claimId: string): Promise<boolean>;
    findClaimByUserAndPromo(userId: string, promotionId: string): Promise<Claim | null>;
    listClaimsByUser(userId: string): Promise<Claim[]>;
    updateClaimProgress(claimId: string, progress: string): Promise<void>;
    completeClaim(claimId: string): Promise<void>;
    listAll(): Promise<Promotion[]>;
    createPromotion(input: NewPromotionInput): Promise<Promotion>;
    updatePromotion(id: string, patch: PromotionPatch): Promise<Promotion | null>;
}
export declare class PgPromotionsRepository implements PromotionsRepository {
    pool: PoolType;
    constructor(pool: PoolType);
    listActive(now: string): Promise<Promotion[]>;
    listAll(): Promise<Promotion[]>;
    findByCode(code: string): Promise<Promotion | null>;
    findById(id: string): Promise<Promotion | null>;
    createClaim(claim: NewClaimInput): Promise<Claim | null>;
    deleteClaim(claimId: string): Promise<boolean>;
    findClaimByUserAndPromo(userId: string, promotionId: string): Promise<Claim | null>;
    listClaimsByUser(userId: string): Promise<Claim[]>;
    updateClaimProgress(claimId: string, progress: string): Promise<void>;
    completeClaim(claimId: string): Promise<void>;
    createPromotion(input: NewPromotionInput): Promise<Promotion>;
    updatePromotion(id: string, patch: PromotionPatch): Promise<Promotion | null>;
}
//# sourceMappingURL=repo.d.ts.map