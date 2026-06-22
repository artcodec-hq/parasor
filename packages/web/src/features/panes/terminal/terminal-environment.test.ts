import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isIosWebKit,
  isTouchDevice,
  resolveTerminalWebglEnabled,
} from "./terminal-environment.js";

describe("isTouchDevice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when (pointer: coarse) matches", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q === "(pointer: coarse)" }),
    });
    expect(isTouchDevice()).toBe(true);
  });

  it("returns false when (pointer: coarse) does not match", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(isTouchDevice()).toBe(false);
  });

  it("returns false when matchMedia is unavailable", () => {
    vi.stubGlobal("window", {});
    expect(isTouchDevice()).toBe(false);
  });
});

describe("isIosWebKit", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const IPAD_LEGACY =
    "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15";
  const IPADOS_SPOOF =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15";
  const MAC_DESKTOP =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120";

  it("detects iPhone / iPad / iPod UA strings regardless of touch points", () => {
    expect(isIosWebKit(IPHONE, 0)).toBe(true);
    expect(isIosWebKit(IPAD_LEGACY, 5)).toBe(true);
  });

  it("detects iPadOS spoofing a Mac UA via multi-touch", () => {
    expect(isIosWebKit(IPADOS_SPOOF, 5)).toBe(true);
  });

  it("treats a genuine Mac (maxTouchPoints <= 1) as non-iOS", () => {
    expect(isIosWebKit(MAC_DESKTOP, 0)).toBe(false);
    expect(isIosWebKit(MAC_DESKTOP, 1)).toBe(false); // boundary: > 1 required
  });

  it("returns false for non-Apple platforms", () => {
    expect(isIosWebKit(ANDROID, 5)).toBe(false);
  });
});

describe("resolveTerminalWebglEnabled", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSearch(search: string) {
    vi.stubGlobal("window", { location: { search } });
  }

  it("defaults to disabled on desktop and touch", () => {
    stubSearch("");
    expect(resolveTerminalWebglEnabled(false)).toBe(false);
    expect(resolveTerminalWebglEnabled(true)).toBe(false);
  });

  it("forces WebGL on via ?terminalWebgl=1 regardless of touch", () => {
    stubSearch("?terminalWebgl=1");
    expect(resolveTerminalWebglEnabled(true)).toBe(true);
    stubSearch("?terminalWebgl=true");
    expect(resolveTerminalWebglEnabled(true)).toBe(true);
  });

  it("forces WebGL off via ?terminalWebgl=0 regardless of touch", () => {
    stubSearch("?terminalWebgl=0");
    expect(resolveTerminalWebglEnabled(false)).toBe(false);
    stubSearch("?terminalWebgl=false");
    expect(resolveTerminalWebglEnabled(false)).toBe(false);
  });

  it("falls back to the default for an unrecognized override value", () => {
    stubSearch("?terminalWebgl=maybe");
    expect(resolveTerminalWebglEnabled(true)).toBe(false);
    expect(resolveTerminalWebglEnabled(false)).toBe(false);
  });
});
