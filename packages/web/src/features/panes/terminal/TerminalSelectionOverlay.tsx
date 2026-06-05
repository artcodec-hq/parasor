import {
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
  useRef,
} from "react";

export type TerminalSelectionHandle = "start" | "end";
export type TerminalSelectionAction = "copy" | "paste";

export interface OverlayPoint {
  left: number;
  top: number;
}

export interface TerminalSelectionOverlayProps {
  startHandle: OverlayPoint | null;
  endHandle: OverlayPoint | null;
  toolbar: OverlayPoint | null;
  draggingHandle: TerminalSelectionHandle | null;
  copyEnabled?: boolean;
  pasteEnabled?: boolean;
  onHandlePointerDown: (
    handle: TerminalSelectionHandle,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  onCopy: () => void;
  onPaste: () => void;
  onActionEvent?: (input: {
    action: TerminalSelectionAction;
    eventType: string;
    deduped: boolean;
  }) => void;
}

const HANDLE_BASE =
  "absolute z-30 flex h-11 w-11 items-center justify-center rounded-full touch-none";
const HANDLE_DOT =
  "h-[22px] w-[22px] rounded-full border-2 border-bg-terminal bg-accent shadow-lg";

export function TerminalSelectionOverlay({
  startHandle,
  endHandle,
  toolbar,
  draggingHandle,
  copyEnabled = true,
  pasteEnabled = true,
  onHandlePointerDown,
  onCopy,
  onPaste,
  onActionEvent,
}: TerminalSelectionOverlayProps) {
  const lastActionAtRef = useRef(Number.NEGATIVE_INFINITY);
  const stopToolbarStart = (
    event:
      | PointerEvent<HTMLButtonElement>
      | TouchEvent<HTMLButtonElement>
      | MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
  };
  const runToolbarAction = (
    event:
      | PointerEvent<HTMLButtonElement>
      | TouchEvent<HTMLButtonElement>
      | MouseEvent<HTMLButtonElement>,
    actionName: TerminalSelectionAction,
    action: () => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();

    const now = performance.now();
    const deduped = now - lastActionAtRef.current < 500;
    onActionEvent?.({
      action: actionName,
      eventType: event.type,
      deduped,
    });
    if (deduped) {
      return;
    }
    lastActionAtRef.current = now;
    action();
  };

  return (
    <>
      {startHandle && (
        <button
          type="button"
          aria-label="Adjust selection start"
          className={HANDLE_BASE}
          style={{
            left: startHandle.left,
            top: startHandle.top,
            transform: "translate(-50%, -50%)",
          }}
          onPointerDown={(event) => onHandlePointerDown("start", event)}
        >
          <span aria-hidden className={HANDLE_DOT} />
        </button>
      )}
      {endHandle && (
        <button
          type="button"
          aria-label="Adjust selection end"
          className={HANDLE_BASE}
          style={{
            left: endHandle.left,
            top: endHandle.top,
            transform: "translate(-50%, -50%)",
          }}
          onPointerDown={(event) => onHandlePointerDown("end", event)}
        >
          <span aria-hidden className={HANDLE_DOT} />
        </button>
      )}
      {toolbar && !draggingHandle && (copyEnabled || pasteEnabled) && (
        <div
          role="toolbar"
          aria-label="Terminal selection actions"
          className="absolute z-30 flex h-10 overflow-hidden rounded-control border border-border bg-bg-secondary/95 text-sm text-text-primary shadow-lg backdrop-blur"
          style={{
            left: toolbar.left,
            top: toolbar.top,
          }}
        >
          {copyEnabled && (
            <>
              <button
                type="button"
                aria-label="Copy terminal selection"
                className="flex h-full items-center px-3 active:bg-row-hover-bg"
                onPointerDown={stopToolbarStart}
                onTouchStart={stopToolbarStart}
                onMouseDown={stopToolbarStart}
                onTouchEnd={(event) => runToolbarAction(event, "copy", onCopy)}
                onPointerUp={(event) => runToolbarAction(event, "copy", onCopy)}
                onClick={(event) => runToolbarAction(event, "copy", onCopy)}
              >
                Copy
              </button>
              {pasteEnabled && (
                <div aria-hidden className="h-full w-px bg-border" />
              )}
            </>
          )}
          {pasteEnabled && (
            <button
              type="button"
              aria-label="Paste into terminal"
              className="flex h-full items-center px-3 active:bg-row-hover-bg"
              onPointerDown={stopToolbarStart}
              onTouchStart={stopToolbarStart}
              onMouseDown={stopToolbarStart}
              onTouchEnd={(event) => runToolbarAction(event, "paste", onPaste)}
              onPointerUp={(event) => runToolbarAction(event, "paste", onPaste)}
              onClick={(event) => runToolbarAction(event, "paste", onPaste)}
            >
              Paste
            </button>
          )}
        </div>
      )}
    </>
  );
}
