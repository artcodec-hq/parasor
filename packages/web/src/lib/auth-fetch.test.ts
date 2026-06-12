import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadAuthFetch() {
  vi.resetModules();
  return import("./auth-fetch.js");
}

describe("ensureAuthenticated", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses a recent successful preflight when explicitly requested", async () => {
    const { ensureAuthenticated } = await loadAuthFetch();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      ensureAuthenticated({ reuseRecentSuccess: true }),
    ).resolves.toBe(true);
    vi.setSystemTime(5_000);
    await expect(
      ensureAuthenticated({ reuseRecentSuccess: true }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reuse successful preflights unless requested", async () => {
    const { ensureAuthenticated } = await loadAuthFetch();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(ensureAuthenticated()).resolves.toBe(true);
    await expect(ensureAuthenticated()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not add auth trace headers unless tracing is requested", async () => {
    const { ensureAuthenticated } = await loadAuthFetch();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(ensureAuthenticated()).resolves.toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toBeUndefined();
  });

  it("emits auth preflight trace events with a correlation header", async () => {
    const { ensureAuthenticated } = await loadAuthFetch();
    const fetchMock = vi.mocked(fetch);
    const trace = vi.fn();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      ensureAuthenticated({ source: "event-socket", trace }),
    ).resolves.toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["x-parasor-auth-trace-id"]).toMatch(/^auth-/);
    expect(trace).toHaveBeenCalledTimes(2);
    const start = trace.mock.calls[0]?.[0];
    const complete = trace.mock.calls[1]?.[0];
    expect(start).toMatchObject({
      phase: "start",
      source: "event-socket",
      traceId: headers?.["x-parasor-auth-trace-id"],
    });
    expect(complete).toMatchObject({
      phase: "complete",
      source: "event-socket",
      traceId: headers?.["x-parasor-auth-trace-id"],
      httpStatus: 200,
      ok: true,
      startedAtWallMs: expect.any(Number),
      endedAtWallMs: expect.any(Number),
    });
    expect(complete.durationMs).toEqual(expect.any(Number));
    expect(complete.wallMs).toEqual(expect.any(Number));
  });

  it("refreshes the preflight after the success cache expires", async () => {
    const { AUTH_PREFLIGHT_SUCCESS_CACHE_MS, ensureAuthenticated } =
      await loadAuthFetch();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      ensureAuthenticated({ reuseRecentSuccess: true }),
    ).resolves.toBe(true);
    vi.setSystemTime(1_000 + AUTH_PREFLIGHT_SUCCESS_CACHE_MS);
    await expect(
      ensureAuthenticated({ reuseRecentSuccess: true }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears the success cache when an authenticated request receives 401", async () => {
    const { authFetch, ensureAuthenticated } = await loadAuthFetch();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      ensureAuthenticated({ reuseRecentSuccess: true }),
    ).resolves.toBe(true);
    await expect(authFetch("/api/projects")).rejects.toThrow(
      "parasor session expired",
    );
    await expect(
      ensureAuthenticated({ reuseRecentSuccess: true }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
