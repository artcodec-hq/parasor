import type { ComponentType, SVGProps } from "react";
import type { SidebarChild } from "../model/types.js";

/**
 * Per-pane-kind rendering hints. Status overrides (working/attention) are
 * applied by `ChildRow` on top of `defaultIcon`, so each pane only needs to
 * declare its idle visual.
 */
export interface PaneDescriptor {
  defaultIcon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * A renderer claims responsibility for a child by returning a descriptor;
 * returning `undefined` lets the registry try the next renderer. Order in
 * `pane-registry.ts` is the matching order.
 */
export type PaneRenderer = (child: SidebarChild) => PaneDescriptor | undefined;
