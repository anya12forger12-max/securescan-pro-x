import { randomUUID } from "node:crypto";
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

export class InMemoryPromotionsRepository implements PromotionsRepository {
  promotions: Promotion[] = [];
  claims: Claim[] = [];

  seed(promos: Promotion[]): void {
    this.promotions = promos;
  }

  async listActive(now: string): Promise<Promotion[]> {
    return this.promotions.filter((p) => p.active && p.startsAt <= now && p.expiresAt >= now);
  }

  async findByCode(code: string): Promise<Promotion | null> {
    return this.promotions.find((p) => p.code === code) ?? null;
  }

  async findById(id: string): Promise<Promotion | null> {
    return this.promotions.find((p) => p.id === id) ?? null;
  }

  async createClaim(claim: NewClaimInput): Promise<Claim | null> {
    if (this.claims.some((c) => c.userId === claim.userId && c.promotionId === claim.promotionId))
      return null;
    const c: Claim = { id: randomUUID(), ...claim };
    this.claims.push(c);
    const p = this.promotions.find((x) => x.id === claim.promotionId);
    if (p)
      p.claimsCount += 1;
    return c;
  }

  async deleteClaim(claimId: string): Promise<boolean> {
    const index = this.claims.findIndex((c) => c.id === claimId);
    if (index < 0)
      return false;
    const [claim] = this.claims.splice(index, 1);
    const p = this.promotions.find((x) => x.id === claim.promotionId);
    if (p)
      p.claimsCount -= 1;
    return true;
  }

  async findClaimByUserAndPromo(userId: string, promotionId: string): Promise<Claim | null> {
    return this.claims.find((c) => c.userId === userId && c.promotionId === promotionId) ?? null;
  }

  async listClaimsByUser(userId: string): Promise<Claim[]> {
    return this.claims.filter((c) => c.userId === userId);
  }

  async updateClaimProgress(claimId: string, progress: string): Promise<void> {
    const c = this.claims.find((x) => x.id === claimId);
    if (c)
      c.wageringProgress = progress;
  }

  async completeClaim(claimId: string): Promise<void> {
    const c = this.claims.find((x) => x.id === claimId);
    if (c)
      c.status = "completed";
  }

  async listAll(): Promise<Promotion[]> {
    return [...this.promotions];
  }

  async createPromotion(input: NewPromotionInput): Promise<Promotion> {
    const p: Promotion = {
      id: randomUUID(),
      ...input,
      description: input.description,
      active: input.active ?? true,
      claimsCount: 0,
    };
    this.promotions.push(p);
    return p;
  }

  async updatePromotion(id: string, patch: PromotionPatch): Promise<Promotion | null> {
    const p = this.promotions.find((x) => x.id === id);
    if (!p)
      return null;
    Object.assign(p, patch);
    return p;
  }
}

const iso = (v: DbTimestamp): string => (v instanceof Date ? v.toISOString() : String(v));

function toPromotion(r: PromotionRow): Promotion {
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    title: r.title,
    description: r.description,
    bonusAmount: r.bonus_amount,
    wageringRequirement: Number(r.wagering_requirement),
    maxClaims: r.max_claims,
    claimsCount: r.claims_count,
    startsAt: iso(r.starts_at),
    expiresAt: iso(r.expires_at),
    active: r.active,
  };
}

function toClaim(r: ClaimRow): Claim {
  return {
    id: r.id,
    promotionId: r.promotion_id,
    userId: r.user_id,
    claimedAt: iso(r.claimed_at),
    bonusAmount: r.bonus_amount,
    wageringProgress: r.wagering_progress,
    wageringTarget: r.wagering_target,
    status: r.status,
  };
}

export class PgPromotionsRepository implements PromotionsRepository {
  pool: PoolType;

  constructor(pool: PoolType) {
    this.pool = pool;
  }

  async listActive(now: string): Promise<Promotion[]> {
    const { rows } = await this.pool.query<PromotionRow>(`SELECT * FROM promotions.promotions
        WHERE active = true AND starts_at <= $1 AND expires_at >= $1
        ORDER BY starts_at DESC, code ASC`, [now]);
    return rows.map(toPromotion);
  }

  async listAll(): Promise<Promotion[]> {
    const { rows } = await this.pool.query<PromotionRow>(`SELECT * FROM promotions.promotions ORDER BY created_at DESC, code ASC`);
    return rows.map(toPromotion);
  }

  async findByCode(code: string): Promise<Promotion | null> {
    const { rows } = await this.pool.query<PromotionRow>(`SELECT * FROM promotions.promotions WHERE code = $1`, [code]);
    return rows[0] ? toPromotion(rows[0]) : null;
  }

  async findById(id: string): Promise<Promotion | null> {
    const { rows } = await this.pool.query<PromotionRow>(`SELECT * FROM promotions.promotions WHERE id = $1`, [id]);
    return rows[0] ? toPromotion(rows[0]) : null;
  }

  async createClaim(claim: NewClaimInput): Promise<Claim | null> {
    // The counter update and the insert share a transaction: a claim that is
    // rolled back must not leave max-claims accounting inflated.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<ClaimRow>(`INSERT INTO promotions.promotion_claims
           (promotion_id, user_id, claimed_at, bonus_amount, wagering_progress, wagering_target, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, promotion_id) DO NOTHING
         RETURNING *`, [
        claim.promotionId, claim.userId, claim.claimedAt, claim.bonusAmount,
        claim.wageringProgress, claim.wageringTarget, claim.status,
      ]);
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(`UPDATE promotions.promotions SET claims_count = claims_count + 1, updated_at = now() WHERE id = $1`, [claim.promotionId]);
      await client.query("COMMIT");
      return toClaim(row);
    }
    catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    finally {
      client.release();
    }
  }

  async deleteClaim(claimId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<DeletedClaimRow>(`DELETE FROM promotions.promotion_claims WHERE id = $1 RETURNING promotion_id`, [claimId]);
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(`UPDATE promotions.promotions SET claims_count = claims_count - 1, updated_at = now() WHERE id = $1`, [row.promotion_id]);
      await client.query("COMMIT");
      return true;
    }
    catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    finally {
      client.release();
    }
  }

  async findClaimByUserAndPromo(userId: string, promotionId: string): Promise<Claim | null> {
    const { rows } = await this.pool.query<ClaimRow>(`SELECT * FROM promotions.promotion_claims WHERE user_id = $1 AND promotion_id = $2`, [userId, promotionId]);
    return rows[0] ? toClaim(rows[0]) : null;
  }

  async listClaimsByUser(userId: string): Promise<Claim[]> {
    const { rows } = await this.pool.query<ClaimRow>(`SELECT * FROM promotions.promotion_claims WHERE user_id = $1 ORDER BY claimed_at DESC`, [userId]);
    return rows.map(toClaim);
  }

  async updateClaimProgress(claimId: string, progress: string): Promise<void> {
    await this.pool.query(`UPDATE promotions.promotion_claims SET wagering_progress = $2 WHERE id = $1`, [claimId, progress]);
  }

  async completeClaim(claimId: string): Promise<void> {
    await this.pool.query(`UPDATE promotions.promotion_claims SET status = 'completed' WHERE id = $1`, [claimId]);
  }

  async createPromotion(input: NewPromotionInput): Promise<Promotion> {
    const { rows } = await this.pool.query<PromotionRow>(`INSERT INTO promotions.promotions
         (code, type, title, description, bonus_amount, wagering_requirement, max_claims, starts_at, expires_at, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`, [
      input.code, input.type, input.title, input.description, input.bonusAmount,
      input.wageringRequirement, input.maxClaims, input.startsAt, input.expiresAt,
      input.active ?? true,
    ]);
    return toPromotion(rows[0]!);
  }

  async updatePromotion(id: string, patch: PromotionPatch): Promise<Promotion | null> {
    const { rows } = await this.pool.query<PromotionRow>(`UPDATE promotions.promotions
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              active = COALESCE($4, active),
              max_claims = COALESCE($5, max_claims),
              expires_at = COALESCE($6, expires_at),
              updated_at = now()
        WHERE id = $1
        RETURNING *`, [
      id, patch.title ?? null, patch.description ?? null, patch.active ?? null,
      patch.maxClaims ?? null, patch.expiresAt ?? null,
    ]);
    return rows[0] ? toPromotion(rows[0]) : null;
  }
}
