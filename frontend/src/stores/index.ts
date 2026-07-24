/**
 * Zustand Stores for SecureScan Pro X
 */
import { create } from "zustand";

// ── Auth Store ────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  role: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  logout: () => set({ user: null, isAuthenticated: false, error: null }),
}));

// ── UI Store ──────────────────────────────────────────────────

interface Notification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
}

interface UIState {
  theme: string;
  sidebarCollapsed: boolean;
  notifications: Notification[];
  setTheme: (theme: string) => void;
  toggleSidebar: () => void;
  addNotification: (n: Omit<Notification, "id">) => void;
  removeNotification: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: localStorage.getItem("theme") || "dark",
  sidebarCollapsed: false,
  notifications: [],
  setTheme: (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    set({ theme });
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  addNotification: (n) =>
    set((s) => ({
      notifications: [
        ...s.notifications,
        { ...n, id: crypto.randomUUID() },
      ],
    })),
  removeNotification: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),
}));

// ── Scan Store ────────────────────────────────────────────────

interface ScanFinding {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  evidence: string;
  recommendation: string;
}

interface ScanResult {
  scan_type: string;
  target: string;
  status: string;
  findings: ScanFinding[];
  evidence: string[];
  duration_seconds: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

interface ScanState {
  currentResult: ScanResult | null;
  results: Record<string, ScanResult>;
  isScanning: boolean;
  scanHistory: ScanResult[];
  error: string | null;
  setCurrentResult: (r: ScanResult | null) => void;
  addResult: (key: string, r: ScanResult) => void;
  setScanning: (v: boolean) => void;
  setHistory: (h: ScanResult[]) => void;
  setError: (e: string | null) => void;
  clearResults: () => void;
}

export const useScanStore = create<ScanState>((set) => ({
  currentResult: null,
  results: {},
  isScanning: false,
  scanHistory: [],
  error: null,
  setCurrentResult: (r) => set({ currentResult: r }),
  addResult: (key, r) =>
    set((s) => ({ results: { ...s.results, [key]: r }, currentResult: r })),
  setScanning: (v) => set({ isScanning: v }),
  setHistory: (h) => set({ scanHistory: h }),
  setError: (e) => set({ error: e }),
  clearResults: () => set({ results: {}, currentResult: null }),
}));

// ── Workspace Store ───────────────────────────────────────────

interface WorkspaceState {
  workspaces: any[];
  selectedId: string | null;
  isLoading: boolean;
  setWorkspaces: (w: any[]) => void;
  setSelectedId: (id: string | null) => void;
  setLoading: (v: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  selectedId: null,
  isLoading: false,
  setWorkspaces: (w) => set({ workspaces: w, isLoading: false }),
  setSelectedId: (id) => set({ selectedId: id }),
  setLoading: (v) => set({ isLoading: v }),
}));

// ── Assessment Store ──────────────────────────────────────────

interface AssessmentState {
  assessments: any[];
  dashboard: any | null;
  isLoading: boolean;
  setAssessments: (a: any[]) => void;
  setDashboard: (d: any) => void;
  setLoading: (v: boolean) => void;
}

export const useAssessmentStore = create<AssessmentState>((set) => ({
  assessments: [],
  dashboard: null,
  isLoading: false,
  setAssessments: (a) => set({ assessments: a, isLoading: false }),
  setDashboard: (d) => set({ dashboard: d, isLoading: false }),
  setLoading: (v) => set({ isLoading: v }),
}));
