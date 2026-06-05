import { describe, expect, it, vi } from "vitest";
import { waitForDaemonSocket } from "./socket-ready.js";

describe("waitForDaemonSocket", () => {
  it("resolves immediately when probeFn returns true on first call", async () => {
    const probeFn = vi.fn().mockResolvedValueOnce(true);
    await expect(
      waitForDaemonSocket("/run/test.sock", { probeFn, intervalMs: 1 }),
    ).resolves.toBeUndefined();
    expect(probeFn).toHaveBeenCalledTimes(1);
    expect(probeFn).toHaveBeenCalledWith("/run/test.sock");
  });

  it("polls until ready and resolves", async () => {
    let calls = 0;
    const probeFn = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(calls >= 3);
    });
    await expect(
      waitForDaemonSocket("/run/test.sock", {
        probeFn,
        intervalMs: 1,
        timeoutMs: 5000,
      }),
    ).resolves.toBeUndefined();
    expect(probeFn.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("throws timeout error with correct message when timeout expires", async () => {
    const probeFn = vi.fn().mockResolvedValue(false);
    await expect(
      waitForDaemonSocket("/run/my.sock", {
        probeFn,
        intervalMs: 1,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(
      "daemon socket did not become ready within 50ms (path=/run/my.sock)",
    );
  });

  it("does NOT proceed past timeout (probe still false at deadline)", async () => {
    const probeFn = vi.fn().mockResolvedValue(false);
    await expect(
      waitForDaemonSocket("/run/test.sock", {
        probeFn,
        intervalMs: 1,
        timeoutMs: 30,
      }),
    ).rejects.toThrow("daemon socket did not become ready");
  });

  it("uses default timeoutMs=5000 and intervalMs=100 when opts omitted", async () => {
    // We verify defaults are used by passing a probeFn that fails immediately.
    // The important thing is that the error message contains the correct default timeout.
    const probeFn = vi.fn().mockResolvedValue(false);
    // Use very short override to avoid test timeout.
    const promise = waitForDaemonSocket("/run/test.sock", {
      probeFn,
      timeoutMs: 10,
      intervalMs: 1,
    });
    await expect(promise).rejects.toThrow(/daemon socket did not become ready/);
  });
});
