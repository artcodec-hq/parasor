import type { ReactNode } from "react";
import { type ActionItem, FloatingActionMenu } from "./ActionMenu.js";

export type PaMenuItem = ActionItem;

interface PaMenuProps {
  items: PaMenuItem[];
  align?: "start" | "end";
  /**
   * `bottom` (default) drops the panel below the trigger; `top` flips it
   * above. Use `top` for footer-anchored triggers so the panel doesn't spill
   * off-screen.
   */
  placement?: "top" | "bottom";
  renderTrigger: (props: {
    open: boolean;
    toggle: () => void;
    triggerRef: (el: HTMLButtonElement | null) => void;
    menuId: string;
  }) => ReactNode;
}

/**
 * Compatibility wrapper for older header/footer dropdowns. New menu surfaces
 * should use `FloatingActionMenu`, `ActionSheet`, and `ActionList` directly.
 */
export function PaMenu({
  items,
  align = "end",
  placement = "bottom",
  renderTrigger,
}: PaMenuProps) {
  return (
    <FloatingActionMenu
      items={items}
      align={align}
      placement={placement}
      renderTrigger={renderTrigger}
    />
  );
}
