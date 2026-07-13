import { describe, expect, it } from "vitest";
import { DEFAULT_RECONNECTING_OVERLAY_DELAY_MS } from "../../../components/overlays/ReconnectingOverlay.js";
import { resolveTerminalReconnectingOverlayDelay } from "./terminal-reconnecting-overlay.js";

describe("resolveTerminalReconnectingOverlayDelay", () => {
  it("uses the foreground delay for touch terminals recently foregrounded", () => {
    expect(
      resolveTerminalReconnectingOverlayDelay({
        isTouch: true,
        lastForegroundAtMs: 10_000,
        nowMs: 12_000,
      }),
    ).toBe(2500);
  });

  it("uses the default delay outside the foreground grace window", () => {
    expect(
      resolveTerminalReconnectingOverlayDelay({
        isTouch: true,
        lastForegroundAtMs: 10_000,
        nowMs: 14_001,
      }),
    ).toBe(DEFAULT_RECONNECTING_OVERLAY_DELAY_MS);
  });

  it("uses the default delay on desktop terminals", () => {
    expect(
      resolveTerminalReconnectingOverlayDelay({
        isTouch: false,
        lastForegroundAtMs: 10_000,
        nowMs: 12_000,
      }),
    ).toBe(DEFAULT_RECONNECTING_OVERLAY_DELAY_MS);
  });
});
