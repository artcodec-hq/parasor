import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;

export type PairingConsumeResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "missing" | "expired" | "used" };

interface PairingEntry {
  expiresAt: number;
  used: boolean;
}

export interface PairingTokenStoreOptions {
  defaultTtlMs?: number;
  now?: () => number;
}

export interface IssuePairingTokenOptions {
  ttlMs?: number;
}

export class PairingTokenStore {
  private readonly entries = new Map<string, PairingEntry>();
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(opts: PairingTokenStoreOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? DEFAULT_PAIRING_TOKEN_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  issue(opts: IssuePairingTokenOptions = {}): {
    token: string;
    expiresAt: number;
  } {
    this.cleanupExpired();
    const token = randomBytes(32).toString("base64url");
    const ttlMs = opts.ttlMs ?? this.defaultTtlMs;
    const expiresAt = this.now() + ttlMs;
    this.entries.set(hashToken(token), { expiresAt, used: false });
    return { token, expiresAt };
  }

  consume(token: string | null | undefined): PairingConsumeResult {
    if (!token) return { ok: false, reason: "missing" };
    const key = hashToken(token);
    const entry = this.entries.get(key);
    if (!entry) return { ok: false, reason: "missing" };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { ok: false, reason: "expired" };
    }
    if (entry.used) return { ok: false, reason: "used" };
    entry.used = true;
    return { ok: true, expiresAt: entry.expiresAt };
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
