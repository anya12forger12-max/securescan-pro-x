import type { Pool as PoolType } from "pg";
export interface GameSessionRow {
    id: string;
}
export interface LeaderboardEntry {
    id: string;
    user_id: string;
    username: string;
    game_type: string;
    score: number;
    created_at: string;
}
export interface LeaderboardEntryWithSession extends LeaderboardEntry {
    session_id: string;
}
export interface CreateLeaderboardEntryInput {
    user_id: string;
    username: string;
    game_type: string;
    score: number;
    session_id: string;
}
export interface VerifyGameResultInput {
    sessionId: string;
    userId: string;
    gameType: string;
}
export interface UserStats {
    user_id: string;
    username: string;
    total_games: number;
    total_score: number;
    best_score: number;
}
export declare function getPool(connectionString: string): PoolType;
export declare function closePool(): Promise<void>;
/**
 * Derive the score from authoritative game state instead of trusting the
 * client. Winners get 100, other participants in a completed session get 10.
 * SQL updates are what decide winners; the score submit endpoint only records
 * the result.
 */
export declare function verifyGameResult(pool: PoolType, input: VerifyGameResultInput): Promise<number | null>;
export declare function createLeaderboardEntry(pool: PoolType, input: CreateLeaderboardEntryInput): Promise<LeaderboardEntryWithSession>;
export declare function getLeaderboard(pool: PoolType, gameType: string, limit?: number): Promise<LeaderboardEntry[]>;
export declare function getUserBestScores(pool: PoolType, userId: string): Promise<LeaderboardEntry[]>;
export declare function getUserStats(pool: PoolType, userId: string): Promise<UserStats | null>;
//# sourceMappingURL=db.d.ts.map