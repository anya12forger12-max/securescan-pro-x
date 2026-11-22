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
export async function createMessage(pool, input) {
    const result = await pool.query(`INSERT INTO chat_messages (id, room, user_id, username, content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, room, user_id, username, content, created_at`, [input.id, input.room, input.user_id, input.username, input.content]);
    return result.rows[0];
}
export async function listMessages(pool, room, limit = 50) {
    const result = await pool.query(`SELECT id, room, user_id, username, content, created_at
     FROM chat_messages
     WHERE room = $1
     ORDER BY created_at DESC
     LIMIT $2`, [room, limit]);
    return result.rows;
}
export async function createRoom(pool, id, name) {
    const result = await pool.query(`INSERT INTO chat_rooms (id, name)
     VALUES ($1, $2)
     RETURNING id, name, created_at`, [id, name]);
    return result.rows[0];
}
export async function listRooms(pool) {
    const result = await pool.query(`SELECT id, name, created_at FROM chat_rooms ORDER BY created_at DESC`);
    return result.rows;
}
