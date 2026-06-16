import type { Session } from "@parasor/shared";
import {
  isKnownAgentProcess,
  matchesTrustedLaunchRuntime,
  trustedLaunchRuntimeHint,
} from "./runtime-registry.js";

export function shouldObserveAgentOutput(
  session: Session | undefined,
  foregroundProcess: string | null,
): boolean {
  if (!session) return false;
  if (session.command.type === "claude") return false;
  const trustedHint = trustedLaunchRuntimeHint(session);
  if (trustedHint?.tier === "native-managed") return false;
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

export function shouldAllowManualAgentOutputFallback(
  session: Session | undefined,
): boolean {
  if (!session) return false;
  if (session.command.type === "claude") return false;
  return trustedLaunchRuntimeHint(session)?.tier !== "native-managed";
}
