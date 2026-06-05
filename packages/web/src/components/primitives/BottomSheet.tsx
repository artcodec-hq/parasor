import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface BottomSheetProps {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  /** Extra classes for the sheet panel. */
  panelClassName?: string;
  /** Extra classes for the content wrapper below the drag handle. */
  contentClassName?: string;
  /** Allow scrim tap dismissal. Default true. */
  closeOnScrim?: boolean;
  /** Allow Escape dismissal. Default true. */
  closeOnEscape?: boolean;
  /** Show drag handle and accept swipe-down dismiss on it. Default true. */
  dragHandle?: boolean;
  /** Capture/restore focus and trap Tab while open. Default true. */
  manageFocus?: boolean;
  /** Accessible label for the dialog. */
  ariaLabel?: string;
  /** ID of an element labelling the dialog. */
  ariaLabelledBy?: string;
  /** ARIA role for modal sheet semantics. Default dialog. */
  dialogRole?: "alertdialog" | "dialog";
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

function getFocusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Modal bottom sheet. Slides up from the bottom over a scrim, dismissed via
 * scrim tap, swipe-down on the drag handle, or ESC. Always rendered in the
 * DOM (gated by aria-hidden + inert) so open/close transitions remain smooth.
 *
 * Layout owns its own portal at document.body so it composes regardless of
 * the caller's stacking context.
 */
export function BottomSheet({
  open,
  onDismiss,
  children,
  panelClassName = "",
  contentClassName = "",
  closeOnScrim = true,
  closeOnEscape = true,
  dragHandle = true,
  manageFocus = true,
  ariaLabel,
  ariaLabelledBy,
  dialogRole = "dialog",
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => {
      window.cancelAnimationFrame(frame);
      setEntered(false);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDragOffset(0);
      setDragging(false);
      return;
    }
    if (!manageFocus) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const handle = window.requestAnimationFrame(() => {
      const focusables = getFocusables(sheetRef.current);
      focusables[0]?.focus();
    });
    return () => {
      window.cancelAnimationFrame(handle);
      previousFocusRef.current?.focus?.();
    };
  }, [open, manageFocus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!closeOnEscape) return;
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        return;
      }
      if (e.key !== "Tab") return;
      if (!manageFocus) return;
      const focusables = getFocusables(sheetRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (
        e.shiftKey &&
        (active === first || !sheetRef.current?.contains(active))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeOnEscape, open, onDismiss, manageFocus]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    dragStartYRef.current = e.touches[0].clientY;
    setDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartYRef.current == null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - dragStartYRef.current;
    setDragOffset(Math.max(0, dy));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragStartYRef.current == null) return;
    const dy = dragOffset;
    dragStartYRef.current = null;
    setDragging(false);
    const sheetHeight = sheetRef.current?.getBoundingClientRect().height ?? 0;
    const threshold = Math.max(80, sheetHeight * 0.25);
    if (dy > threshold && closeOnScrim) {
      onDismiss();
    } else {
      setDragOffset(0);
    }
  }, [closeOnScrim, dragOffset, onDismiss]);

  const transform =
    open && entered ? `translateY(${dragOffset}px)` : "translateY(100%)";
  const transition = dragging
    ? "none"
    : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
  const panelShadow = open
    ? "shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
    : "shadow-none";

  const node = (
    <div
      aria-hidden={!open}
      inert={!open || undefined}
      className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim click is a backdrop dismissal affordance. */}
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-200 motion-reduce:transition-none ${
          open && entered ? "opacity-100" : "opacity-0"
        }`}
        onClick={closeOnScrim ? onDismiss : undefined}
        role="presentation"
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is constrained to dialog/alertdialog. */}
      <div
        ref={sheetRef}
        role={dialogRole}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        style={{ transform, transition }}
        className={`absolute right-0 bottom-0 left-0 max-h-[80vh] w-full max-w-full overflow-hidden rounded-t-xl border-t border-border bg-bg-secondary ${panelShadow} ${panelClassName}`}
      >
        {dragHandle && (
          <div
            className="flex cursor-grab justify-center pt-2 pb-1 select-none touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <div className="h-1 w-10 rounded-tag bg-border" />
          </div>
        )}
        <div
          className={`max-h-[calc(80vh-1.5rem)] w-full min-w-0 overflow-x-hidden overflow-y-auto pb-[env(safe-area-inset-bottom)] ${contentClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
