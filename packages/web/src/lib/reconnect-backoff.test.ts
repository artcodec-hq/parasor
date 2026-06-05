import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_STABLE_MS, nextReconnectDelay } from "./reconnect-backoff.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nextReconnectDelay", () => {
  it("doubles the base delay per attempt (random=0.5 -> zero jitter)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(nextReconnectDelay(0)).toBe(1000);
    expect(nextReconnectDelay(1)).toBe(2000);
    expect(nextReconnectDelay(2)).toBe(4000);
    expect(nextReconnectDelay(4)).toBe(16000);
  });

  it("clamps the exponential term at 30s for high attempts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(nextReconnectDelay(5)).toBe(30000); // 32000 clamped to 30000
    expect(nextReconnectDelay(20)).toBe(30000);
  });

  it("applies -20% jitter at the low end (random=0)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(nextReconnectDelay(0)).toBe(800);
    expect(nextReconnectDelay(5)).toBe(24000); // clamp(30000) * 0.8
  });

  it("applies +20% jitter after the clamp, so it can exceed 30s (random=1)", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(nextReconnectDelay(0)).toBe(1200);
    expect(nextReconnectDelay(5)).toBe(36000); // clamp(30000) * 1.2
  });

  it("rounds the jittered result to an integer", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.3);
    // factor = 1 + (0.3*0.4 - 0.2) = 0.92 -> 1000 * 0.92 = 920
    expect(nextReconnectDelay(0)).toBe(920);
  });
});

describe("MIN_STABLE_MS", () => {
  it("is the 3s flap-detection window", () => {
    expect(MIN_STABLE_MS).toBe(3000);
  });
});
