/**
 * Browser runtime-environment detection the terminal pane branches on.
 *
 * Pure predicates over the `window` / `navigator` environment -- no React, no
 * `XTerm` coupling. Kept together because both answer "what platform are we
 * rendering on?" for terminal-specific rendering decisions (mobile key bar;
 * iOS Nerd-Font prefetch).
 */

/**
 * True on touch-primary devices. Used to decide whether to render the
 * MobileKeyBar -- desktop users already have Esc/Tab/arrows on their physical
 * keyboard and don't need the bar eating vertical space.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/**
 * True on iOS / iPadOS WebKit, which uniquely fails to trigger xterm's canvas
 * lazy `@font-face` `unicode-range` fetch -- so the Symbols Nerd Font must be
 * pre-fetched there or powerline glyphs render as tofu indefinitely.
 *
 * iPadOS 13+ Safari ships a `Macintosh` UA string, so `userAgent` alone is not
 * enough: a Mac UA combined with multi-touch support is the canonical iPadOS
 * signal. (Genuine Macs report `maxTouchPoints <= 1`.)
 */
export function isIosWebKit(ua: string, maxTouchPoints: number): boolean {
  return (
    /iP(hone|ad|od)/.test(ua) || (ua.includes("Mac") && maxTouchPoints > 1)
  );
}

/**
 * Whether to attach xterm's WebGL renderer. Default: desktop on, touch off --
 * ADR-20260529 (`0c57027`) disabled WebGL on touch devices on the hypothesis
 * that mobile WebView WebGL surface/texture handling lengthens the
 * keyboard-resize blink. That call was recorded as "evaluate against
 * real-device perf", never confirmed with data.
 *
 * `?terminalWebgl=1|0` overrides the default so the keep/revert decision can be
 * A/B'd on a real device without a rebuild -- flip the flag, reproduce the
 * scenario, and compare K3 (clear-redraw blank) / drift via
 * `scripts/terminal-kpi.ts`.
 */
export function resolveTerminalWebglEnabled(isTouch: boolean): boolean {
  const override = readWebglOverride();
  if (override !== null) return override;
  return !isTouch;
}

function readWebglOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const value = new URLSearchParams(window.location.search).get(
      "terminalWebgl",
    );
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return null;
  } catch {
    return null;
  }
}
