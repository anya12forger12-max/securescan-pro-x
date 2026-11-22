import type { Pool as PoolType } from "pg";
import type { PoolClient } from "pg";
type Queryable = PoolType | PoolClient;
export interface GameRow {
    id: string;
    session_id: string;
    player1_id: string;
    player2_id: string | null;
    player1_hand: string[];
    player2_hand: string[];
    discard_pile: string[];
    stock_pile: string[];
    status: string;
    current_turn: string | null;
    winner_id: string | null;
    has_drawn: boolean;
    created_at: Date;
    ended_at: Date | null;
}
export interface CreateGameInput {
    id: string;
    session_id: string;
    player1_id: string;
}
export interface GameStatePatch {
    player1_hand?: string[];
    player2_hand?: string[];
    discard_pile?: string[];
    stock_pile?: string[];
    player2_id?: string | null;
    status?: string;
    current_turn?: string | null;
    winner_id?: string | null;
    has_drawn?: boolean;
}
export declare function getPool(connectionString: string): PoolType;
export declare function closePool(): Promise<void>;
export declare function createGame(pool: Queryable, input: CreateGameInput): Promise<GameRow>;
export declare function getGame(pool: Queryable, id: string): Promise<GameRow>;
export declare function getGameForUpdate(pool: Queryable, id: string): Promise<GameRow>;
export declare function joinGame(pool: Queryable, id: string, player2_id: string): Promise<GameRow | null>;
export declare function setGameStatus(pool: Queryable, id: string, status: string, winnerId: string | null): Promise<void>;
export declare function updateGameState(pool: Queryable, id: string, patch: GameStatePatch): Promise<GameRow>;
export declare function setHasDrawn(pool: Queryable, id: string, value: boolean): Promise<GameRow>;
export {};
//# sourceMappingURL=db.d.ts.map