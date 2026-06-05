import type { AuthMode } from "./create-app-server.js";

export interface SelectBindAddressOptions {
  explicit: string | undefined;
}

/**
 * Default bind = `0.0.0.0` (all IPv4 interfaces). Matches the dominant
 * pattern across self-hosted dev/web-terminal tools (ttyd / gotty / wetty /
 * Next.js dev / Vite + `--host`). Auth (token + Origin) is the primary
 * defense; restricting the bind is opt-in via `--host 127.0.0.1` for
 * loopback-only or `--host <specific-ip>` for a single interface.
 */
export function selectBindAddress({
  explicit,
}: SelectBindAddressOptions): string {
  if (explicit && explicit.length > 0) return explicit;
  return "0.0.0.0";
}

export function isLoopback(host: string): boolean {
  if (host === "localhost") return true;
  if (host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    parts[0] === 127
  ) {
    return true;
  }
  return false;
}

export interface EnforceSafetyGateOptions {
  authMode: AuthMode;
  bindHost: string;
  allowUnsafe: boolean;
  exit?: (code?: number) => never;
  error?: (line: string) => void;
}

const UNSAFE_MESSAGE = [
  "Refusing to start: PARASOR_AUTH=none with non-loopback bind is unsafe.",
  "Either:",
  "  - Keep auth enabled (remove PARASOR_AUTH=none), or",
  "  - Bind to loopback: HOST=127.0.0.1 (or --host 127.0.0.1)",
  "Override for integration tests only: PARASOR_ALLOW_UNSAFE=1",
].join("\n");

export function enforceSafetyGate({
  authMode,
  bindHost,
  allowUnsafe,
  exit = process.exit,
  error = console.error,
}: EnforceSafetyGateOptions): void {
  if (authMode !== "none") return;
  if (isLoopback(bindHost)) return;
  if (allowUnsafe) return;
  error(UNSAFE_MESSAGE);
  exit(1);
}
