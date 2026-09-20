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
  | "draft"
  | "queued"
  | "preparing"
  | "running"
  | "collecting_evidence"
  | "normalizing_results"
  | "correlating"
  | "generating_report"
  | "completed"
  | "archived"
  | "paused"
  | "cancelled"
  | "failed";

export type AssessmentPriority = "low" | "normal" | "high" | "critical";

export interface Assessment extends IDMixin {
  workspaceId: string;
  name: string;
  description: string | null;
  status: AssessmentStatus;
  priority: AssessmentPriority;
  version: number;
  profileId: string | null;
  policyId: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  targetCount: number;
  findingCount: number;
  evidenceCount: number;
  progressPercent: number;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  tags: string[];
}

export interface AssessmentCreate {
  name: string;
  description?: string;
  priority?: AssessmentPriority;
  profileId?: string;
  policyId?: string;
  assetIds?: string[];
  tags?: string[];
}

export interface AssessmentUpdate {
  name?: string;
  description?: string;
  priority?: AssessmentPriority;
}

// ── Assessment Profile ───────────────────────────────────────────

export interface AssessmentProfile extends IDMixin {
  name: string;
  description: string | null;
  isBuiltin: boolean;
  timeoutSeconds: number;
  concurrencyLimit: number;
  evidenceCollection: boolean;
  reportingStyle: string;
}

// ── Assessment Policy ────────────────────────────────────────────

export interface AssessmentPolicy extends IDMixin {
  name: string;
  description: string | null;
  isBuiltin: boolean;
  maxRuntimeSeconds: number;
  maxMemoryMb: number;
  maxCpuPercent: number;
  loggingLevel: string;
  retentionDays: number;
  exportAllowed: boolean;
  approvalRequired: boolean;
  evidenceStorage: string;
}

// ── Assessment Job ───────────────────────────────────────────────

export type JobStatus = AssessmentStatus;

export interface AssessmentJob extends IDMixin {
  assessmentId: string;
  pluginId: string;
  targetId: string | null;
  status: JobStatus;
  priority: number;
  timeoutSeconds: number;
  startedAt: string | null;
  completedAt: string | null;
  resultJson: string | null;
  errorMessage: string | null;
  retryCount: number;
}

// ── Assessment Target ────────────────────────────────────────────

export interface AssessmentTarget extends IDMixin {
  assessmentId: string;
  assetId: string;
  targetType: string;
  configJson: string | null;
  status: AssessmentStatus;
}

// ── Evidence ─────────────────────────────────────────────────────

export type EvidenceType =
  | "structured_data"
  | "configuration_file"
  | "log"
  | "metadata"
  | "manual_note"
  | "screenshot"
  | "imported_report";

export type EvidenceClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export interface Evidence extends IDMixin {
  assessmentId: string;
  findingId: string | null;
  evidenceType: EvidenceType;
  title: string;
  description: string | null;
  integrityHash: string;
  source: string;
  collector: string;
  classification: EvidenceClassification;
  tags: string[];
  retentionDays: number;
}

// ── Recommendation ──────────────────────────────────────────────

export interface Recommendation extends IDMixin {
  assessmentId: string;
  findingId: string | null;
  title: string;
  description: string | null;
  priority: AssessmentPriority;
  effort: string | null;
  explanation: string | null;
  whyItMatters: string | null;
  suggestedActions: string[];
  references: string[];
}

// ── Timeline ────────────────────────────────────────────────────

export interface TimelineEvent extends IDMixin {
  assessmentId: string;
  eventType: string;
  title: string;
  description: string | null;
  severity: string | null;
  actor: string | null;
}

// ── Assessment Statistics ────────────────────────────────────────

export interface AssessmentStatistics {
  assessmentId: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  totalEvidence: number;
  durationSeconds: number | null;
  targetCount: number;
  pluginCount: number;
  riskScore: number | null;
}

// ── Assessment Dashboard ─────────────────────────────────────────

export interface AssessmentDashboard {
  totalAssessments: number;
  draftCount: number;
  queuedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  recentAssessments: Assessment[];
  upcomingScheduled: Assessment[];
  severityBreakdown: Record<Severity, number>;
  evidenceCount: number;
  reportCount: number;
}

// ── Assessment Report ────────────────────────────────────────────

export type ReportFormat = "json" | "markdown" | "html" | "csv";

export interface AssessmentReport extends IDMixin {
  assessmentId: string;
  format: ReportFormat;
  title: string;
  contentLength: number;
  integrityHash: string;
  generatedAt: string;
  generatedBy: string;
}

// ── Assessment Search ────────────────────────────────────────────

export interface AssessmentSearchResult {
  id: string;
  type: "assessment" | "finding" | "evidence" | "report";
  title: string;
  summary: string | null;
  relevanceScore: number;
  source: string;
}

export interface AssessmentSearchResponse {
  query: string;
  totalResults: number;
  results: AssessmentSearchResult[];
  offset: number;
  limit: number;
}

// ── Assessment Notes ─────────────────────────────────────────────

export interface AssessmentNote extends IDMixin {
  assessmentId: string;
  author: string;
  content: string;
  isPinned: boolean;
}

// ── Assessment Tags ──────────────────────────────────────────────

export interface AssessmentTag extends IDMixin {
  assessmentId: string;
  tag: string;
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
