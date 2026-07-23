/**
 * SecureScan Pro X — Shared Types
 *
 * TypeScript types shared between frontend and backend.
 * These types ensure consistency across the full stack.
 */

// Re-export all types for convenience
export type {
  // Workspace
  Workspace,
  WorkspaceCreate,
  WorkspaceUpdate,
  // Asset
  Asset,
  AssetCreate,
  AssetUpdate,
  AssetType,
  // Assessment
  Assessment,
  AssessmentCreate,
  AssessmentUpdate,
  AssessmentStatus,
  // Finding
  Finding,
  FindingCreate,
  FindingUpdate,
  Severity,
  FindingStatus,
  // Common
  HealthResponse,
  ApiError,
  ThemeName,
  PluginInfo,
  PluginType,
} from "../../frontend/src/types/index";
