import { randomUUID } from "node:crypto";
import { z } from "zod";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { getPool, closePool, createRound, getRound, endRound, submitGuess, MAX_WRONG_GUESSES, getGuessesForRound, getRandomWord, isSessionParticipant, } from "./db.js";
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
const CreateRoundSchema = z.object({
    session_id: z.string().uuid(),
});
const SubmitGuessSchema = z.object({
    round_id: z.string().uuid(),
    guess: z.string().min(1).max(100),
});
export async function buildPictionaryService(env) {
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
    // ---------- create round ----------
    app.post("/v1/pictionary/rounds", async (req, reply) => {
        const parsed = CreateRoundSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        const decoded = await app.jwt.verify(token);
        const pool = getPool(env.DATABASE_URL);
        if (!(await isSessionParticipant(pool, parsed.data.session_id, decoded.userId))) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "join the session before creating a round" });
        }
        const word = await getRandomWord(pool);
        if (!word?.word) {
            return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "no words available" });
        }
        const round = await createRound(pool, {
            id: randomUUID(),
            session_id: parsed.data.session_id,
            word: word.word,
            drawer_id: decoded.userId,
        });
        return reply.code(201).send({ round, word: word.word });
    });
    // ---------- get round ----------
    app.get("/v1/pictionary/rounds/:id", async (req, reply) => {
        const { id } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const decoded = await app.jwt.verify(authHeader.replace("Bearer ", ""));
        const pool = getPool(env.DATABASE_URL);
        const round = await getRound(pool, id);
        if (!round) {
            return reply.code(404).send({ error: "ROUND_NOT_FOUND", message: "round not found" });
        }
        if (!(await isSessionParticipant(pool, round.session_id, decoded.userId))) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "only session players may view this round" });
        }
        const guesses = await getGuessesForRound(pool, id);
        // Correct guesses are stored verbatim. While the round is still being
        // drawn, returning another player's text would reveal the secret word to
        // anyone who learns the round UUID. Only the guesser sees their own text;
        // once the round ends the word is public and the full log is safe.
        const safeGuesses = guesses.map((guess) => {
            if (round.status === "ended" || guess.user_id === decoded.userId)
                return guess;
            const { guess: _hidden, ...safeGuess } = guess;
            return safeGuess;
        });
        const { word: _word, ...safeRound } = round;
        return reply.send({ round: safeRound, guesses: safeGuesses });
    });
    // ---------- submit guess ----------
    app.post("/v1/pictionary/rounds/:id/guess", async (req, reply) => {
        const parsed = SubmitGuessSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "VALIDATION_ERROR", message: parsed.error.flatten() });
        }
        const { id: roundId } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return reply.code(401).send({ error: "UNAUTHORIZED", message: "missing bearer token" });
        }
        const token = authHeader.replace("Bearer ", "");
        const decoded = await app.jwt.verify(token);
        const pool = getPool(env.DATABASE_URL);
        const round = await getRound(pool, roundId);
        if (!round) {
            return reply.code(404).send({ error: "ROUND_NOT_FOUND", message: "round not found" });
        }
        if (round.status !== "drawing") {
            return reply.code(409).send({ error: "ROUND_NOT_DRAWING", message: "round is not in drawing state" });
        }
        // The drawer already knows the word; letting them submit it would let
        // them end the round and claim the win without any guesswork.
        if (round.drawer_id === decoded.userId) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "the drawer may not guess" });
        }
        if (!(await isSessionParticipant(pool, round.session_id, decoded.userId))) {
            return reply.code(403).send({ error: "FORBIDDEN", message: "join the session before guessing" });
        }
        const correct = parsed.data.guess.toLowerCase() === round.word.toLowerCase();
        const guess = await submitGuess(pool, {
            id: randomUUID(),
            round_id: roundId,
            user_id: decoded.userId,
            username: decoded.username,
            guess: parsed.data.guess,
            correct,
        });
        if (!guess) {
            // submitGuess also refuses a player who has spent the wrong-guess
            // allowance. Distinguish it from a closed round before answering so the
            // client gets an actionable error instead of a misleading 409.
            const current = await getRound(pool, roundId);
            if (current?.status === "drawing") {
                return reply.code(429).send({
                    error: "GUESS_LIMIT_REACHED",
                    message: `no more than ${MAX_WRONG_GUESSES} incorrect guesses per player in one round`,
                });
            }
            return reply.code(409).send({ error: "ROUND_NOT_DRAWING", message: "round closed before the guess was recorded" });
        }
        // Keep the recorded answer and the round outcome separate. A losing racer
        // still guessed correctly; only the caller that atomically closes the
        // round wins, and only the winner is shown the word.
        const won = correct && await endRound(pool, roundId, decoded.userId);
        return reply.send({ guess, correctGuess: correct, won, ...(won ? { word: round.word } : {}) });
    });
    // ---- health and readiness ----
    app.get("/health", async () => ({ status: "ok", service: "pictionary" }));
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
