import { useEffect, useRef } from "react";
import {
  type CustomPaneCommand,
  loadPaneCommands,
} from "../../lib/pane-command-store.js";

interface UseLegacyPaneCommandsMigrationInput {
  /** `true` once the event-socket store has hydrated; the migration must
   * wait so that an empty `paneCommandsCount` reflects "server has no
   * commands" rather than "we haven't received them yet". */
  hydrated: boolean;
  /** Current server-side pane-command count. Migration only runs while
   * this is `0` -- once any command exists (server or migration result)
   * the legacy localStorage payload is intentionally ignored. */
  paneCommandsCount: number;
  /** Invoked exactly once, with the legacy commands recovered from
   * localStorage, when migration succeeds with at least one entry. */
  onMigrate: (commands: CustomPaneCommand[]) => void;
}

/**
 * One-shot legacy `localStorage` pane-command migration. Runs once per
 * mount when (a) the event socket has hydrated and (b) the server has
 * no pane commands. The "attempted" ref prevents a second run even if
 * the migration itself fails or recovers an empty array. Mirrors the
 * inline implementation that previously lived in `App.tsx`.
 *
 * No return value -- the hook is a side-effect-only effect. The caller
 * supplies `onMigrate` so the hook stays independent of the event-socket
 * mutation API (`store.seedPaneCommands` / `updateCustomPaneCommands`).
 */
export function useLegacyPaneCommandsMigration({
  hydrated,
  paneCommandsCount,
  onMigrate,
}: UseLegacyPaneCommandsMigrationInput): void {
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (attemptedRef.current || !hydrated || paneCommandsCount > 0) {
      return;
    }
    attemptedRef.current = true;
    let legacyCommands: CustomPaneCommand[] = [];
    try {
      legacyCommands = loadPaneCommands(window.localStorage);
    } catch {
      return;
    }
    if (legacyCommands.length > 0) {
      onMigrate(legacyCommands);
    }
  }, [hydrated, paneCommandsCount, onMigrate]);
}
