import { useCallback, useEffect, useState } from "react";

interface UseSidebarSearchInput {
  /** Whether the layout is in the mobile breakpoint. Drives the Cmd-K open
   * side-effect -- on mobile, opening the sidebar search also pops the
   * sidebar drawer (the original code's `navigate({ kind: "root" })`). */
  isMobile: boolean;
  /** Called when the Cmd-K shortcut opens the search panel on mobile, so
   * the caller can route the sidebar drawer into view. Not invoked when
   * the user toggles via the button (`toggle`) -- only the keyboard
   * shortcut carries the mobile drawer side-effect. */
  onMobileOpenShortcut?: () => void;
}

export interface SidebarSearchControl {
  open: boolean;
  query: string;
  setQuery: (next: string) => void;
  /** Button-driven toggle -- open without the mobile drawer side-effect,
   * close clears the query. */
  toggle: () => void;
  /** Force-close + clear query (e.g. on result selection). */
  close: () => void;
}

/**
 * Sidebar search panel state -- open/closed + query string -- plus the global
 * Cmd/Ctrl+K shortcut. Extracted verbatim from `App.tsx`. The shortcut
 * listener inverts the open state and clears the query on close, mirroring
 * the original inline effect's branches.
 */
export function useSidebarSearch({
  isMobile,
  onMobileOpenShortcut,
}: UseSidebarSearchInput): SidebarSearchControl {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "k") return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      setOpen((prev) => {
        if (prev) {
          setQuery("");
          return false;
        }
        if (isMobile) onMobileOpenShortcut?.();
        return true;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, onMobileOpenShortcut]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (prev) {
        setQuery("");
        return false;
      }
      return true;
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  return { open, query, setQuery, toggle, close };
}
