import type { ComponentType, SVGProps } from "react";

/**
 * Per-pane-kind rendering hints. Status overrides (working/attention) are
 * applied by `ChildRow` on top of `defaultIcon`, so each pane only needs to
 * declare its idle visual.
 */
export interface PaneDescriptor {
  defaultIcon: ComponentType<SVGProps<SVGSVGElement>>;
}
