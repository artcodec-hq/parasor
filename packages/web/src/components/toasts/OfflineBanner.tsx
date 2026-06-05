import { useEffect, useRef, useState } from "react";
import { DialogButton, DialogFooter, DialogRoot } from "../primitives/index.js";

const SHOW_DELAY_MS = 5000;

/*
 * When the WebSocket stays disconnected past the grace window, render a
 * full-screen modal that blocks all interaction with the cached UI behind
 * it. Focus is trapped inside the dialog and keyboard events on the rest
 * of the document are swallowed so destructive mutations (Ctrl+Enter,
 * shortcuts, context menu) cannot fire against a server that may already
 * have moved port, crashed, or restarted into a fresh state.
 * 4px err-tone bar + uppercase tag + title + body + primary action.
 */
export function OfflineBanner({ connected }: { connected: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  if (!visible) return null;

  return <OfflineDialog />;
}

interface OfflineDialogProps {
  onReload?: () => void;
}

export function OfflineDialog({
  onReload = () => window.location.reload(),
}: OfflineDialogProps) {
  const reloadRef = useRef<HTMLButtonElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    priorFocusRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    reloadRef.current?.focus();

    const blockKey = (e: KeyboardEvent) => {
      const reload = reloadRef.current;
      const onReload =
        !!reload && e.target instanceof Node && reload.contains(e.target);
      if (onReload) {
        if (e.key === "Tab") {
          e.preventDefault();
          return;
        }
        const bareActivate =
          (e.key === "Enter" || e.key === " ") &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.shiftKey;
        if (bareActivate) return;
      }
      e.stopPropagation();
      e.preventDefault();
    };

    document.addEventListener("keydown", blockKey, true);
    document.addEventListener("keyup", blockKey, true);

    return () => {
      document.removeEventListener("keydown", blockKey, true);
      document.removeEventListener("keyup", blockKey, true);
      const prior = priorFocusRef.current;
      priorFocusRef.current = null;
      if (
        prior &&
        document.contains(prior) &&
        typeof prior.focus === "function"
      ) {
        prior.focus();
      }
    };
  }, []);

  return (
    <DialogRoot
      open={true}
      ariaLabelledBy="offline-title"
      dialogRole="alertdialog"
      onClose={() => undefined}
      closeOnBackdrop={false}
      closeOnEscape={false}
      backdropClassName="bg-black/50 p-6 backdrop-blur-sm"
      widthClassName="w-surface-sm max-w-full"
      panelClassName="flex flex-col overflow-hidden"
      panelTabIndex={-1}
      onPanelContextMenu={(e) => e.preventDefault()}
    >
      <div aria-hidden className="h-1 shrink-0 bg-danger" />
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <span className="cm-mono self-start text-xs font-bold uppercase tracking-[0.08em] text-danger">
          OFFLINE
        </span>
        <h2
          id="offline-title"
          className="text-sm font-semibold text-text-primary"
        >
          Connection lost
        </h2>
        <p className="text-sm leading-[1.55] text-text-secondary">
          Trying to reconnect…
        </p>
        <DialogFooter>
          <DialogButton ref={reloadRef} variant="primary" onClick={onReload}>
            Reload
          </DialogButton>
        </DialogFooter>
      </div>
    </DialogRoot>
  );
}
