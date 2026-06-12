import type { Session } from "@parasor/shared";
import {
  isKnownAgentProcess,
  matchesTrustedLaunchRuntime,
} from "./runtime-registry.js";

export function shouldObserveAgentOutput(
  session: Session | undefined,
  foregroundProcess: string | null,
): boolean {
  if (!session) return false;
  if (session.command.type === "claude") return true;
  if (matchesTrustedLaunchRuntime(session, foregroundProcess)) return true;
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
