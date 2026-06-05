import { useEffect } from "react";

/**
 * Prevent the browser's default "navigate to dropped file" behaviour so a
 * stray drop outside the Terminal pane does not replace the parasor app
 * with the contents of the dropped file.
 *
 * Handlers are attached at the window level in the bubble phase: pane-local
 * listeners that call `preventDefault()` first (e.g. the Terminal drop
 * handler) still win because this guard bails out when `defaultPrevented`
 * is already true.
 */
export function useGlobalDropGuard(): void {
  useEffect(() => {
    const handler = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const dt = (event as DragEvent).dataTransfer;
      if (dt) dt.dropEffect = "none";
    };

    window.addEventListener("dragover", handler);
    window.addEventListener("drop", handler);
    return () => {
      window.removeEventListener("dragover", handler);
      window.removeEventListener("drop", handler);
    };
  }, []);
}
