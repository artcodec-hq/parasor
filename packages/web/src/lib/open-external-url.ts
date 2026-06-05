/**
 * Open an `http(s)` URL in a new browser tab/window during a user gesture.
 *
 * Uses a transient `<a target="_blank" rel="noopener noreferrer">` click rather
 * than `window.open`: on iOS Safari `window.open` for a `_blank` target is far
 * more likely to be swallowed by the popup blocker even inside a tap handler,
 * and `window.open` ignores `referrerPolicy`. An anchor click is the most
 * reliable cross-browser path and lets us pin the referrer policy here so the
 * destination never sees a parasor URL in `Referer`.
 *
 * Only `http:` / `https:` are honored -- `javascript:`, `data:`, relative or
 * unparseable input is ignored so this is never an arbitrary-scheme launcher.
 * There is intentionally no `window.open` fallback: its success is undetectable
 * and the anchor path already covers every browser we target.
 */
export function openHttpUrlInNewTab(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = parsed.toString();
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.referrerPolicy = "no-referrer";
  document.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
