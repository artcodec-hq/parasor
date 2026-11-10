import type { IdeCommandConfig, PaneCommandConfig } from "@parasor/shared";
import { useCallback, useMemo } from "react";
import {
  type CustomPaneCommand,
  PANE_COMMANDS_STORAGE_KEY,
  paneCommandsWithBuiltins,
} from "../../lib/pane-command-store.js";
import { saveIdeCommands, savePaneCommands } from "./command-api.js";
import { useLegacyPaneCommandsMigration } from "./useLegacyPaneCommandsMigration.js";

interface UseWorkspaceCommandConfigOptions {
  hydrated: boolean;
  ideCommands: IdeCommandConfig[];
  paneCommands: PaneCommandConfig[];
  seedIdeCommands: (commands: IdeCommandConfig[]) => void;
  seedPaneCommands: (commands: PaneCommandConfig[]) => void;
  setErrorToast: (message: string) => void;
}

export function useWorkspaceCommandConfig({
  hydrated,
  ideCommands,
  paneCommands,
  seedIdeCommands,
  seedPaneCommands,
  setErrorToast,
}: UseWorkspaceCommandConfigOptions) {
  const commandsWithBuiltins = useMemo(
    () => paneCommandsWithBuiltins(paneCommands),
    [paneCommands],
  );

  const updateCustomPaneCommands = useCallback(
    (commands: CustomPaneCommand[]) => {
      const previous = paneCommands;
      seedPaneCommands(commands);
      void savePaneCommands(commands)
        .then((body) => {
          if (Array.isArray(body.commands)) {
            seedPaneCommands(body.commands);
          }
          try {
            window.localStorage.removeItem(PANE_COMMANDS_STORAGE_KEY);
          } catch {
            // localStorage unavailable; server state is already authoritative.
          }
        })
        .catch(() => {
          seedPaneCommands(previous);
          setErrorToast("Failed to save terminal commands");
        });
    },
    [paneCommands, seedPaneCommands, setErrorToast],
  );

  const updateCustomIdeCommands = useCallback(
    (commands: IdeCommandConfig[]) => {
      const previous = ideCommands;
      seedIdeCommands(commands);
      void saveIdeCommands(commands)
        .then((body) => {
          if (Array.isArray(body.commands)) {
            seedIdeCommands(body.commands);
          }
        })
        .catch(() => {
          seedIdeCommands(previous);
          setErrorToast("Failed to save IDE commands");
        });
    },
    [ideCommands, seedIdeCommands, setErrorToast],
  );

  useLegacyPaneCommandsMigration({
    hydrated,
    paneCommandsCount: paneCommands.length,
    onMigrate: updateCustomPaneCommands,
  });

  return {
    paneCommands: commandsWithBuiltins,
    updateCustomIdeCommands,
    updateCustomPaneCommands,
  };
}
