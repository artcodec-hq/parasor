import { basename } from "node:path";
import type { Session } from "@parasor/shared";

const AGENT_PROCESS_NAMES = new Set([
  "claude",
  "codex",
  "opencode",
  "gemini",
  "gemini-cli",
]);

function normalizeProcessName(value: string): string {
  return basename(value).trim().toLowerCase();
}

function isKnownAgentProcess(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeProcessName(value);
  if (AGENT_PROCESS_NAMES.has(normalized)) return true;
  for (const name of AGENT_PROCESS_NAMES) {
    if (normalized.startsWith(`${name}-`)) return true;
  }
  return false;
}

export function shouldObserveAgentOutput(
  session: Session | undefined,
  foregroundProcess: string | null,
): boolean {
  if (!session) return false;
  if (session.command.type === "claude") return true;
  if (session.command.type === "shell") return false;
  if (
    session.command.type === "custom" &&
    isKnownAgentProcess(session.command.command)
  ) {
    return true;
  }
  if (isKnownAgentProcess(foregroundProcess)) return true;
  return false;
}
