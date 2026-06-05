import type { IdeCommandConfig } from "@parasor/shared";
import { authFetch } from "../../lib/auth-fetch.js";
import type { CustomPaneCommand } from "../../lib/pane-command-store.js";

export async function savePaneCommands(
  commands: CustomPaneCommand[],
): Promise<{ commands?: CustomPaneCommand[] }> {
  const res = await authFetch("/api/pane-commands", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  if (!res.ok) throw new Error("Failed to save commands");
  return (await res.json()) as { commands?: CustomPaneCommand[] };
}

export async function saveIdeCommands(
  commands: IdeCommandConfig[],
): Promise<{ commands?: IdeCommandConfig[] }> {
  const res = await authFetch("/api/ide-commands", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  if (!res.ok) throw new Error("Failed to save IDE commands");
  return (await res.json()) as { commands?: IdeCommandConfig[] };
}
