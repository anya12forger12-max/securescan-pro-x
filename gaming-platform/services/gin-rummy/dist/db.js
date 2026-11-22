import pg from "pg";
import { randomInt } from "node:crypto";
const { Pool } = pg;
// A game needs a shuffled deck and a deal before either player can draw. The
// recovered service created rows with empty hands and piles, so every draw
// failed with EMPTY_PILE. Deal a standard gin hand here: 10 cards each, one
// upcard to start the discard pile, the remaining 31 as the stock.
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
function shuffledDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS)
            deck.push(`${rank}${suit}`);
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}
function deal() {
    const deck = shuffledDeck();
    return {
        player1: deck.slice(0, 10),
        player2: deck.slice(10, 20),
        upcard: deck[20],
        stock: deck.slice(21),
    };
}
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
// One column list for every read-back, including has_drawn, so callers always
// get the same game shape after a create, join or move.
const GAME_COLUMNS = `id, session_id, player1_id, player2_id, player1_hand, player2_hand, discard_pile, stock_pile, status, current_turn, winner_id, has_drawn, created_at, ended_at`;
// JSON columns need explicit serialisation: pg would otherwise turn a JS array
// into a Postgres array literal, which is not valid jsonb input.
const JSON_COLUMNS = new Set(["player1_hand", "player2_hand", "discard_pile", "stock_pile"]);
const WRITABLE_COLUMNS = new Set([...JSON_COLUMNS, "player2_id", "status", "current_turn", "winner_id", "has_drawn"]);
export async function createGame(pool, input) {
    // Seed the hands and piles at creation time. Without this every game
    // started with empty JSON columns and no legal move was possible.
    const hands = deal();
    const result = await pool.query(`INSERT INTO gin_rummy_games
     (id, session_id, player1_id, player1_hand, player2_hand, discard_pile, stock_pile)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${GAME_COLUMNS}`, [input.id, input.session_id, input.player1_id,
        JSON.stringify(hands.player1), JSON.stringify(hands.player2),
        JSON.stringify([hands.upcard]), JSON.stringify(hands.stock)]);
    return result.rows[0];
}
export async function getGame(pool, id) {
    const result = await pool.query(`SELECT ${GAME_COLUMNS}
     FROM gin_rummy_games WHERE id = $1`, [id]);
    return result.rows[0];
}
export async function getGameForUpdate(pool, id) {
    // Lock the game row for the lifetime of a move transaction; two draws or
    // discards racing on the same game must not read the same piles.
    const result = await pool.query(`SELECT ${GAME_COLUMNS}
     FROM gin_rummy_games WHERE id = $1 FOR UPDATE`, [id]);
    return result.rows[0];
}
export async function joinGame(pool, id, player2_id) {
    const result = await pool.query(`UPDATE gin_rummy_games SET player2_id = $2, status = 'active', current_turn = $2
     WHERE id = $1
     RETURNING ${GAME_COLUMNS}`, [id, player2_id]);
    return result.rows[0];
}
export async function setGameStatus(pool, id, status, winnerId) {
    await pool.query(`UPDATE gin_rummy_games SET status = $2, winner_id = $3, ended_at = now() WHERE id = $1`, [id, status, winnerId]);
}
export async function updateGameState(pool, id, patch) {
    const entries = Object.entries(patch);
    if (entries.length === 0)
        return getGame(pool, id);
    // Column names are restricted to a whitelist; every value stays bound as
    // a parameter. `pool` may be a checked-out client inside a transaction.
    for (const [column] of entries) {
        if (!WRITABLE_COLUMNS.has(column))
            throw new Error(`unknown gin_rummy_games column: ${column}`);
    }
    const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
    const values = entries.map(([column, value]) => JSON_COLUMNS.has(column) ? JSON.stringify(value) : value);
    const result = await pool.query(`UPDATE gin_rummy_games SET ${assignments.join(", ")} WHERE id = $1
     RETURNING ${GAME_COLUMNS}`, [id, ...values]);
    return result.rows[0];
}
export async function setHasDrawn(pool, id, value) {
    const result = await pool.query(`UPDATE gin_rummy_games SET has_drawn = $2 WHERE id = $1
     RETURNING ${GAME_COLUMNS}`, [id, value]);
    return result.rows[0];
}
