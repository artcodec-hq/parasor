import { PaGlyph } from "../../primitives/index.js";
import type { SidebarChild } from "../model/types.js";
import { browserPaneRenderer } from "./browser.js";
import { terminalPaneRenderer } from "./terminal.js";
import type { PaneDescriptor, PaneRenderer } from "./types.js";

/**
 * Order matters -- first matcher wins. Add new pane kinds by appending a
 * `PaneRenderer` here; `describePane` falls through to a generic terminal
 * glyph when nothing claims the child.
 */
const RENDERERS: PaneRenderer[] = [terminalPaneRenderer, browserPaneRenderer];

const FALLBACK: PaneDescriptor = { defaultIcon: PaGlyph.terminal };

export function describePane(child: SidebarChild): PaneDescriptor {
  for (const renderer of RENDERERS) {
    const descriptor = renderer(child);
    if (descriptor) return descriptor;
  }
  return FALLBACK;
}
