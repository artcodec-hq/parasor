import { afterEach, describe, expect, it, vi } from "vitest";
import { fireServiceConfigUpdate } from "./service-config-api.js";

const ORIG_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  vi.restoreAllMocks();
});

function mockFetchOk(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchFail(status: number): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(null, { status }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("fireServiceConfigUpdate", () => {
  it("forwards the patch body verbatim to PATCH /api/service-config", async () => {
    const fetchSpy = mockFetchOk();
    fireServiceConfigUpdate({ preventIdleSleep: true });
    // Let the queued microtask drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("/api/service-config");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ preventIdleSleep: true }));
  });

  it("logs a field-specific warning when the request rejects", async () => {
    mockFetchFail(500);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fireServiceConfigUpdate({ portDetection: "off" });
    // Two microtask hops: fetch resolve -> updateServiceConfig throw ->
    // catch handler.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("Failed to update portDetection:");
  });

  it("uses the first patch key as the warning field name", async () => {
    mockFetchFail(500);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fireServiceConfigUpdate({ dropSizeMaxBytes: 1024 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      "Failed to update dropSizeMaxBytes:",
      expect.any(Error),
    );
  });

  it("falls back to 'service config' for an empty patch (defensive)", async () => {
    mockFetchFail(500);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fireServiceConfigUpdate({});
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      "Failed to update service config:",
      expect.any(Error),
    );
  });
});
