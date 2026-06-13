export const TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY =
  "parasor:terminal-internal-clipboard";

export function writeTerminalInternalClipboard(text: string): boolean {
  try {
    window.localStorage.setItem(TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function readTerminalInternalClipboard(): string | null {
  try {
    const text = window.localStorage.getItem(
      TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY,
    );
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function hasTerminalPasteCandidate(): boolean {
  return (
    readTerminalInternalClipboard() !== null || !!navigator.clipboard?.readText
  );
}
