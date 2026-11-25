import type { Pool as PoolType } from "pg";
export interface GameSession {
    id: string;
    game_type: string;
    status: string;
    host_id: string;
    created_at: Date;
    ended_at: Date | null;
}
export interface GamePlayer {
    id: string;
    session_id: string;
    user_id: string;
    joined_at: Date;
}
export interface CreateSessionInput {
    id: string;
    game_type: string;
    host_id: string;
}
export declare function getPool(connectionString: string): PoolType;
export declare function closePool(): Promise<void>;
export declare function createSession(pool: PoolType, input: CreateSessionInput): Promise<GameSession>;
export declare function getSession(pool: PoolType, id: string): Promise<GameSession | undefined>;
export declare function endSession(pool: PoolType, id: string): Promise<boolean>;
export declare function joinSession(pool: PoolType, sessionId: string, userId: string): Promise<GamePlayer | null>;
export declare function listSessionPlayers(pool: PoolType, sessionId: string): Promise<GamePlayer[]>;
/** The host joins on creation, so this covers hosts and invited players. */
export declare function isSessionParticipant(pool: PoolType, sessionId: string, userId: string): Promise<boolean>;
//# sourceMappingURL=db.d.ts.map