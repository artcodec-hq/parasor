import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

function getFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Dialog focus trap (WCAG 2.1 SC 2.1.2). When `active` flips true, captures
 * the previously focused element; on deactivation restores focus to it.
 * While active, Tab cycles within `rootRef`'s focusable descendants so
 * keyboard / AT users cannot escape the modal into the background page.
 *
 * Esc handling stays with the dialog component -- this hook owns Tab + focus
 * restoration only, so existing arrow / Enter logic is untouched.
 */
export function useFocusTrap(
  active: boolean,
  rootRef: RefObject<HTMLElement | null>,
): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      // StrictMode runs the effect mount->cleanup->mount, and the parent may
      // have unmounted the trigger between cleanup runs -- focusing a detached
      // node is silently a no-op but pollutes test traces, so guard.
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const focusables = getFocusables(root);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, rootRef]);
}
