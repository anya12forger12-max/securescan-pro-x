import { describe, expect, it, vi, afterEach } from "vitest";
import { api, authApi } from "./api";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the backend with JSON headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api.post<{ ok: boolean }>("/workspaces", { name: "w" });

    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/workspaces");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(JSON.stringify({ name: "w" }));
  });

  it("throws ApiError with server detail on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "not found" }),
      }),
    );

    await expect(api.get("/nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      detail: "not found",
    });
  });

  it("authApi.login posts credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await authApi.login("user", "pass");
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/auth/login");
    expect(JSON.parse(String(opts.body))).toEqual({
      username: "user",
      password: "pass",
    });
  });
});
