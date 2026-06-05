import type { TerminalLastSeen } from "@parasor/shared";

const MAX_ENTRY_CHARS = 4 * 1024 * 1024;
const MAX_TOTAL_CHARS = 12 * 1024 * 1024;

export interface TerminalReplayCacheEntry {
  data: string;
  lastSeen: TerminalLastSeen;
  storedAt: number;
}

const entries = new Map<string, TerminalReplayCacheEntry>();
let totalChars = 0;

function evictOldest(): void {
  const oldest = entries.keys().next().value;
  if (oldest === undefined) return;
  const entry = entries.get(oldest);
  if (entry) totalChars -= entry.data.length;
  entries.delete(oldest);
}

export function getTerminalReplayCache(
  sessionId: string,
): TerminalReplayCacheEntry | null {
  const entry = entries.get(sessionId);
  if (!entry) return null;
  entries.delete(sessionId);
  entries.set(sessionId, entry);
  return entry;
}

export function setTerminalReplayCache(
  sessionId: string,
  entry: { data: string; lastSeen: TerminalLastSeen },
): void {
  clearTerminalReplayCache(sessionId);
  if (entry.data.length === 0 || entry.data.length > MAX_ENTRY_CHARS) return;
  const next: TerminalReplayCacheEntry = {
    data: entry.data,
    lastSeen: entry.lastSeen,
    storedAt: Date.now(),
  };
  entries.set(sessionId, next);
  totalChars += next.data.length;
  while (totalChars > MAX_TOTAL_CHARS) evictOldest();
}

export function clearTerminalReplayCache(sessionId?: string): void {
  if (sessionId === undefined) {
    entries.clear();
    totalChars = 0;
    return;
  }
  const existing = entries.get(sessionId);
  if (existing) totalChars -= existing.data.length;
  entries.delete(sessionId);
}

export function getTerminalReplayCacheStats(): {
  entries: number;
  totalChars: number;
} {
  return { entries: entries.size, totalChars };
}
