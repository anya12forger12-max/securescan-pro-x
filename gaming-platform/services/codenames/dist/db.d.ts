import type { Pool as PoolType, PoolClient } from "pg";
type Queryable = PoolType | PoolClient;
export type Team = "red" | "blue";
export type GameStatus = "setup" | "active" | "ended";
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
export declare function setGameStatus(pool: Queryable, id: string, status: GameStatus): Promise<void>;
export declare function submitClue(pool: PoolType, input: {
    id: string;
    game_id: string;
    spymaster_id: string;
    word: string;
    number: number;
}): Promise<ClueRow>;
export declare function getCluesForGame(pool: PoolType, gameId: string): Promise<ClueRow[]>;
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
}): Promise<GuessRow>;
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