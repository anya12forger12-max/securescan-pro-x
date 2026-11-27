import pg from "pg";
import type { Pool as PoolType } from "pg";
import { dbPoolOptions } from "@gp/config";

const { Pool } = pg;
const pools = new Map<string, PoolType>();

export interface GameSessionRow {
  id: string;
}

export interface LeaderboardEntry {
  id: string;
  user_id: string;
  username: string;
  game_type: string;
  score: number;
  created_at: string;
}

export interface LeaderboardEntryWithSession extends LeaderboardEntry {
  session_id: string;
}

export interface CreateLeaderboardEntryInput {
  user_id: string;
  username: string;
  game_type: string;
  score: number;
  session_id: string;
}

export interface VerifyGameResultInput {
  sessionId: string;
  userId: string;
  gameType: string;
}

export interface UserStats {
  user_id: string;
  username: string;
  total_games: number;
  total_score: number;
  best_score: number;
}

export function getPool(connectionString: string): PoolType {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool(dbPoolOptions(connectionString));
    pools.set(connectionString, pool);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

/**
 * Derive the score from authoritative game state instead of trusting the
 * client. Only a recorded win counts: previously every ended session paid 10
 * points, so a player could create and immediately end empty sessions to farm
 * the leaderboard without ever playing a game.
 */
export async function verifyGameResult(pool: PoolType, input: VerifyGameResultInput): Promise<number | null> {
  const result = await pool.query<{ score: number }>(`WITH seats AS (
       SELECT user_id,
              row_number() OVER (ORDER BY joined_at, user_id) AS seat
         FROM game_players WHERE session_id = $1
     ), scored AS (
     SELECT CASE
       -- gin_rummy_outcomes is the durable evidence written with the game's
       -- terminal transition. gin_rummy_games.win_type is cache-like and has
       -- been rewritten by backfills, so it must not decide points.
       WHEN s.game_type = 'gin-rummy' AND EXISTS (
         SELECT 1 FROM gin_rummy_games g
          JOIN gin_rummy_outcomes o ON o.game_id = g.id
          WHERE g.session_id = s.id AND g.winner_id = $2
            AND o.win_type = 'validated') THEN 100
       -- A concession (/end) and an unverifiable historical 'completed' win
       -- are still games the player finished, so score submission succeeds.
       -- Neither earns points: only the hand-checked /meld win above does, so
       -- colluding accounts cannot farm the board by forfeiting or by claiming
       -- an old result we can no longer validate.
       WHEN s.game_type = 'gin-rummy' AND EXISTS (
         SELECT 1 FROM gin_rummy_games g
          JOIN gin_rummy_outcomes o ON o.game_id = g.id
          WHERE g.session_id = s.id AND g.winner_id = $2
            AND o.win_type IN ('concession','completed')) THEN 0
       WHEN s.game_type = 'pictionary' AND EXISTS (
         SELECT 1 FROM pictionary_rounds r
          WHERE r.session_id = s.id AND r.winner_id = $2) THEN 100
       WHEN s.game_type = 'codenames' AND EXISTS (
         SELECT 1 FROM codenames_games c
          JOIN seats me ON me.user_id = $2
          WHERE c.session_id = s.id AND c.winner IS NOT NULL
            AND ((c.winner = 'red' AND me.seat % 2 = 1) OR
                 (c.winner = 'blue' AND me.seat % 2 = 0))) THEN 100
       -- Crash pays only for an actual cash-out at 2x or better inside this
       -- session. A losing bet, a 1.00x round or another session earns nothing.
       WHEN s.game_type = 'crash' AND EXISTS (
         SELECT 1 FROM crash_bets b
          WHERE b.session_id = s.id AND b.user_id = $2
            AND b.status = 'cashed_out' AND b.cashout_at >= 2) THEN 100
       ELSE NULL
     END AS score
     FROM game_sessions s
     JOIN seats ON seats.user_id = $2
    WHERE s.id = $1 AND s.status = 'ended' AND s.game_type = $3
    LIMIT 1
     )
     SELECT score FROM scored WHERE score IS NOT NULL`, [input.sessionId, input.userId, input.gameType]);
  if (!result.rowCount) return null;
  return Number(result.rows[0].score);
}

export async function createLeaderboardEntry(pool: PoolType, input: CreateLeaderboardEntryInput): Promise<LeaderboardEntryWithSession> {
  // A score is bound to one verified game session. Without this, a player
  // could submit unlimited inflated scores for the same completed session.
  const result = await pool.query<LeaderboardEntryWithSession>(`INSERT INTO leaderboard_entries (user_id, username, game_type, score, session_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, session_id) DO NOTHING
     RETURNING id, user_id, username, game_type, score, session_id, created_at`,
   [input.user_id, input.username, input.game_type, input.score, input.session_id]);
  if (result.rows[0]) return result.rows[0];
  // Idempotent replay: return the entry that was already recorded.
  const existing = await pool.query<LeaderboardEntryWithSession>(`SELECT id, user_id, username, game_type, score, session_id, created_at
      FROM leaderboard_entries WHERE user_id = $1 AND session_id = $2`, [input.user_id, input.session_id]);
  return existing.rows[0];
}

export async function getLeaderboard(pool: PoolType, gameType: string, limit = 50): Promise<LeaderboardEntry[]> {
  const result = await pool.query<LeaderboardEntry>(`SELECT id, user_id, username, game_type, score, created_at
     FROM leaderboard_entries
     WHERE game_type = $1
     ORDER BY score DESC, created_at ASC
     LIMIT $2`, [gameType, limit]);
  return result.rows;
}

export async function getUserBestScores(pool: PoolType, userId: string): Promise<LeaderboardEntry[]> {
  const result = await pool.query<LeaderboardEntry>(`SELECT DISTINCT ON (game_type) id, user_id, username, game_type, score, created_at
     FROM leaderboard_entries
     WHERE user_id = $1
     ORDER BY game_type, score DESC, created_at ASC`, [userId]);
  return result.rows;
}

export async function getUserStats(pool: PoolType, userId: string): Promise<UserStats | null> {
  // pg returns COUNT/SUM/MAX as strings; cast here so the API keeps its
  // declared numeric contract instead of leaking "3" to typed clients.
  const result = await pool.query<UserStats>(`SELECT user_id, username,
            COUNT(*)::int as total_games,
            COALESCE(SUM(score), 0)::int as total_score,
            COALESCE(MAX(score), 0)::int as best_score
     FROM leaderboard_entries
     WHERE user_id = $1
     GROUP BY user_id, username`, [userId]);
  return result.rows[0];
}
