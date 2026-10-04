import {
  type OverlayPoint,
  TerminalSelectionOverlay,
  type TerminalSelectionOverlayProps,
} from "./TerminalSelectionOverlay.js";
import type { SelectionOverlayLayout } from "./terminal-selection-layout.js";

export function TerminalSelectionOverlays({
  selectionLayout,
  selectionDraggingHandle,
  inputToolbarPosition,
  externalCopyOpen,
  onHandlePointerDown,
  onCopy,
  onCopyLongPress,
  onPaste,
  onActionEvent,
}: {
  selectionLayout: SelectionOverlayLayout | null;
  selectionDraggingHandle: TerminalSelectionOverlayProps["draggingHandle"];
  inputToolbarPosition: OverlayPoint | null;
  externalCopyOpen: boolean;
  onHandlePointerDown: TerminalSelectionOverlayProps["onHandlePointerDown"];
  onCopy: () => void;
  onCopyLongPress: () => void;
  onPaste: () => void;
  onActionEvent: TerminalSelectionOverlayProps["onActionEvent"];
}) {
  return (
    <>
      {selectionLayout && !externalCopyOpen && (
        <TerminalSelectionOverlay
          startHandle={selectionLayout.startHandle}
          endHandle={selectionLayout.endHandle}
          toolbar={selectionLayout.toolbar}
          draggingHandle={selectionDraggingHandle}
          onHandlePointerDown={onHandlePointerDown}
          onCopy={onCopy}
          onCopyLongPress={onCopyLongPress}
          onPaste={onPaste}
          onActionEvent={onActionEvent}
          pasteEnabled={false}
        />
      )}
      {inputToolbarPosition && (
        <TerminalSelectionOverlay
          startHandle={null}
          endHandle={null}
          toolbar={inputToolbarPosition}
          draggingHandle={null}
          copyEnabled={false}
          onHandlePointerDown={onHandlePointerDown}
          onCopy={onCopy}
          onPaste={onPaste}
          onActionEvent={onActionEvent}
        />
      )}
    </>
  );
}
