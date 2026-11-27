export type Phase = "WAITING" | "BETTING" | "FLYING" | "CRASHED" | "SETTLING";

export interface FairnessResult {
  valid: boolean;
  reason?: string;
  seedHash: string;
  crashPoint: number;
  hashMatches: boolean | null;
  pointMatches: boolean | null;
  algorithm: string;
}

export interface BetValidation {
  panel: number;
  amount: number;
  autoCashout: number | null;
}

export const PROTOCOL_VERSION: number;
export const FAIRNESS_ALGORITHM: string;
export const CLIENT_SEED_ALGORITHM: string;
export const PHASES: readonly Phase[];
export const SERVER_MESSAGES: readonly string[];
export const CLIENT_MESSAGES: readonly string[];
export const ERROR_CODES: Readonly<Record<string, number>>;

export function canTransition(from: Phase, to: Phase): boolean;
export function assertTransition(from: Phase, to: Phase): true;
export function commitment(serverSeed: string): string;
export function crashPoint(serverSeed: string, clientSeed?: string, edge?: number): number;
export function hmacUnit(serverSeed: string, roundId: string): number;
export function pointFromUnit(unit: number, houseEdge?: number, maxMultiplier?: number): number;
export function crashPointFromRound(serverSeed: string, roundId: string, houseEdge?: number, maxMultiplier?: number): number;
export function verifyRoundFairness(input: {
  serverSeed: string;
  roundId: string;
  seedHash?: string | null;
  crashPoint?: number | string | null;
  houseEdge?: number;
  maxMultiplier?: number;
}): FairnessResult;
export function epochMs(value: unknown): number | null;
export function sanitizeSnapshot(frame: Record<string, unknown>): Record<string, unknown>;
export function verifyFairness(input: {
  serverSeed: string;
  clientSeed?: string;
  seedHash?: string | null;
  crashPoint?: number | string | null;
  edge?: number;
}): FairnessResult;
export function multiplierAt(elapsedMs: number, doublingSeconds?: number): number;
export function durationForPoint(point: number, doublingSeconds?: number): number;
export function phaseForRound(round: Record<string, unknown> | null | undefined, now?: number, bettingWindowMs?: number): Phase;
export function normalisePanel(panel: unknown): number;
export function moneyString(value: unknown): string;
export function maskPlayer(name: unknown): string;
export function buildSnapshot(input: {
  round?: Record<string, unknown> | null;
  balance?: { amount: unknown; currency?: string } | null;
  myBets?: Array<Record<string, unknown>>;
  history?: Array<unknown>;
  limits?: { minBet?: unknown; maxBet?: unknown; maxWin?: unknown };
  serverTime?: number;
  bettingWindowMs?: number;
}): Record<string, unknown>;
export function buildFeed(events: Array<Record<string, unknown>>): Record<string, unknown>;
