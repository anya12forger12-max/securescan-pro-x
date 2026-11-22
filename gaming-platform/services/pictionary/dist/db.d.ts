import type { Pool as PoolType } from "pg";
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
export declare function getPool(connectionString: string): PoolType;
export declare function closePool(): Promise<void>;
export declare function createRound(pool: PoolType, input: CreateRoundInput): Promise<PictionaryRound>;
export declare function getRound(pool: PoolType, id: string): Promise<PictionaryRound | undefined>;
export declare function endRound(pool: PoolType, id: string, winnerId: string): Promise<boolean>;
export declare function isSessionParticipant(pool: PoolType, sessionId: string, userId: string): Promise<boolean>;
export declare function submitGuess(pool: PoolType, input: SubmitGuessInput): Promise<PictionaryGuess | null>;
export declare function getGuessesForRound(pool: PoolType, roundId: string): Promise<PictionaryGuess[]>;
export declare function getRandomWord(pool: PoolType): Promise<PictionaryWord | undefined>;
//# sourceMappingURL=db.d.ts.map