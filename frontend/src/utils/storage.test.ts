import { afterEach, describe, expect, it, vi } from "vitest";
import { storageGet, storageSet } from "./storage";

describe("safe local storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads and writes when storage is available", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });

    expect(storageGet("theme")).toBeNull();
    storageSet("theme", "light");
    expect(storageGet("theme")).toBe("light");
  });

  it("falls back instead of throwing when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });

    expect(storageGet("theme")).toBeNull();
    expect(() => storageSet("theme", "light")).not.toThrow();
  });

  it("falls back when localStorage is not defined at all", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(storageGet("theme")).toBeNull();
    expect(() => storageSet("theme", "light")).not.toThrow();
  });
});
