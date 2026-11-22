import pg from "pg";
import { dbPoolOptions } from "@gp/config";
const { Pool } = pg;
const pools = new Map();
export function getPool(connectionString) {
    let pool = pools.get(connectionString);
    if (!pool) {
        pool = new Pool(dbPoolOptions(connectionString));
        pools.set(connectionString, pool);
    }
    return pool;
}
export async function closePool() {
    await Promise.all([...pools.values()].map((p) => p.end()));
    pools.clear();
}
export async function createSession(pool, input) {
    const result = await pool.query(`INSERT INTO game_sessions (id, game_type, host_id)
     VALUES ($1, $2, $3)
     RETURNING id, game_type, status, host_id, created_at, ended_at`, [input.id, input.game_type, input.host_id]);
    return result.rows[0];
}
export async function getSession(pool, id) {
    const result = await pool.query(`SELECT id, game_type, status, host_id, created_at, ended_at
     FROM game_sessions WHERE id = $1`, [id]);
    return result.rows[0];
}
export async function endSession(pool, id) {
    // Conditional so a late duplicate end request cannot move ended_at.
    const result = await pool.query(`UPDATE game_sessions SET status = 'ended', ended_at = now()
     WHERE id = $1 AND status <> 'ended'`, [id]);
    return (result.rowCount ?? 0) > 0;
}
export async function joinSession(pool, sessionId, userId) {
    // The session state check and the insert are one statement. The unique
    // (session_id, user_id) constraint remains the duplicate-join guard.
    const result = await pool.query(`INSERT INTO game_players (session_id, user_id)
     SELECT $1, $2
      WHERE EXISTS (SELECT 1 FROM game_sessions WHERE id = $1 AND status = 'waiting')
     ON CONFLICT (session_id, user_id) DO NOTHING
     RETURNING id, session_id, user_id, joined_at`, [sessionId, userId]);
    return result.rows[0] ?? null;
}
export async function listSessionPlayers(pool, sessionId) {
    const result = await pool.query(`SELECT id, session_id, user_id, joined_at FROM game_players WHERE session_id = $1 ORDER BY joined_at ASC`, [sessionId]);
    return result.rows;
}
