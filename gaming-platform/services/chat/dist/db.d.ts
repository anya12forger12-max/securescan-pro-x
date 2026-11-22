import type { Pool as PoolType } from "pg";
export interface ChatMessage {
    id: string;
    room: string;
    user_id: string;
    username: string;
    content: string;
    created_at: Date;
}
export interface ChatRoom {
    id: string;
    name: string;
    created_at: Date;
}
export declare function getPool(connectionString: string): PoolType;
export declare function closePool(): Promise<void>;
export declare function createMessage(pool: PoolType, input: {
    id: string;
    room: string;
    user_id: string;
    username: string;
    content: string;
}): Promise<ChatMessage>;
export declare function listMessages(pool: PoolType, room: string, limit?: number): Promise<ChatMessage[]>;
export declare function createRoom(pool: PoolType, id: string, name: string): Promise<ChatRoom>;
export declare function listRooms(pool: PoolType): Promise<ChatRoom[]>;
//# sourceMappingURL=db.d.ts.map