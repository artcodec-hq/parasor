import { useEffect } from "react";
import {
  type PaneFocusFn,
  registerPaneFocus,
} from "../lib/pane-focus-registry.js";

export function usePaneFocusHandler(
  paneId: string | null | undefined,
  fn: PaneFocusFn,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!paneId || !enabled) return;
    return registerPaneFocus(paneId, fn);
  }, [paneId, fn, enabled]);
}
