import pg from "pg";
import type { Pool as PoolType } from "pg";
import { dbPoolOptions } from "@gp/config";

const { Pool } = pg;
const pools = new Map<string, PoolType>();

export interface ChatMessage {
  id: string;
  room: string;
  user_id: string;
  username: string;
  content: string;
  created_at: Date;
}

export interface ChatRoom {
  id: string;
  name: string;
  created_at: Date;
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

export async function createMessage(
  pool: PoolType,
  input: { id: string; room: string; user_id: string; username: string; content: string },
): Promise<ChatMessage> {
  const result = await pool.query<ChatMessage>(`INSERT INTO chat_messages (id, room, user_id, username, content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, room, user_id, username, content, created_at`, [input.id, input.room, input.user_id, input.username, input.content]);
  return result.rows[0]!;
}

export async function listMessages(pool: PoolType, room: string, limit = 50): Promise<ChatMessage[]> {
  const result = await pool.query<ChatMessage>(`SELECT id, room, user_id, username, content, created_at
     FROM chat_messages
     WHERE room = $1
     ORDER BY created_at DESC
     LIMIT $2`, [room, limit]);
  return result.rows;
}

export async function createRoom(pool: PoolType, id: string, name: string): Promise<ChatRoom> {
  const result = await pool.query<ChatRoom>(`INSERT INTO chat_rooms (id, name)
     VALUES ($1, $2)
     RETURNING id, name, created_at`, [id, name]);
  return result.rows[0]!;
}

export async function listRooms(pool: PoolType): Promise<ChatRoom[]> {
  const result = await pool.query<ChatRoom>(`SELECT id, name, created_at FROM chat_rooms ORDER BY created_at DESC`);
  return result.rows;
}
