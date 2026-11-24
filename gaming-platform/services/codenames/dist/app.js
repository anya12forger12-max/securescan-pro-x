import { randomUUID } from "node:crypto";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { getPool, closePool, createGame, getGame, setGameStatus, submitClue, getCluesForGame, getActiveClue, submitGuess, listGuessesForGame, listRevealedWords, playerTeam, isTeamSpymaster, isSessionParticipant, isSessionOfType, activateSession } from "./db.js";
/**
 * The request's route path.
 *
 * Fastify 4 exposes it as `req.routerPath`; Fastify 5 removed that and
 * answers `req.routeOptions.url`. The service is on one of them depending
 * on which copy it was built from, and a probe that silently stopped
 * matching is how a container ends up "unhealthy" while serving perfectly.
 */
function requestPath(req) {
    return String(req.routeOptions?.url ?? req.routerPath ?? req.url ?? "");
}
function headerBearer(value) {
    return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : null;
}
const CreateGameSchema = z.object({
    session_id: z.string().uuid(),
});
const SubmitClueSchema = z.object({
    game_id: z.string().uuid(),
    word: z.string().min(1).max(32),
    number: z.coerce.number().int().min(1).max(100),
});
const SubmitGuessSchema = z.object({
    word: z.string().min(1).max(64),
    // `team` is deliberately not accepted from the client. The server derives it
    // from game.current_team so a player cannot guess on the opposing team.
});
export async function buildCodenamesService(env) {
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
        if (requestPath(req) === "/health" || requestPath(req) === "/ready")
            return;
        try {
            const token = req.headers.authorization?.replace("Bearer ", "");
            if (!token) {
                return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
            }
            await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
    });
    // ---------- create game ----------
    app.post("/v1/codenames/games", async (req, reply) => {
        const parsed = CreateGameSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        let decoded;
        try {
            decoded = await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
        const pool = getPool(env.DATABASE_URL);
        // Team assignment and score verification both derive seats from the
        // session, so only a seated player may create a game for it.
        if (!(await isSessionParticipant(pool, parsed.data.session_id, decoded.userId))) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "join the session before creating a game" });
        }
        if (!(await isSessionOfType(pool, parsed.data.session_id, "codenames"))) {
            return reply.code(409).send({ error: "CONFLICT", message: "session is not a codenames session" });
        }
        const game = await createGame(pool, {
            id: randomUUID(),
            session_id: parsed.data.session_id,
            host_id: decoded.userId,
        });
        // The host is not automatically a spymaster. The full board stays server
        // side and is only ever exposed through the reveal log.
        const { red_team_words, blue_team_words, neutral_words, assassin_word, ...safeGame } = game;
        return reply.code(201).send({ game: safeGame });
    });
    // ---------- get game ----------
    app.get("/v1/codenames/games/:id", async (req, reply) => {
        const { id } = req.params;
        const pool = getPool(env.DATABASE_URL);
        const game = await getGame(pool, id);
        if (!game) {
            return reply.code(404).send({ error: "GAME_NOT_FOUND", message: "game not found" });
        }
        const clues = await getCluesForGame(pool, id);
        const guesses = await listGuessesForGame(pool, id);
        const revealed = await listRevealedWords(pool, id);
        // The board is a secret: only the revealed words may be shared, and
        // even those come from the reveal log, never from the game row.
        const { red_team_words, blue_team_words, neutral_words, assassin_word, ...safeGame } = game;
        return reply.send({ game: safeGame, clues, guesses, revealed });
    });
    // ---------- submit guess ----------
    app.post("/v1/codenames/games/:id/guess", async (req, reply) => {
        const parsed = SubmitGuessSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        const { id: gameId } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        let decoded;
        try {
            decoded = await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
        const pool = getPool(env.DATABASE_URL);
        const game = await getGame(pool, gameId);
        if (!game) {
            return reply.code(404).send({ error: "GAME_NOT_FOUND", message: "game not found" });
        }
        if (game.status !== "active") {
            return reply.code(409).send({ error: "GAME_NOT_ACTIVE", message: "game is not active" });
        }
        if (!game.session_id) {
            return reply.code(409).send({ error: "NO_SESSION", message: "game is not bound to a session" });
        }
        const { word } = parsed.data;
        if (game.current_team !== "red" && game.current_team !== "blue") {
            return reply.code(409).send({ error: "INVALID_TURN", message: "game has no current team" });
        }
        const team = game.current_team;
        const playerSide = await playerTeam(pool, game.session_id, decoded.userId);
        if (playerSide !== team) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "it is not your team's turn to guess" });
        }
        // A guess without an active spymaster clue for this team is not a move.
        const activeClue = await getActiveClue(pool, gameId);
        if (!activeClue || activeClue.team !== team) {
            return reply.code(409).send({
                error: "NO_ACTIVE_CLUE",
                message: "the current team's spymaster must give a clue before guessing",
            });
        }
        const opposingTeam = team === "red" ? "blue" : "red";
        const ownWords = team === "red" ? game.red_team_words : game.blue_team_words;
        const otherWords = team === "red" ? game.blue_team_words : game.red_team_words;
        // Check the assassin first: if a word appears on two lists by mistake,
        // the instant losing outcome must win.
        let outcome;
        if (word === game.assassin_word) {
            outcome = "assassin";
        }
        else if ((ownWords ?? []).includes(word)) {
            outcome = "correct";
        }
        else if ((otherWords ?? []).includes(word)) {
            outcome = "wrong_team";
        }
        else if ((game.neutral_words ?? []).includes(word)) {
            outcome = "neutral";
        }
        else {
            outcome = "invalid_word";
        }
        const endsGame = outcome === "correct" || outcome === "assassin";
        const winner = endsGame ? (outcome === "assassin" ? opposingTeam : team) : null;
        const guess = await submitGuess(pool, {
            id: randomUUID(),
            game_id: gameId,
            user_id: decoded.userId,
            username: decoded.username ?? decoded.userId,
            word,
            team,
            outcome,
            winner,
            next_team: opposingTeam,
            clue_id: activeClue.id,
        });
        if (!guess) {
            return reply.code(409).send({
                error: "GAME_NOT_ACTIVE",
                message: "game is closed or this clue's guess allowance is exhausted",
            });
        }
        return reply.send({ guess, outcome, ...(winner ? { winner } : {}) });
    });
    // ---------- submit clue ----------
    app.post("/v1/codenames/games/:id/clue", async (req, reply) => {
        const parsed = SubmitClueSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        const { id: gameId } = req.params;
        // FIX: SubmitClueSchema still requires game_id in the body for backwards
        // compatibility, but the lookup uses :id from the URL. Reject mismatches
        // instead of silently writing a clue to a different game.
        if (parsed.data.game_id !== gameId) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: "game_id in body must match the game in the URL" });
        }
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        let decoded;
        try {
            decoded = await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
        const pool = getPool(env.DATABASE_URL);
        const game = await getGame(pool, gameId);
        if (!game) {
            return reply.code(404).send({ error: "GAME_NOT_FOUND", message: "game not found" });
        }
        if (game.status !== "active") {
            return reply.code(409).send({ error: "GAME_NOT_ACTIVE", message: "game is not active" });
        }
        if (!game.session_id) {
            return reply.code(409).send({ error: "NO_SESSION", message: "game is not bound to a session" });
        }
        if (game.current_team !== "red" && game.current_team !== "blue") {
            return reply.code(409).send({ error: "INVALID_TURN", message: "game has no current team" });
        }
        const team = game.current_team;
        if (!(await isTeamSpymaster(pool, game.session_id, decoded.userId, team))) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "only the current team's spymaster may give a clue" });
        }
        const revealed = await listRevealedWords(pool, gameId);
        const ownWords = team === "red" ? game.red_team_words : game.blue_team_words;
        const remaining = (ownWords ?? []).filter((word) => !revealed.some((row) => row.word === word)).length;
        if (parsed.data.number > remaining) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: "clue exceeds the remaining words" });
        }
        const clue = await submitClue(pool, {
            id: randomUUID(),
            game_id: gameId,
            spymaster_id: decoded.userId,
            word: parsed.data.word,
            number: parsed.data.number,
            team,
        });
        return reply.send({ clue });
    });
    // ---------- set game status ----------
    app.post("/v1/codenames/games/:id/status", async (req, reply) => {
        const { id } = req.params;
        const body = z.object({ status: z.enum(["setup", "active", "ended"]) }).safeParse(req.body);
        if (!body.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: body.error.flatten() });
        }
        const token = headerBearer(req.headers.authorization);
        if (!token)
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        let decoded;
        try {
            decoded = await app.jwt.verify(token);
        }
        catch {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "invalid or expired token" });
        }
        const pool = getPool(env.DATABASE_URL);
        const game = await getGame(pool, id);
        if (!game)
            return reply.code(404).send({ error: "GAME_NOT_FOUND", message: "game not found" });
        if (game.host_id !== decoded.userId)
            return reply.code(403).send({ error: "FORBIDDEN", message: "only the host may change game status" });
        const expected = body.data.status === "active"
            ? ["setup", "waiting"]
            : body.data.status === "ended"
                ? ["active"]
                : [];
        if (!expected.length || !(await setGameStatus(pool, id, body.data.status, expected)))
            return reply.code(409).send({ error: "INVALID_TRANSITION", message: `cannot move from ${game.status} to ${body.data.status}` });
        // The game only becomes playable here; the session stays joinable during
        // setup so teams can be assembled, then closes when play starts.
        if (body.data.status === "active" && game.session_id)
            await activateSession(pool, game.session_id, "codenames");
        return reply.send({ ok: true });
    });
    // ---- health and readiness ----
    app.get("/health", async () => ({ status: "ok", service: "codenames" }));
    app.get("/ready", async (_req, reply) => {
        try {
            const pool = getPool(env.DATABASE_URL);
            await pool.query("SELECT 1");
            return reply.code(200).send({ status: "ready" });
        }
        catch {
            return reply.code(503).send({ status: "not_ready", reason: "database unavailable" });
        }
    });
    app.addHook("onClose", async () => {
        await closePool();
    });
    return app;
}
