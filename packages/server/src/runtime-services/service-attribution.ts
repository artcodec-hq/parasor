import path from "node:path";
import type {
  RuntimeServiceAttribution,
  RuntimeServiceProtocol,
} from "@parasor/shared";

export interface RuntimeServiceWorktreeProbe {
  projectId: string;
  path: string;
}

export interface RuntimeServiceAttributionInput {
  projectId: string;
  sessionId?: string;
  sessionCwd?: string;
  processCwd?: string;
  commandLine?: string;
  worktrees: RuntimeServiceWorktreeProbe[];
}

const HTTP_PORTS = new Set([
  80, 3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888,
]);
const HTTPS_PORTS = new Set([443, 8443]);

export function inferRuntimeServiceProtocol(
  port: number,
): RuntimeServiceProtocol {
  if (HTTPS_PORTS.has(port)) return "https";
  if (HTTP_PORTS.has(port)) return "http";
  return "unknown";
}

export function connectHostForBindHost(host: string): string {
  if (
    host === "*" ||
    host === "" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "[::]"
  ) {
    return "localhost";
  }
  return host.replace(/^\[|\]$/g, "");
}

export function bindsAllForHost(host: string): boolean {
  return (
    host === "*" ||
    host === "" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "[::]"
  );
}

export function attributeRuntimeService(
  input: RuntimeServiceAttributionInput,
): RuntimeServiceAttribution {
  const normalizedWorktrees = input.worktrees
    .filter((worktree) => worktree.path.trim() !== "")
    .map((worktree) => ({
      worktree,
      normalizedPath: normalizeComparablePath(worktree.path),
    }));

  if (input.sessionId) {
    const match = pickDeepestMatching(normalizedWorktrees, input.sessionCwd);
    return {
      source: "session-process-tree",
      confidence: "high",
      projectId: input.projectId,
      ...(match ? { worktreePath: match.worktree.path } : {}),
      sessionId: input.sessionId,
    };
  }

  const cwdMatch = pickDeepestMatching(normalizedWorktrees, input.processCwd);
  if (cwdMatch) {
    return {
      source: "process-cwd",
      confidence: "high",
      projectId: input.projectId,
      worktreePath: cwdMatch.worktree.path,
    };
  }

  const commandLine = input.commandLine
    ? normalizeComparableText(input.commandLine)
    : null;
  if (commandLine) {
    const commandMatch = pickDeepestCommandLineMatch(
      normalizedWorktrees,
      commandLine,
    );
    if (commandMatch) {
      return {
        source: "command-line",
        confidence: "medium",
        projectId: input.projectId,
        worktreePath: commandMatch.worktree.path,
      };
    }
  }

  return {
    source: "project",
    confidence: "low",
    projectId: input.projectId,
  };
}

function pickDeepestMatching(
  candidates: Array<{
    worktree: RuntimeServiceWorktreeProbe;
    normalizedPath: string;
  }>,
  inputPath: string | undefined,
) {
  if (!inputPath) return undefined;
  const normalizedInput = normalizeComparablePath(inputPath);
  let best:
    | { worktree: RuntimeServiceWorktreeProbe; normalizedPath: string }
    | undefined;
  for (const candidate of candidates) {
    if (!isSameOrDescendant(normalizedInput, candidate.normalizedPath)) {
      continue;
    }
    if (!best || candidate.normalizedPath.length > best.normalizedPath.length) {
      best = candidate;
    }
  }
  return best;
}

function pickDeepestCommandLineMatch(
  candidates: Array<{
    worktree: RuntimeServiceWorktreeProbe;
    normalizedPath: string;
  }>,
  commandLine: string,
) {
  let best:
    | { worktree: RuntimeServiceWorktreeProbe; normalizedPath: string }
    | undefined;
  for (const candidate of candidates) {
    if (!includesPathBoundary(commandLine, candidate.normalizedPath)) continue;
    if (!best || candidate.normalizedPath.length > best.normalizedPath.length) {
      best = candidate;
    }
  }
  return best;
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

export function includesPathBoundary(
  commandLine: string,
  normalizedPath: string,
): boolean {
  let index = commandLine.indexOf(normalizedPath);
  while (index !== -1) {
    const before = index === 0 ? "" : commandLine[index - 1];
    const after = commandLine[index + normalizedPath.length] ?? "";
    const startsOnBoundary = before === "" || /\s|["'=]/.test(before);
    const endsOnBoundary = after === "" || /[\s"'/:]/.test(after);
    if (startsOnBoundary && endsOnBoundary) return true;
    index = commandLine.indexOf(normalizedPath, index + normalizedPath.length);
  }
  return false;
}

export function normalizeComparablePath(input: string): string {
  return normalizeComparableText(path.resolve(input));
}

function normalizeComparableText(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
