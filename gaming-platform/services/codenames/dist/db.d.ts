import type { Pool as PoolType, PoolClient } from "pg";
type Queryable = PoolType | PoolClient;
export type Team = "red" | "blue";
export type GameStatus = "waiting" | "setup" | "active" | "ended";
export type GuessOutcome = "correct" | "wrong_team" | "neutral" | "assassin" | "invalid_word";
export interface GameRow {
    id: string;
    session_id: string | null;
    host_id: string;
    red_team_words: string[];
    blue_team_words: string[];
    neutral_words: string[];
    assassin_word: string;
    status: GameStatus;
    current_team: Team;
    winner: Team | null;
    created_at: Date;
    ended_at: Date | null;
}
export interface ClueRow {
    id: string;
    game_id: string;
    spymaster_id: string;
    word: string;
    number: number;
    team: Team | null;
    created_at: Date;
}
export interface GuessRow {
    id: string;
    game_id: string;
    user_id: string;
    username: string;
    word: string;
    team: Team;
    outcome: GuessOutcome;
    clue_id: string | null;
    created_at: Date;
}
export interface RevealedRow {
    game_id: string;
    word: string;
    team: Team | "assassin";
    revealed_by: string;
    revealed_at: Date;
}
export declare function getPool(connectionString: string): PoolType;
export declare function closePool(): Promise<void>;
export declare function createGame(pool: PoolType, input: {
    id: string;
    session_id: string;
    host_id: string;
}): Promise<GameRow>;
export declare function getGame(pool: Queryable, id: string): Promise<GameRow | undefined>;
/**
 * Codenames has no persisted team column. Use session join order as the
 * house-rule assignment: first/third/... seat is red, second/fourth/... blue.
 * This makes the server, not the client, authoritative for a player's team.
 */
export declare function playerTeam(pool: Queryable, sessionId: string, userId: string): Promise<Team | null>;
/** The first seat of each team is that team's spymaster. */
export declare function isTeamSpymaster(pool: Queryable, sessionId: string, userId: string, team: Team): Promise<boolean>;
/** Conditional status write. The route validates the transition, but only the
 * WHERE clause makes it atomic: a delayed request cannot reopen a game that
 * another request already moved on. */
export declare function isSessionParticipant(pool: Queryable, sessionId: string, userId: string): Promise<boolean>;
/** Starting a game is the moment play begins: close the session's join window
 * so a late seat cannot change team assignment or leaderboard eligibility. */
export declare function activateSession(pool: Queryable, sessionId: string): Promise<void>;
export declare function setGameStatus(pool: Queryable, id: string, status: GameStatus, expectedStatus?: GameStatus | GameStatus[]): Promise<boolean>;
export declare function submitClue(pool: PoolType, input: {
    id: string;
    game_id: string;
    spymaster_id: string;
    word: string;
    number: number;
    team: Team;
}): Promise<ClueRow>;
export declare function getCluesForGame(pool: PoolType, gameId: string): Promise<ClueRow[]>;
/** The active guessing turn is only valid when the most recent clue belongs to
 * the team whose turn it is. Historical rows with a NULL team predate the
 * team-scoped clue migration and are deliberately treated as no clue. */
export declare function getActiveClue(pool: Queryable, gameId: string): Promise<ClueRow | null>;
export declare function submitGuess(pool: PoolType, input: {
    id: string;
    game_id: string;
    user_id: string;
    username: string;
    word: string;
    team: Team;
    outcome: GuessOutcome;
    winner: Team | null;
    next_team: Team;
    clue_id: string | null;
}): Promise<GuessRow | null>;
export declare function listGuessesForGame(pool: PoolType, gameId: string): Promise<GuessRow[]>;
export declare function listRevealedWords(pool: PoolType, gameId: string): Promise<RevealedRow[]>;
export declare function revealWord(pool: Queryable, input: {
    game_id: string;
    word: string;
    team: Team | "assassin";
    revealed_by: string;
}): Promise<RevealedRow | null>;
export declare function setCurrentTeam(pool: Queryable, id: string, team: Team): Promise<void>;
export declare function setGameWinner(pool: Queryable, id: string, winner: Team | null): Promise<void>;
export {};
//# sourceMappingURL=db.d.ts.map