import pg from "pg";
const { Pool } = pg;
const pools = new Map();
export function getPool(connectionString) {
    let pool = pools.get(connectionString);
    if (!pool) {
        pool = new Pool({ connectionString, max: 20 });
        pools.set(connectionString, pool);
    }
    return pool;
}
export async function closePool() {
    await Promise.all([...pools.values()].map((p) => p.end()));
    pools.clear();
}
export async function verifyGameResult(pool, input) {
    const result = await pool.query(`SELECT s.id
     FROM game_sessions s
     JOIN game_players p ON p.session_id = s.id
     WHERE s.id = $1 AND s.status = 'ended' AND s.game_type = $2 AND p.user_id = $3
     LIMIT 1`, [input.sessionId, input.gameType, input.userId]);
    return result.rowCount > 0;
}
export async function createLeaderboardEntry(pool, input) {
    // A score is bound to one verified game session. Without this, a player
    // could submit unlimited inflated scores for the same completed session.
    const result = await pool.query(`INSERT INTO leaderboard_entries (user_id, username, game_type, score, session_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, session_id) DO NOTHING
     RETURNING id, user_id, username, game_type, score, session_id, created_at`, [input.user_id, input.username, input.game_type, input.score, input.session_id]);
    if (result.rows[0])
        return result.rows[0];
    // Idempotent replay: return the entry that was already recorded.
    const existing = await pool.query(`SELECT id, user_id, username, game_type, score, session_id, created_at
      FROM leaderboard_entries WHERE user_id = $1 AND session_id = $2`, [input.user_id, input.session_id]);
    return existing.rows[0];
}
export async function getLeaderboard(pool, gameType, limit = 50) {
    const result = await pool.query(`SELECT id, user_id, username, game_type, score, created_at
     FROM leaderboard_entries
     WHERE game_type = $1
     ORDER BY score DESC, created_at ASC
     LIMIT $2`, [gameType, limit]);
    return result.rows;
}
export async function getUserBestScores(pool, userId) {
    const result = await pool.query(`SELECT DISTINCT ON (game_type) id, user_id, username, game_type, score, created_at
     FROM leaderboard_entries
     WHERE user_id = $1
     ORDER BY game_type, score DESC, created_at ASC`, [userId]);
    return result.rows;
}
export async function getUserStats(pool, userId) {
    const result = await pool.query(`SELECT user_id, username,
            COUNT(*) as total_games,
            SUM(score) as total_score,
            MAX(score) as best_score
     FROM leaderboard_entries
     WHERE user_id = $1
     GROUP BY user_id, username`, [userId]);
    return result.rows[0];
}
