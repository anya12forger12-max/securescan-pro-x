/**
 * SecureScan Pro X — TypeScript Plugin SDK
 *
 * Provides interfaces and utilities for building TypeScript plugins.
 */

// ── Enums ──────────────────────────────────────────────────────

export enum Severity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

export enum AssetType {
  HOST = "host",
  NETWORK = "network",
  WEB = "web",
  CLOUD = "cloud",
  CONTAINER = "container",
}

export enum PluginType {
  CHECK = "check",
  REPORT = "report",
  KNOWLEDGE = "knowledge",
  INTEGRATION = "integration",
  UI = "ui",
}

// ── Interfaces ─────────────────────────────────────────────────

export interface Asset {
  id: string;
  type: AssetType;
  identifier: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface Finding {
  title: string;
  description: string;
  severity: Severity;
  category: string;
  recommendation?: string;
  references?: string[];
  evidence?: string;
  cvssScore?: number;
  cweIds?: string[];
}

export interface CheckResult {
  pluginId: string;
  assetId: string;
  status: string;
  findings: Finding[];
  durationMs?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface PluginContext {
  workspaceId: string;
  permissions: string[];
}

export interface PluginAPI {
  registerExtensionPoint(point: ExtensionPoint): void;
  getLogger(name: string): PluginLogger;
  getStorage(pluginId: string): PluginStorage;
}

export interface PluginLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

export interface PluginStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

// ── Extension Points ───────────────────────────────────────────

export interface ExtensionPoint {
  id: string;
  name: string;
  type: "component" | "navigation" | "action" | "widget";
  component?: React.ComponentType;
  position?: number;
}

// ── Plugin Activation ──────────────────────────────────────────

export function activate(api: PluginAPI): void {
  // Plugin activation entry point
  console.log("Plugin activated");
}

export function deactivate(): void {
  // Plugin deactivation cleanup
  console.log("Plugin deactivated");
}
