import { PaGlyph } from "../../primitives/index.js";
import type { PaneRenderer } from "./types.js";

/**
 * Terminal pane renderer. Claudecode terminals use `message-circle`, generic
 * shells use `circle-chevron-right`. Future agent runtimes (codex, aider, …)
 * branch here on `agentType`.
 */
export const terminalPaneRenderer: PaneRenderer = (child) => {
  if (child.kind !== "terminal") return undefined;
  if (child.agentType === "claude") {
    return { defaultIcon: PaGlyph.agent };
  }
  return { defaultIcon: PaGlyph.terminal };
};
