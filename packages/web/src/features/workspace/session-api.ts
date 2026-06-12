import type {
  Session,
  SessionCommand,
  SessionLaunchPreset,
} from "@parasor/shared";
import { authFetch } from "../../lib/auth-fetch.js";

export interface CreateSessionInput {
  projectId: string;
  command?: SessionCommand;
  title?: string;
  cwd?: string;
  launchPreset?: SessionLaunchPreset;
  bootstrapInput?: string;
}

/**
 * Creates a session. Returns the parsed {@link Session} on success, or `null`
 * when the server responds non-ok (mirroring App.tsx's `if (!res.ok) return`
 * skip so the caller can short-circuit optimistic seeding).
 */
export async function createSession(
  input: CreateSessionInput,
): Promise<Session | null> {
  const res = await authFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      ...(input.command && { command: input.command }),
      ...(input.title && { title: input.title }),
      ...(input.cwd && { cwd: input.cwd }),
      ...(input.launchPreset && { launchPreset: input.launchPreset }),
      ...(input.bootstrapInput && { bootstrapInput: input.bootstrapInput }),
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Session;
}

export async function restartSession(sessionId: string): Promise<void> {
  await authFetch(`/api/sessions/${sessionId}/restart`, { method: "POST" });
}

export async function renameSession(
  sessionId: string,
  title: string,
): Promise<void> {
  await authFetch(`/api/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function setSessionPin(
  sessionId: string,
  pinned: boolean,
): Promise<void> {
  await authFetch(`/api/sessions/${sessionId}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await authFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
}
