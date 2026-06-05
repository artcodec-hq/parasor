import type { Session } from "@parasor/shared";

export function displayTitleForTerminal(
  session: Session | undefined,
  fallback = "terminal",
): string {
  if (!session) return fallback;
  const explicit = session.title?.trim();
  if (explicit) return explicit;
  if (session.command?.type === "claude") return "claude";
  if (session.command?.type === "custom") return session.command.command;
  return session.shell.split("/").pop() ?? "shell";
}
