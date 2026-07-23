/**
 * SecureScan Pro X — Frontend Types
 *
 * Shared TypeScript type definitions for the frontend.
 * These mirror the backend API schemas.
 */

// ── Base Types ──────────────────────────────────────────────────

export interface IDMixin {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// ── Workspace ───────────────────────────────────────────────────

export interface Workspace extends IDMixin {
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface WorkspaceCreate {
  name: string;
  description?: string;
}

export interface WorkspaceUpdate {
  name?: string;
  description?: string;
  isActive?: boolean;
}

// ── Asset ───────────────────────────────────────────────────────

export type AssetType = "host" | "network" | "web" | "cloud" | "container";

export interface Asset extends IDMixin {
  workspaceId: string;
  name: string;
  assetType: AssetType;
  identifier: string;
  metadata: Record<string, unknown> | null;
}

export interface AssetCreate {
  name: string;
  assetType: AssetType;
  identifier: string;
  metadata?: Record<string, unknown>;
}

export interface AssetUpdate {
  name?: string;
  identifier?: string;
  metadata?: Record<string, unknown>;
}

// ── Assessment ──────────────────────────────────────────────────

export type AssessmentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Assessment extends IDMixin {
  workspaceId: string;
  name: string;
  description: string | null;
  status: AssessmentStatus;
  startedAt: string | null;
  completedAt: string | null;
  targetCount: number;
  findingCount: number;
}

export interface AssessmentCreate {
  name: string;
  description?: string;
  assetIds?: string[];
}

export interface AssessmentUpdate {
  name?: string;
  description?: string;
}

// ── Finding ─────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "open" | "confirmed" | "fixed" | "false_positive";

export interface Finding extends IDMixin {
  assessmentId: string;
  assetId: string | null;
  title: string;
  description: string | null;
  severity: Severity;
  category: string | null;
  recommendation: string | null;
  evidence: string | null;
  cvssScore: number | null;
  cweIds: string[] | null;
  status: FindingStatus;
}

export interface FindingCreate {
  title: string;
  description?: string;
  severity: Severity;
  category?: string;
  recommendation?: string;
  evidence?: string;
  cvssScore?: number;
  cweIds?: string[];
}

export interface FindingUpdate {
  status?: FindingStatus;
  recommendation?: string;
}

// ── Health ──────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  database?: string;
  uptime?: number;
}

// ── Error ───────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  detail?: string;
  code?: string;
}

// ── Theme ───────────────────────────────────────────────────────

export type ThemeName = "light" | "dark" | "high-contrast" | "colorblind" | "minimal" | "professional";

// ── Plugin ──────────────────────────────────────────────────────

export type PluginType = "check" | "report" | "knowledge" | "integration" | "ui";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  pluginType: PluginType;
  permissions: string[];
  targetTypes: string[];
  minSecurescanVersion: string;
  status: string;
}
