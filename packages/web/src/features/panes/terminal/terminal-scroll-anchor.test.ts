import { describe, expect, it, vi } from "vitest";
import {
  captureScrollAnchor,
  resolveAnchoredViewportY,
  restoreScrollAnchor,
  type ScrollableTerminal,
} from "./terminal-scroll-anchor.js";

function fakeTerm(
  viewportY: number,
  baseY: number,
): ScrollableTerminal & {
  scrollToBottom: ReturnType<typeof vi.fn<() => void>>;
  scrollToLine: ReturnType<typeof vi.fn<(line: number) => void>>;
} {
  return {
    buffer: { active: { viewportY, baseY } },
    scrollToBottom: vi.fn<() => void>(),
    scrollToLine: vi.fn<(line: number) => void>(),
  };
}

describe("resolveAnchoredViewportY", () => {
  it("shifts the anchored line by the scrollback base delta", () => {
    // base grew 60->69 (9 new lines pushed in); a viewport at 22 should follow.
    expect(resolveAnchoredViewportY({ viewportY: 22, baseY: 60 }, 69)).toBe(31);
  });

  it("clamps below zero", () => {
    expect(resolveAnchoredViewportY({ viewportY: 2, baseY: 40 }, 10)).toBe(0);
  });

  it("clamps above the new base", () => {
    expect(resolveAnchoredViewportY({ viewportY: 50, baseY: 10 }, 30)).toBe(30);
  });
});

describe("captureScrollAnchor", () => {
  it("flags wasAtBottom when the viewport sits on the tail", () => {
    expect(captureScrollAnchor(fakeTerm(40, 40)).wasAtBottom).toBe(true);
    expect(captureScrollAnchor(fakeTerm(18, 40)).wasAtBottom).toBe(false);
  });
});

describe("restoreScrollAnchor", () => {
  it("follows the tail when the anchor was at the bottom", () => {
    const term = fakeTerm(0, 100);
    const result = restoreScrollAnchor(term, {
      viewportY: 40,
      baseY: 40,
      wasAtBottom: true,
    });
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(term.scrollToLine).not.toHaveBeenCalled();
    expect(result.reason).toBe("was-at-bottom");
  });

  it("moves a scrolled viewport to the recomputed anchor line", () => {
    const term = fakeTerm(0, 69);
    const result = restoreScrollAnchor(term, {
      viewportY: 22,
      baseY: 60,
      wasAtBottom: false,
    });
    expect(term.scrollToLine).toHaveBeenCalledWith(31);
    expect(result).toEqual({ reason: "anchor-changed", targetViewportY: 31 });
  });

  it("leaves a viewport that already sits on the anchor untouched", () => {
    const term = fakeTerm(18, 40);
    const result = restoreScrollAnchor(term, {
      viewportY: 18,
      baseY: 40,
      wasAtBottom: false,
    });
    expect(term.scrollToLine).not.toHaveBeenCalled();
    expect(result.reason).toBe("viewport-stable");
  });
});
