import { config } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  token?: string | null;
};

/** The gateway-issued access token is the only credential the browser ever
 * sends. Service tokens and identity headers are injected by the gateway. */
export function authHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/** Peer services wrap responses in `{ success, data }`; recovered game
 * services return the payload directly. Normalise both shapes here. */
export function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, token, headers, ...rest } = options;
  const response = await fetch(`${config.api}${path}`, {
    ...rest,
    headers: { ...authHeaders(token), ...(headers as Record<string, string> | undefined) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(15000),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const error = payload as { error?: { code?: string; message?: string }; message?: string } | null;
    throw new ApiError(
      error?.error?.message ?? error?.message ?? `Request failed (${response.status})`,
      response.status,
      error?.error?.code,
    );
  }

  return unwrap<T>(payload);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}
