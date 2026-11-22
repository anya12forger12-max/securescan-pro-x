import pg from "pg";
import type { Pool as PoolType } from "pg";
import { dbPoolOptions } from "@gp/config";

const { Pool } = pg;
const pools = new Map<string, PoolType>();

export interface PictionaryRound {
  id: string;
  session_id: string;
  word: string;
  drawer_id: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  winner_id: string | null;
}

export interface PictionaryGuess {
  id: string;
  round_id: string;
  user_id: string;
  username: string;
  guess: string;
  correct: boolean;
  created_at: Date;
}

export interface PictionaryWord {
  id: string;
  word: string;
  difficulty: string;
  category: string;
}

export interface CreateRoundInput {
  id: string;
  session_id: string;
  word: string;
  drawer_id: string;
}

export interface SubmitGuessInput {
  id: string;
  round_id: string;
  user_id: string;
  username: string;
  guess: string;
  correct: boolean;
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

export async function createRound(pool: PoolType, input: CreateRoundInput): Promise<PictionaryRound> {
  // The app accepts guesses only while status === 'drawing'. Insert that
  // state explicitly instead of relying on a schema default that disagreed
  // with it ('active'), which made every guess fail with 409.
  const result = await pool.query<PictionaryRound>(`INSERT INTO pictionary_rounds (id, session_id, word, drawer_id, status)
     VALUES ($1, $2, $3, $4, 'drawing')
     RETURNING id, session_id, word, drawer_id, status, started_at, ended_at, winner_id`, [input.id, input.session_id, input.word, input.drawer_id]);
  return result.rows[0]!;
}

export async function getRound(pool: PoolType, id: string): Promise<PictionaryRound | undefined> {
  const result = await pool.query<PictionaryRound>(`SELECT id, session_id, word, drawer_id, status, started_at, ended_at, winner_id
     FROM pictionary_rounds WHERE id = $1`, [id]);
  return result.rows[0];
}

export async function endRound(pool: PoolType, id: string, winnerId: string): Promise<boolean> {
  // Conditional update: two simultaneous correct guesses must not both be
  // able to close the round; the first one wins and the rest are no-ops.
  const result = await pool.query(`UPDATE pictionary_rounds SET status = 'ended', ended_at = now(), winner_id = $2
      WHERE id = $1 AND status = 'drawing'`, [id, winnerId]);
  return (result.rowCount ?? 0) > 0;
}

export async function isSessionParticipant(pool: PoolType, sessionId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM game_sessions s
       JOIN game_players p ON p.session_id = s.id
      WHERE s.id = $1 AND s.status IN ('waiting', 'active') AND p.user_id = $2
      LIMIT 1`,
    [sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function submitGuess(pool: PoolType, input: SubmitGuessInput): Promise<PictionaryGuess | null> {
  // The status predicate is part of the INSERT so a guess can never be written
  // to a round that closed between the route's read and this write.
  const result = await pool.query<PictionaryGuess>(`INSERT INTO pictionary_guesses (id, round_id, user_id, username, guess, correct)
     SELECT $1, $2, $3, $4, $5, $6
      WHERE EXISTS (SELECT 1 FROM pictionary_rounds WHERE id = $2 AND status = 'drawing')
     RETURNING id, round_id, user_id, username, guess, correct, created_at`, [input.id, input.round_id, input.user_id, input.username, input.guess, input.correct]);
  return result.rows[0] ?? null;
}

export async function getGuessesForRound(pool: PoolType, roundId: string): Promise<PictionaryGuess[]> {
  const result = await pool.query<PictionaryGuess>(`SELECT id, round_id, user_id, username, guess, correct, created_at
     FROM pictionary_guesses WHERE round_id = $1
     ORDER BY created_at ASC`, [roundId]);
  return result.rows;
}

export async function getRandomWord(pool: PoolType): Promise<PictionaryWord | undefined> {
  const result = await pool.query<PictionaryWord>(`SELECT id, word, difficulty, category FROM pictionary_words
     ORDER BY random() LIMIT 1`);
  return result.rows[0];
}
