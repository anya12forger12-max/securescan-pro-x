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

/** Unified Aviator/crash game. Money fields stay strings, like the wallet. */
export interface CrashRound {
  id: string;
  status: "betting" | "running" | "finished" | "cancelled";
  seedHash: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt?: string | null;
  crashPoint?: number | null;
  multiplier?: number | null;
  proof?: { valid: boolean } | null;
}

export interface CrashBet {
  id: string;
  round_id: string;
  amount: string;
  auto_cashout: string | null;
  cashout_at: string | null;
  payout: string | null;
  status: "active" | "cashed_out" | "lost" | "cancelled" | "refunded";
  created_at: string;
  settled_at?: string | null;
}

export interface CrashState {
  round: CrashRound | null;
  myBet: CrashBet | null;
  history: CrashRound[];
}

export interface StrategyLabResult {
  strategy: string;
  finalBankroll: number;
  profit: number;
  maxDrawdown: number;
  busted: boolean;
}

export interface StrategyLabReport {
  seed: string;
  rounds: number;
  stake: number;
  target: number;
  paperOnly: boolean;
  note: string;
  results: StrategyLabResult[];
}

export type GameKind = "codenames" | "gin-rummy" | "pictionary" | "crash";
