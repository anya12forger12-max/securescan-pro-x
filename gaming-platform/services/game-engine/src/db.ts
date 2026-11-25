import pg from "pg";
import type { Pool as PoolType } from "pg";
import { dbPoolOptions } from "@gp/config";

const { Pool } = pg;
const pools = new Map<string, PoolType>();

export interface GameSession {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  created_at: Date;
  ended_at: Date | null;
}

export interface GamePlayer {
  id: string;
  session_id: string;
  user_id: string;
  joined_at: Date;
}

export interface CreateSessionInput {
  id: string;
  game_type: string;
  host_id: string;
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

export async function createSession(pool: PoolType, input: CreateSessionInput): Promise<GameSession> {
  // Insert the session and the host seat in one statement. A failure between
  // two separate inserts used to leave a hostless session that no participant
  // could see and whose id was never returned to the client.
  const result = await pool.query<GameSession>(`WITH inserted AS (
       INSERT INTO game_sessions (id, game_type, host_id)
       VALUES ($1, $2, $3)
       RETURNING id, game_type, status, host_id, created_at, ended_at
     ), host AS (
       INSERT INTO game_players (session_id, user_id)
       SELECT id, host_id FROM inserted
       RETURNING session_id
     )
     SELECT i.id, i.game_type, i.status, i.host_id, i.created_at, i.ended_at
       FROM inserted i
       JOIN host h ON h.session_id = i.id`, [input.id, input.game_type, input.host_id]);
  return result.rows[0]!;
}

export async function getSession(pool: PoolType, id: string): Promise<GameSession | undefined> {
  const result = await pool.query<GameSession>(`SELECT id, game_type, status, host_id, created_at, ended_at
     FROM game_sessions WHERE id = $1`, [id]);
  return result.rows[0];
}

export async function endSession(pool: PoolType, id: string): Promise<boolean> {
  // Conditional so a late duplicate end request cannot move ended_at.
  const result = await pool.query(`UPDATE game_sessions SET status = 'ended', ended_at = now()
     WHERE id = $1 AND status <> 'ended'`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function joinSession(pool: PoolType, sessionId: string, userId: string): Promise<GamePlayer | null> {
  // The session state check and the insert are one statement. The unique
  // (session_id, user_id) constraint remains the duplicate-join guard.
  const result = await pool.query<GamePlayer>(`INSERT INTO game_players (session_id, user_id)
     SELECT $1, $2
      WHERE EXISTS (SELECT 1 FROM game_sessions WHERE id = $1 AND status = 'waiting')
     ON CONFLICT (session_id, user_id) DO NOTHING
     RETURNING id, session_id, user_id, joined_at`, [sessionId, userId]);
  return result.rows[0] ?? null;
}

export async function listSessionPlayers(pool: PoolType, sessionId: string): Promise<GamePlayer[]> {
  const result = await pool.query<GamePlayer>(`SELECT id, session_id, user_id, joined_at FROM game_players WHERE session_id = $1 ORDER BY joined_at ASC`, [sessionId]);
  return result.rows;
}

/** The host joins on creation, so this covers hosts and invited players. */
export async function isSessionParticipant(pool: PoolType, sessionId: string, userId: string): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM game_players WHERE session_id = $1 AND user_id = $2) AS present`,
    [sessionId, userId],
  );
  return result.rows[0]?.present === true;
}
