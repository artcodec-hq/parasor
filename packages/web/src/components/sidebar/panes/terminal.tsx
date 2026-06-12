import { PaGlyph } from "../../primitives/index.js";
import type { PaneRenderer } from "./types.js";

/**
 * Terminal pane renderer. Agent runtimes use the agent glyph, generic shells
 * use `circle-chevron-right`.
 */
export const terminalPaneRenderer: PaneRenderer = (child) => {
  if (child.kind !== "terminal") return undefined;
  if (child.agentType) {
    return { defaultIcon: PaGlyph.agent };
  }
  return { defaultIcon: PaGlyph.terminal };
};
