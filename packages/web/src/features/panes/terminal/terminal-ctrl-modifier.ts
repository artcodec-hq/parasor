/**
 * One-shot Ctrl transform for the soft-keyboard path: converts a single
 * printable char into its C0 control equivalent the way a physical Ctrl
 * combo would. Multi-char data (paste, IME) is passed through untouched --
 * the sticky flag is still consumed by the caller in that case because the
 * user's intent was "ctrl then next input."
 *
 * Pure: no React, no DOM. The sticky-Ctrl state and its keyboard-close
 * auto-clear stay in the component; only this character mapping is extracted.
 */

/** Classic Ctrl+@/[/\/]/^/_/? C0 mappings, beyond the a-z / A-Z range. */
const SPECIAL_CTRL_MAP: Record<string, string> = {
  "@": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "^": "\x1e",
  _: "\x1f",
  "?": "\x7f",
};

export function applyCtrlModifier(data: string): string {
  if (data.length !== 1) return data;
  const c = data.charCodeAt(0);
  // a-z -> \x01-\x1a
  if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60);
  // A-Z -> \x01-\x1a
  if (c >= 0x41 && c <= 0x5a) return String.fromCharCode(c - 0x40);
  return SPECIAL_CTRL_MAP[data] ?? data;
}
