/*
 * Dedicated key for the persistent clientId, isolated from the
 * `parasor:preferences` blob that App.tsx rewrites whole-object on every
 * sidebar/focus change. Sharing the key with App.tsx caused this exact
 * bug: getClientId() wrote the id into the prefs blob, App.tsx's
 * savePrefs then serialized only its own field set and silently dropped
 * the id, and the next render that re-evaluated this module generated a
 * fresh id -- leaving the same browser tab attaching to the same session
 * with two different clientIds and immediately kicking itself off under
 * the single-client policy.
 */
const CLIENT_ID_KEY = "parasor:client-id";
const LEGACY_PREFS_KEY = "parasor:preferences";

let cachedClientId: string | null = null;

/*
 * `crypto.randomUUID()` is only defined in secure contexts (HTTPS or
 * localhost). Tailscale Magic DNS hosts (`*.ts.net`) over HTTP are NOT
 * secure contexts, so on iPhone Safari accessing the dev server via
 * Tailscale, calling `crypto.randomUUID()` throws and unmounts the React
 * tree. `crypto.getRandomValues` IS available in non-secure contexts, so
 * we synthesize a v4 UUID from random bytes manually.
 */
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const versionByte = bytes[6] ?? 0;
  const variantByte = bytes[8] ?? 0;
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function getClientId(): string {
  if (cachedClientId) return cachedClientId;

  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored) {
      cachedClientId = stored;
      return cachedClientId;
    }
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    if (raw) {
      const prefs = JSON.parse(raw) as Record<string, unknown>;
      if (typeof prefs.clientId === "string" && prefs.clientId) {
        cachedClientId = prefs.clientId;
        try {
          localStorage.setItem(CLIENT_ID_KEY, cachedClientId);
        } catch {
          // ignore
        }
        return cachedClientId;
      }
    }
  } catch {
    // ignore parse errors
  }

  cachedClientId = generateUUID();
  try {
    localStorage.setItem(CLIENT_ID_KEY, cachedClientId);
  } catch {
    // ignore storage errors
  }
  return cachedClientId;
}
