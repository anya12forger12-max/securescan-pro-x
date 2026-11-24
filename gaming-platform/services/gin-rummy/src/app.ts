import { randomUUID } from "node:crypto";
import { z } from "zod";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { getPool, closePool, createGame, getGame, getGameForUpdate, joinGameWithSessionSeat, isSessionParticipant, isSessionOfType, recordOutcome, setGameStatus, updateGameState, } from "./db.js";
import type { GameRow } from "./db.js";
import type { GinRummyEnv } from "./env.js";

type RequestWithRouterPath = FastifyRequest & { routerPath?: string };

interface JwtPayload {
  userId: string;
}

interface CardParts {
  rank: string;
  suit: string;
}

/**
 * The request's route path.
 *
 * Fastify 4 exposes it as `req.routerPath`; Fastify 5 removed that and
 * answers `req.routeOptions.url`. The service is on one of them depending
 * on which copy it was built from, and a probe that silently stopped
 * matching is how a container ends up "unhealthy" while serving perfectly.
 */
function requestPath(req: FastifyRequest): string {
  return String(req.routeOptions?.url ?? (req as RequestWithRouterPath).routerPath ?? req.url ?? "");
}

function headerBearer(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : null;
}

/**
 * Never return both hands to one caller. A player may see only their own cards;
 * spectators see neither. The internal move code still uses the full row.
 */
type PublicGame = Omit<GameRow, "player1_hand" | "player2_hand" | "stock_pile"> & {
  player1_hand?: string[];
  player2_hand?: string[];
};

function publicGame(game: GameRow, userId?: string): PublicGame {
  const safe: PublicGame = { ...game };
  delete (safe as { stock_pile?: string[] }).stock_pile;
  delete safe.player1_hand;
  delete safe.player2_hand;
  const isPlayer = userId === game.player1_id || userId === game.player2_id;
  if (isPlayer) {
    if (userId === game.player1_id) safe.player1_hand = game.player1_hand;
    if (userId === game.player2_id) safe.player2_hand = game.player2_hand;
  }
  return safe;
}

const CreateGameSchema = z.object({
  session_id: z.string().uuid(),
});

const JoinGameSchema = z.object({
  id: z.string().uuid(),
});

const CARD_PATTERN = /^(10|[2-9JQKA])[SHDC]$/;

const DrawSchema = z.object({
  source: z.enum(["stock", "discard"]),
});

const DiscardSchema = z.object({
  card: z.string().regex(CARD_PATTERN),
});

// Ace is low-only for runs: A-2-3 works, Q-K-A does not.
const RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function cardParts(card: string): CardParts | null {
  const match = CARD_PATTERN.exec(card);
  return match ? { rank: match[1], suit: match[2] } : null;
}

function isValidMeld(group: string[]): boolean {
  if (group.length < 3)
    return false;
  const parts = group.map(cardParts);
  if (parts.some((part) => part === null))
    return false;
  const ranks = parts.map((part) => part!.rank);
  // A set is any three or more cards of the same rank, suits ignored.
  if (ranks.every((rank) => rank === ranks[0]))
    return true;
  // Otherwise every card must share a suit and climb one rank at a time.
  if (new Set(parts.map((part) => part!.suit)).size !== 1)
    return false;
  // A run is a set of consecutive ranks; the client may list the cards in
  // any order, so sort before checking. Ace stays low-only (A,2,3 but not
  // Q,K,A) as documented above.
  const order = ranks.map((rank) => RANK_ORDER.indexOf(rank)).sort((a, b) => a - b);
  return order.every((rank, index) => index === 0 || rank === order[index - 1] + 1);
}

const MeldSchema = z.object({
  melds: z.array(z.array(z.string().regex(CARD_PATTERN))).min(1),
}).superRefine((value, ctx) => {
  value.melds.forEach((group, index) => {
    if (!isValidMeld(group)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["melds", index],
        message: `melds[${index}] must be a set (>=3 cards of the same rank) or a run (>=3 consecutive ranks of one suit, ace low)`,
      });
    }
  });
});

// A rejected move must not leave a transaction open, so every move route uses
// the same rollback-and-respond path.
async function rejectMove(client: PoolClient, reply: FastifyReply, code: number, error: string, message: unknown): Promise<FastifyReply> {
  await client.query("ROLLBACK");
  return reply.code(code).send({ error, message });
}

export async function buildGinRummyService(env: GinRummyEnv) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  await app.register(cors, { origin: env.CORS_ORIGIN.split(",") });
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: Math.floor(900) },
  });

  // Auth middleware
  app.addHook("onRequest", async (req, reply) => {
    // the probes are not player calls: a container that cannot be probed
    // cannot be reported ready
    if (requestPath(req) === "/health" || requestPath(req) === "/ready") return;
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
      }
      await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
  });

  // ---------- create game ----------
  app.post("/v1/gin-rummy/games", async (req, reply) => {
    const parsed = CreateGameSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded: JwtPayload = await app.jwt.verify(token);
    const pool = getPool(env.DATABASE_URL);
    // A game is stored against a session for leaderboard verification, so the
    // caller must actually hold a seat in that session. Without this check any
    // authenticated user could attach a game to somebody else's session.
    if (!(await isSessionParticipant(pool, parsed.data.session_id, decoded.userId))) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "join the session before creating a game" });
    }
    // The shared `game_sessions` table also backs Pictionary, Codenames, etc.
    // Binding a Gin Rummy game to one of those lets a later join inject a seat
    // into the other game's active lobby and steal its leaderboard points.
    if (!(await isSessionOfType(pool, parsed.data.session_id, "gin-rummy"))) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "session is not a gin-rummy session" });
    }
    const game = await createGame(pool, {
      id: randomUUID(),
      session_id: parsed.data.session_id,
      player1_id: decoded.userId,
    });
    return reply.code(201).send({ game: publicGame(game, decoded.userId) });
  });

  // ---------- get game ----------
  app.get("/v1/gin-rummy/games/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const token = headerBearer(req.headers.authorization);
    let viewerId: string | undefined;
    if (token) {
      try {
        viewerId = (await app.jwt.verify(token) as JwtPayload).userId;
      } catch {
        // An invalid token is handled by the global auth hook. Spectators with
        // no usable identity simply receive a game with both hands hidden.
      }
    }
    const pool = getPool(env.DATABASE_URL);
    const game = await getGame(pool, id);
    if (!game) {
      return reply.code(404).send({ error: "GAME_NOT_FOUND", message: "game not found" });
    }
    return reply.send({ game: publicGame(game, viewerId) });
  });

  // ---------- join game ----------
  app.post("/v1/gin-rummy/games/:id/join", async (req, reply) => {
    const parsed = JoinGameSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded: JwtPayload = await app.jwt.verify(token);
    const pool = getPool(env.DATABASE_URL);
    const game = await getGame(pool, parsed.data.id);
    if (!game) {
      return reply.code(404).send({ error: "GAME_NOT_FOUND", message: "game not found" });
    }
    if (game.status !== "waiting" || game.player2_id) {
      return reply.code(409).send({ error: "GAME_NOT_WAITING", message: "game is not waiting for players" });
    }
    if (game.player1_id === decoded.userId) {
      return reply.code(409).send({ error: "ALREADY_SEATED", message: "the host already occupies player one" });
    }
    const updated = await joinGameWithSessionSeat(pool, game, decoded.userId);
    if (!updated) {
      // Another join won the race between our read and the atomic claim.
      return reply.code(409).send({ error: "GAME_NOT_WAITING", message: "game is not waiting for players" });
    }
    return reply.send({ game: publicGame(updated, decoded.userId) });
  });

  // ---------- draw a card ----------
  app.post("/v1/gin-rummy/games/:id/draw", async (req, reply) => {
    const parsed = DrawSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const { id } = req.params as { id: string };
    const token = headerBearer(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    let decoded: JwtPayload;
    try {
      decoded = await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const client = await pool.connect();
    try {
      // Lock the game for the whole move: two simultaneous draws must not
      // read the same top of the stock pile.
      await client.query("BEGIN");
      const game = await getGameForUpdate(client, id);
      if (!game)
        return await rejectMove(client, reply, 404, "GAME_NOT_FOUND", "game not found");
      if (game.status !== "active" || !game.player2_id)
        return await rejectMove(client, reply, 409, "GAME_NOT_ACTIVE", "game is not active");
      if (game.current_turn !== decoded.userId)
        return await rejectMove(client, reply, 403, "NOT_YOUR_TURN", "it is not your turn");
      if (game.has_drawn)
        return await rejectMove(client, reply, 409, "MUST_DISCARD_FIRST", "discard before drawing again");
      const handKey = game.player1_id === decoded.userId ? "player1_hand" : "player2_hand";
      const hand = [...(game[handKey] ?? [])];
      const sourceKey = parsed.data.source === "stock" ? "stock_pile" : "discard_pile";
      const pile = [...(game[sourceKey] ?? [])];
      if (pile.length === 0)
        return await rejectMove(client, reply, 409, "EMPTY_PILE", `${parsed.data.source} pile is empty`);
      // Stock is dealt from the front; the discard pile is taken from the top.
      const card = parsed.data.source === "stock" ? pile.shift() : pile.pop();
      hand.push(card!);
      // has_drawn records the owed discard; it is cleared by /discard.
      const updated = await updateGameState(client, id, { [handKey]: hand, [sourceKey]: pile, has_drawn: true });
      await client.query("COMMIT");
      return reply.send({ game: publicGame(updated, decoded.userId), card });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ---------- discard a card ----------
  app.post("/v1/gin-rummy/games/:id/discard", async (req, reply) => {
    const parsed = DiscardSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const { id } = req.params as { id: string };
    const token = headerBearer(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    let decoded: JwtPayload;
    try {
      decoded = await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const game = await getGameForUpdate(client, id);
      if (!game)
        return await rejectMove(client, reply, 404, "GAME_NOT_FOUND", "game not found");
      if (game.status !== "active" || !game.player2_id)
        return await rejectMove(client, reply, 409, "GAME_NOT_ACTIVE", "game is not active");
      if (game.current_turn !== decoded.userId)
        return await rejectMove(client, reply, 403, "NOT_YOUR_TURN", "it is not your turn");
      if (!game.has_drawn)
        return await rejectMove(client, reply, 409, "MUST_DRAW_FIRST", "draw a card before discarding");
      const handKey = game.player1_id === decoded.userId ? "player1_hand" : "player2_hand";
      const hand = [...(game[handKey] ?? [])];
      const cardIndex = hand.indexOf(parsed.data.card);
      if (cardIndex === -1)
        return await rejectMove(client, reply, 409, "CARD_NOT_IN_HAND", "card is not in your hand");
      hand.splice(cardIndex, 1);
      const discardPile = [...(game.discard_pile ?? []), parsed.data.card];
      // A discard hands the turn to the only other player in the game.
      const nextTurn = game.current_turn === game.player1_id ? game.player2_id : game.player1_id;
      const updated = await updateGameState(client, id, {
        [handKey]: hand,
        discard_pile: discardPile,
        has_drawn: false,
        current_turn: nextTurn,
      });
      await client.query("COMMIT");
      return reply.send({ game: publicGame(updated, decoded.userId) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ---------- declare melds and win ----------
  app.post("/v1/gin-rummy/games/:id/meld", async (req, reply) => {
    const parsed = MeldSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
    }
    const { id } = req.params as { id: string };
    const token = headerBearer(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    let decoded: JwtPayload;
    try {
      decoded = await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const game = await getGameForUpdate(client, id);
      if (!game)
        return await rejectMove(client, reply, 404, "GAME_NOT_FOUND", "game not found");
      if (game.status !== "active" || !game.player2_id)
        return await rejectMove(client, reply, 409, "GAME_NOT_ACTIVE", "game is not active");
      if (game.current_turn !== decoded.userId)
        return await rejectMove(client, reply, 403, "NOT_YOUR_TURN", "it is not your turn");
      if (!game.has_drawn)
        return await rejectMove(client, reply, 409, "MUST_DRAW_FIRST", "draw a card before declaring a win");
      const hand = game.player1_id === decoded.userId ? game.player1_hand : game.player2_hand;
      const meldedCards = parsed.data.melds.flat();
      // A card can only be laid down once, even if it appears in two groups.
      if (new Set(meldedCards).size !== meldedCards.length) {
        return await rejectMove(client, reply, 400, "VALIDATION_ERROR", { formErrors: ["a card cannot be used in more than one meld"], fieldErrors: {} });
      }
      if (meldedCards.some((card) => !(hand ?? []).includes(card))) {
        return await rejectMove(client, reply, 409, "CARD_NOT_IN_HAND", "every melded card must be in your hand");
      }
      // A single 3-card meld is not a win. Require a complete hand of disjoint
      // melds so a player cannot end the game from the initial deal.
      const handCards = hand ?? [];
      // Compare the full multiset, not just cardinalities: a duplicate card
      // name must still be present in the hand it claims to come from.
      const remaining = [...handCards];
      for (const card of meldedCards) {
        const index = remaining.indexOf(card);
        if (index < 0) {
          return await rejectMove(client, reply, 409, "INCOMPLETE_HAND", "every card in your hand must belong to a meld");
        }
        remaining.splice(index, 1);
      }
      if (remaining.length > 0) {
        return await rejectMove(client, reply, 409, "INCOMPLETE_HAND", "every card in your hand must belong to a meld");
      }
      if (!(await setGameStatus(client, id, "ended", decoded.userId, "active")))
        return await rejectMove(client, reply, 409, "GAME_NOT_ACTIVE", "game is not active");
      // Only a hand-validated /meld win may count toward the leaderboard.
      await client.query(`UPDATE gin_rummy_games SET win_type = 'validated' WHERE id = $1`, [id]);
      await recordOutcome(client, id, "validated", "meld");
      const updated = await getGame(client, id);
      await client.query("COMMIT");
      return reply.send({ game: publicGame(updated, decoded.userId) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ---------- end game ----------
  app.post("/v1/gin-rummy/games/:id/end", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ winner_id: z.string().uuid().optional() }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.flatten() });
    }
    const token = headerBearer(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
    let decoded: JwtPayload;
    try {
      decoded = await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
    }
    const pool = getPool(env.DATABASE_URL);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the row: a /meld win that committed while this request was
      // waiting must not be overwritten by a stale concession read.
      const game = await getGameForUpdate(client, id);
      if (!game)
        return await rejectMove(client, reply, 404, "GAME_NOT_FOUND", "game not found");
      if (decoded.userId !== game.player1_id && decoded.userId !== game.player2_id)
        return await rejectMove(client, reply, 403, "FORBIDDEN", "only players may end a game");
      if (game.status !== "active" || !game.player2_id)
        return await rejectMove(client, reply, 409, "GAME_NOT_ACTIVE", "game is not active");
      // Ending is a concession, not a way to choose an arbitrary winner. A
      // validated win comes from /meld, which sets the winner from the hand.
      const winnerId = decoded.userId === game.player1_id ? game.player2_id : game.player1_id;
      if (body.data.winner_id && body.data.winner_id !== winnerId)
        return await rejectMove(client, reply, 409, "INVALID_WINNER", "winner_id may only name the opponent");
      if (!(await setGameStatus(client, id, "ended", winnerId, "active")))
        return await rejectMove(client, reply, 409, "GAME_NOT_ACTIVE", "game is not active");
      // Ending is a concession: the opponent wins the game but earns no
      // validated leaderboard score.
      await client.query(`UPDATE gin_rummy_games SET win_type = 'concession' WHERE id = $1`, [id]);
      await recordOutcome(client, id, "concession", "end");
      await client.query("COMMIT");
      return reply.send({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ---- health and readiness ----
  app.get("/health", async () => ({ status: "ok", service: "gin-rummy" }));
  app.get("/ready", async (_req, reply) => {
    try {
      const pool = getPool(env.DATABASE_URL);
      await pool.query("SELECT 1");
      return reply.code(200).send({ status: "ready" });
    } catch {
      return reply.code(503).send({ status: "not_ready", reason: "database unavailable" });
    }
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
