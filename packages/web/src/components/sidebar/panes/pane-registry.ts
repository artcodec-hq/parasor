import { getPaneModule } from "../../../features/panes/pane-module-registry.js";
import { PaGlyph } from "../../primitives/index.js";
import type { SidebarChild } from "../model/types.js";
import type { PaneDescriptor } from "./types.js";

const FALLBACK: PaneDescriptor = { defaultIcon: PaGlyph.terminal };

export function describePane(child: SidebarChild): PaneDescriptor {
  return getPaneModule(child.kind).describeSidebar?.(child) ?? FALLBACK;
}
