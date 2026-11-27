/**
 * localStorage access that cannot take the app down.
 *
 * Browsers throw on localStorage in private modes, when third-party storage
 * is blocked by policy, or when the quota is exhausted. The UI store reads the
 * theme at module load and writes it on every change, so an unguarded call
 * there prevents the whole app from mounting. Persistence is best-effort: when
 * storage is unavailable the in-memory state still works for the session.
 */
export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is optional; callers keep their in-memory value.
  }
}
