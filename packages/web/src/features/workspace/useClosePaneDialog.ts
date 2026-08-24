import { useCallback, useState } from "react";

export interface ClosePaneTarget {
  paneId: string;
  paneKind: "terminal" | "browser";
  title: string;
}

export interface ClosePaneDialogControl {
  /** Currently pending close target, or `null` when the dialog is hidden. */
  target: ClosePaneTarget | null;
  /** Open the confirm dialog for a pane. */
  request: (
    paneId: string,
    paneKind: "terminal" | "browser",
    title: string,
  ) => void;
  /** Dismiss the dialog without closing the pane (user clicked Cancel). */
  cancel: () => void;
  /** Confirm path: clears the dialog first, then yields the target to the
   * caller-supplied {@link onConfirm} for the actual close + route handling.
   * Returns a Promise so the JSX call site can `await` it. No-op when the
   * dialog is already hidden (defensive against double-fire). */
  confirm: () => Promise<void>;
}

interface UseClosePaneDialogInput {
  /** Performs the actual close (and any route side-effects). Invoked with
   * the captured target *after* the dialog has been hidden so the next
   * render does not show a stale target during the async close. */
  onConfirm: (target: ClosePaneTarget) => Promise<void> | void;
}

/**
 * Confirm-before-close dialog state for terminal / browser panes. Owns the
 * pending {@link ClosePaneTarget} and the request/cancel/confirm trio.
 *
 * Routing side-effects (e.g. `navigate({ kind: "root" })` when the user is
 * confirming a close on the currently routed pane) live in the caller's
 * {@link UseClosePaneDialogInput.onConfirm} -- the hook stays unaware of
 * the workspace route. Mirrors the existing inline implementation at
 * `App.tsx`'s `handleRequestClosePane` / `handleConfirmClosePane`.
 */
export function useClosePaneDialog({
  onConfirm,
}: UseClosePaneDialogInput): ClosePaneDialogControl {
  const [target, setTarget] = useState<ClosePaneTarget | null>(null);

  const request = useCallback(
    (paneId: string, paneKind: "terminal" | "browser", title: string) => {
      setTarget({ paneId, paneKind, title });
    },
    [],
  );

  const cancel = useCallback(() => {
    setTarget(null);
  }, []);

  const confirm = useCallback(async () => {
    const captured = target;
    if (!captured) return;
    setTarget(null);
    await onConfirm(captured);
  }, [target, onConfirm]);

  return { target, request, cancel, confirm };
}
