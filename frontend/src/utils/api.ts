/**
 * API Client for SecureScan Pro X
 */

const BASE_URL = "http://localhost:8000/api/v1";

class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, message: string, detail: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.detail || `Request failed: ${res.status}`,
      data.detail || "",
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ success: boolean; user: any; session_token: string }>(
      "/auth/login",
      { username, password },
    ),
  register: (username: string, email: string, password: string) =>
    api.post<{ success: boolean; user: any }>("/auth/register", {
      username,
      email,
      password,
    }),
  logout: () => api.post<{ success: boolean }>("/auth/logout"),
  me: () => api.get<any>("/auth/me"),
};

export const workspaceApi = {
  list: () => api.get<any[]>("/workspaces"),
  get: (id: string) => api.get<any>(`/workspaces/${id}`),
  create: (data: any) => api.post<any>("/workspaces", data),
  update: (id: string, data: any) => api.patch<any>(`/workspaces/${id}`, data),
  delete: (id: string) => api.delete<any>(`/workspaces/${id}`),
};

export const assetApi = {
  list: (workspaceId?: string) =>
    api.get<any[]>(`/assets${workspaceId ? `?workspace_id=${workspaceId}` : ""}`),
  get: (id: string) => api.get<any>(`/assets/${id}`),
  create: (data: any, workspaceId?: string) =>
    api.post<any>(`/assets${workspaceId ? `?workspace_id=${workspaceId}` : ""}`, data),
  update: (id: string, data: any) => api.patch<any>(`/assets/${id}`, data),
  delete: (id: string) => api.delete<any>(`/assets/${id}`),
};

export const assessmentApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api.get<any[]>(`/assessments${qs}`);
  },
  get: (id: string) => api.get<any>(`/assessments/${id}`),
  create: (data: any) => api.post<any>("/assessments", data),
  update: (id: string, data: any) => api.patch<any>(`/assessments/${id}`, data),
  delete: (id: string) => api.delete<any>(`/assessments/${id}`),
  dashboard: () => api.get<any>("/assessments/dashboard"),
  statistics: (id: string) => api.get<any>(`/assessments/${id}/statistics`),
  findings: (id: string) => api.get<any[]>(`/assessments/${id}/findings`),
  start: (id: string) => api.post<any>(`/assessments/${id}/start`),
  pause: (id: string) => api.post<any>(`/assessments/${id}/pause`),
  resume: (id: string) => api.post<any>(`/assessments/${id}/resume`),
  cancel: (id: string) => api.post<any>(`/assessments/${id}/cancel`),
};

export const scanApi = {
  portScan: (target: string, ports?: number[]) =>
    api.post<any>("/scans/port-scan", { target, ports }),
  headerCheck: (url: string) =>
    api.post<any>("/scans/header-check", { url }),
  passwordCheck: (demoMode = true) =>
    api.post<any>("/scans/password-check", { demo_mode: demoMode }),
  sslCheck: (hostname: string, port = 443) =>
    api.post<any>("/scans/ssl-check", { hostname, port }),
  fullScan: (target: string, scanTypes?: string[]) =>
    api.post<any>("/scans/full-scan", { target, scan_types: scanTypes }),
  history: () => api.get<any[]>("/scans/history"),
};
