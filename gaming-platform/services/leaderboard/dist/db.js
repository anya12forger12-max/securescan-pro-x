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
/**
 * Derive the score from authoritative game state instead of trusting the
 * client. Winners get 100, other participants in a completed session get 10.
 * SQL updates are what decide winners; the score submit endpoint only records
 * the result.
 */
export async function verifyGameResult(pool, input) {
    const result = await pool.query(`WITH seats AS (
       SELECT user_id,
              row_number() OVER (ORDER BY joined_at, user_id) AS seat
         FROM game_players WHERE session_id = $1
     )
     SELECT CASE
       WHEN s.game_type = 'gin-rummy' AND EXISTS (
         SELECT 1 FROM gin_rummy_games g
          WHERE g.session_id = s.id AND g.winner_id = $2) THEN 100
       WHEN s.game_type = 'pictionary' AND EXISTS (
         SELECT 1 FROM pictionary_rounds r
          WHERE r.session_id = s.id AND r.winner_id = $2) THEN 100
       WHEN s.game_type = 'codenames' AND EXISTS (
         SELECT 1 FROM codenames_games c
          JOIN seats me ON me.user_id = $2
          WHERE c.session_id = s.id AND c.winner IS NOT NULL
            AND ((c.winner = 'red' AND me.seat % 2 = 1) OR
                 (c.winner = 'blue' AND me.seat % 2 = 0))) THEN 100
       ELSE 10
     END AS score
     FROM game_sessions s
     JOIN seats ON seats.user_id = $2
    WHERE s.id = $1 AND s.status = 'ended' AND s.game_type = $3
    LIMIT 1`, [input.sessionId, input.userId, input.gameType]);
    if (!result.rowCount)
        return null;
    return Number(result.rows[0].score);
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
