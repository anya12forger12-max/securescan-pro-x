export interface User {
  id: string;
  username: string;
  email?: string;
  created_at?: string;
}

export interface AuthData {
  token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface WalletAccount {
  user_id: string;
  balance: string;
  updated_at: string | null;
}

export interface WalletTransaction {
  id: string;
  amount: string;
  type: string;
  reference: string;
  created_at: string;
}

export interface RealtimeEvent {
  seq: number;
  topic: string;
  payload: Record<string, unknown>;
  published_at: string;
}

export interface GameSession {
  id: string;
  game_type: string;
  host_id: string;
  status: string;
  created_at: string;
}

export interface GamePlayer {
  user_id: string;
  joined_at: string;
}

export interface CodenamesGame {
  id: string;
  session_id: string;
  status: "setup" | "active" | "ended";
  turn?: string;
  winner?: string | null;
  created_at?: string;
}

export interface GinRummyGame {
  id: string;
  session_id: string;
  status: string;
  player1_id: string;
  player2_id: string | null;
  turn_user_id?: string | null;
  winner_id?: string | null;
  hand?: string[];
  opponent_card_count?: number;
  stock_count?: number;
  discard?: string[];
  melds?: string[][];
}

export interface PictionaryRound {
  id: string;
  session_id: string;
  drawer_id: string;
  status: string;
  winner_id?: string | null;
  length?: number;
  masked_word?: string;
  guesses?: Array<{ user_id: string; guess: string; correct: boolean }>;
}

export interface ChatRoom {
  id: string;
  name: string;
  created_at?: string;
}

export interface ChatMessage {
  id: string;
  room?: string;
  room_name?: string;
  user_id?: string;
  username?: string;
  content: string;
  created_at: string;
}

export interface Tournament {
  id: string;
  gameType: string;
  title: string;
  maxPlayers: number;
  entryFee: string;
  prizePool: string;
  status: string;
  startsAt: string;
}

export interface Promotion {
  id: string;
  code: string;
  title: string;
  description: string;
  rewardAmount: string;
  claimed?: boolean;
  expiresAt?: string;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  score: number;
  game_type: string;
  rank?: number;
}

export interface AuditReport {
  valid: boolean;
  count: number;
  chain?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export type GameKind = "codenames" | "gin-rummy" | "pictionary";
