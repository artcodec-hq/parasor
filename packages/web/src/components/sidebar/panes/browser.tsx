import { PaGlyph } from "../../primitives/index.js";
import type { PaneRenderer } from "./types.js";

export const browserPaneRenderer: PaneRenderer = (child) => {
  if (child.kind !== "browser") return undefined;
  return { defaultIcon: PaGlyph.browser };
};
