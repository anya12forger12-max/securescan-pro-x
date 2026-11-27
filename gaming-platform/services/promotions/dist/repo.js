import { randomUUID } from "node:crypto";
export class InMemoryPromotionsRepository {
    promotions = [];
    claims = [];
    seed(promos) {
        this.promotions = promos;
    }
    async listActive(now) {
        return this.promotions.filter((p) => p.active && p.startsAt <= now && p.expiresAt >= now);
    }
    async findByCode(code) {
        return this.promotions.find((p) => p.code === code) ?? null;
    }
    async findById(id) {
        return this.promotions.find((p) => p.id === id) ?? null;
    }
    async createClaim(claim) {
        const p = this.promotions.find((x) => x.id === claim.promotionId);
        if (!p || p.claimsCount >= p.maxClaims)
            return null;
        if (this.claims.some((c) => c.userId === claim.userId && c.promotionId === claim.promotionId))
            return null;
        const c = { id: randomUUID(), ...claim };
        this.claims.push(c);
        p.claimsCount += 1;
        return c;
    }
    async deleteClaim(claimId) {
        const index = this.claims.findIndex((c) => c.id === claimId);
        if (index < 0)
            return false;
        const [claim] = this.claims.splice(index, 1);
        const p = this.promotions.find((x) => x.id === claim.promotionId);
        if (p)
            p.claimsCount -= 1;
        return true;
    }
    async findClaimByUserAndPromo(userId, promotionId) {
        return this.claims.find((c) => c.userId === userId && c.promotionId === promotionId) ?? null;
    }
    async listClaimsByUser(userId) {
        return this.claims.filter((c) => c.userId === userId);
    }
    async updateClaimProgress(claimId, progress) {
        const c = this.claims.find((x) => x.id === claimId);
        if (c)
            c.wageringProgress = progress;
    }
    async completeClaim(claimId) {
        const c = this.claims.find((x) => x.id === claimId);
        if (c)
            c.status = "completed";
    }
    async listAll() {
        return [...this.promotions];
    }
    async createPromotion(input) {
        const p = {
            id: randomUUID(),
            ...input,
            description: input.description,
            active: input.active ?? true,
            claimsCount: 0,
        };
        this.promotions.push(p);
        return p;
    }
    async updatePromotion(id, patch) {
        const p = this.promotions.find((x) => x.id === id);
        if (!p)
            return null;
        if (patch.maxClaims !== undefined && patch.maxClaims < p.claimsCount)
            return null;
        Object.assign(p, patch);
        return p;
    }
}
const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
function toPromotion(r) {
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
function toClaim(r) {
    return {
        id: r.id,
        promotionId: r.promotion_id,
        userId: r.user_id,
        idempotencyKey: r.idempotency_key,
        claimedAt: iso(r.claimed_at),
        bonusAmount: r.bonus_amount,
        wageringProgress: r.wagering_progress,
        wageringTarget: r.wagering_target,
        status: r.status,
    };
}
export class PgPromotionsRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async listActive(now) {
        const { rows } = await this.pool.query(`SELECT * FROM promotions.promotions
        WHERE active = true AND starts_at <= $1 AND expires_at >= $1
        ORDER BY starts_at DESC, code ASC`, [now]);
        return rows.map(toPromotion);
    }
    async listAll() {
        const { rows } = await this.pool.query(`SELECT * FROM promotions.promotions ORDER BY created_at DESC, code ASC`);
        return rows.map(toPromotion);
    }
    async findByCode(code) {
        const { rows } = await this.pool.query(`SELECT * FROM promotions.promotions WHERE code = $1`, [code]);
        return rows[0] ? toPromotion(rows[0]) : null;
    }
    async findById(id) {
        const { rows } = await this.pool.query(`SELECT * FROM promotions.promotions WHERE id = $1`, [id]);
        return rows[0] ? toPromotion(rows[0]) : null;
    }
    async createClaim(claim) {
        // The counter update and the insert share a transaction: a claim that is
        // rolled back must not leave max-claims accounting inflated.
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            // The cap is enforced here, not in the route's pre-check. Two distinct
            // users can otherwise both pass `claimsCount < maxClaims` and both be
            // credited. The conditional UPDATE reserves one slot atomically.
            const reserved = await client.query(`UPDATE promotions.promotions
            SET claims_count = claims_count + 1, updated_at = now()
          WHERE id = $1 AND claims_count < max_claims
          RETURNING 1`, [claim.promotionId]);
            if (!reserved.rowCount) {
                await client.query("ROLLBACK");
                return null;
            }
            const { rows } = await client.query(`INSERT INTO promotions.promotion_claims
           (promotion_id, user_id, idempotency_key, claimed_at, bonus_amount, wagering_progress, wagering_target, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, promotion_id) DO NOTHING
         RETURNING *`, [
                claim.promotionId, claim.userId, claim.idempotencyKey, claim.claimedAt, claim.bonusAmount,
                claim.wageringProgress, claim.wageringTarget, claim.status,
            ]);
            const row = rows[0];
            if (!row) {
                await client.query("ROLLBACK");
                return null;
            }
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
    async deleteClaim(claimId) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const { rows } = await client.query(`DELETE FROM promotions.promotion_claims WHERE id = $1 RETURNING promotion_id`, [claimId]);
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
    async findClaimByUserAndPromo(userId, promotionId) {
        const { rows } = await this.pool.query(`SELECT * FROM promotions.promotion_claims WHERE user_id = $1 AND promotion_id = $2`, [userId, promotionId]);
        return rows[0] ? toClaim(rows[0]) : null;
    }
    async listClaimsByUser(userId) {
        const { rows } = await this.pool.query(`SELECT * FROM promotions.promotion_claims WHERE user_id = $1 ORDER BY claimed_at DESC`, [userId]);
        return rows.map(toClaim);
    }
    async updateClaimProgress(claimId, progress) {
        await this.pool.query(`UPDATE promotions.promotion_claims SET wagering_progress = $2 WHERE id = $1`, [claimId, progress]);
    }
    async completeClaim(claimId) {
        await this.pool.query(`UPDATE promotions.promotion_claims SET status = 'completed' WHERE id = $1`, [claimId]);
    }
    async createPromotion(input) {
        const { rows } = await this.pool.query(`INSERT INTO promotions.promotions
         (code, type, title, description, bonus_amount, wagering_requirement, max_claims, starts_at, expires_at, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`, [
            input.code, input.type, input.title, input.description, input.bonusAmount,
            input.wageringRequirement, input.maxClaims, input.startsAt, input.expiresAt,
            input.active ?? true,
        ]);
        return toPromotion(rows[0]);
    }
    async updatePromotion(id, patch) {
        const { rows } = await this.pool.query(`UPDATE promotions.promotions
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              active = COALESCE($4, active),
              max_claims = COALESCE($5, max_claims),
              expires_at = COALESCE($6, expires_at),
              updated_at = now()
        WHERE id = $1
          AND ($7::int IS NULL OR claims_count <= $7::int)
        RETURNING *`, [
            id, patch.title ?? null, patch.description ?? null, patch.active ?? null,
            patch.maxClaims ?? null, patch.expiresAt ?? null, patch.maxClaims ?? null,
        ]);
        return rows[0] ? toPromotion(rows[0]) : null;
    }
}
