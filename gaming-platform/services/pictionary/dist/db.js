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
export async function createRound(pool, input) {
    // The app accepts guesses only while status === 'drawing'. Insert that
    // state explicitly instead of relying on a schema default that disagreed
    // with it ('active'), which made every guess fail with 409.
    const result = await pool.query(`INSERT INTO pictionary_rounds (id, session_id, word, drawer_id, status)
     VALUES ($1, $2, $3, $4, 'drawing')
     RETURNING id, session_id, word, drawer_id, status, started_at, ended_at, winner_id`, [input.id, input.session_id, input.word, input.drawer_id]);
    return result.rows[0];
}
export async function getRound(pool, id) {
    const result = await pool.query(`SELECT id, session_id, word, drawer_id, status, started_at, ended_at, winner_id
     FROM pictionary_rounds WHERE id = $1`, [id]);
    return result.rows[0];
}
export async function endRound(pool, id, winnerId) {
    // Conditional update: two simultaneous correct guesses must not both be
    // able to close the round; the first one wins and the rest are no-ops.
    await pool.query(`UPDATE pictionary_rounds SET status = 'ended', ended_at = now(), winner_id = $2
      WHERE id = $1 AND status = 'drawing'`, [id, winnerId]);
}
export async function submitGuess(pool, input) {
    const result = await pool.query(`INSERT INTO pictionary_guesses (id, round_id, user_id, username, guess, correct)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, round_id, user_id, username, guess, correct, created_at`, [input.id, input.round_id, input.user_id, input.username, input.guess, input.correct]);
    return result.rows[0];
}
export async function getGuessesForRound(pool, roundId) {
    const result = await pool.query(`SELECT id, round_id, user_id, username, guess, correct, created_at
     FROM pictionary_guesses WHERE round_id = $1
     ORDER BY created_at ASC`, [roundId]);
    return result.rows;
}
export async function getRandomWord(pool) {
    const result = await pool.query(`SELECT id, word, difficulty, category FROM pictionary_words
     ORDER BY random() LIMIT 1`);
    return result.rows[0];
}
