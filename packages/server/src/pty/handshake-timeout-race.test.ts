import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { raceHandshakeWithTimeout } from "./handshake-timeout-race.js";

describe("raceHandshakeWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the awaiter resolves before the deadline", async () => {
    const onTimeout = vi.fn();
    const promise = raceHandshakeWithTimeout({
      awaiter: Promise.resolve(),
      timeoutMs: 1000,
      onTimeout,
      buildTimeoutError: () => new Error("timeout"),
    });
    await expect(promise).resolves.toBeUndefined();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("rejects with the built timeout error when the deadline fires first", async () => {
    const onTimeout = vi.fn();
    const promise = raceHandshakeWithTimeout({
      awaiter: new Promise<void>(() => {}), // never settles
      timeoutMs: 100,
      onTimeout,
      buildTimeoutError: (ms) => new Error(`handshake timeout ${ms}ms`),
    });
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow("handshake timeout 100ms");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("invokes onTimeout exactly once before rejecting", async () => {
    const onTimeout = vi.fn();
    const promise = raceHandshakeWithTimeout({
      awaiter: new Promise<void>(() => {}),
      timeoutMs: 50,
      onTimeout,
      buildTimeoutError: () => new Error("t"),
    });
    vi.advanceTimersByTime(50);
    await expect(promise).rejects.toThrow();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("swallows throws from onTimeout and still propagates the typed timeout error", async () => {
    const onTimeout = vi.fn(() => {
      throw new Error("socket already errored");
    });
    const builtErr = new Error("typed timeout");
    const promise = raceHandshakeWithTimeout({
      awaiter: new Promise<void>(() => {}),
      timeoutMs: 100,
      onTimeout,
      buildTimeoutError: () => builtErr,
    });
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toBe(builtErr);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("clears the timer when the awaiter resolves first (no late onTimeout fire)", async () => {
    const onTimeout = vi.fn();
    const promise = raceHandshakeWithTimeout({
      awaiter: Promise.resolve(),
      timeoutMs: 1000,
      onTimeout,
      buildTimeoutError: () => new Error("late"),
    });
    await expect(promise).resolves.toBeUndefined();
    // Advance well past the original deadline -- the cleared timer must not
    // fire a late onTimeout side effect.
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("clears the timer when the awaiter rejects first and propagates that error", async () => {
    const onTimeout = vi.fn();
    const awaiterErr = new Error("wire fault");
    const promise = raceHandshakeWithTimeout({
      awaiter: Promise.reject(awaiterErr),
      timeoutMs: 1000,
      onTimeout,
      buildTimeoutError: () => new Error("timeout"),
    });
    await expect(promise).rejects.toBe(awaiterErr);
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("passes the configured timeoutMs through to buildTimeoutError", async () => {
    const buildTimeoutError = vi.fn(
      (ms: number) => new Error(`deadline=${ms}`),
    );
    const promise = raceHandshakeWithTimeout({
      awaiter: new Promise<void>(() => {}),
      timeoutMs: 250,
      onTimeout: () => {},
      buildTimeoutError,
    });
    vi.advanceTimersByTime(250);
    await expect(promise).rejects.toThrow("deadline=250");
    expect(buildTimeoutError).toHaveBeenCalledWith(250);
  });
});
