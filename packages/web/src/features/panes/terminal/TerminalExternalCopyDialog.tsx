import { useEffect, useRef, useState } from "react";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
} from "../../../components/primitives/index.js";

export interface TerminalExternalCopyDialogProps {
  open: boolean;
  text: string;
  isMobile: boolean;
  onClose: () => void;
  onCopy: (text: string) => Promise<boolean>;
}

export function TerminalExternalCopyDialog({
  open,
  text,
  isMobile,
  onClose,
  onCopy,
}: TerminalExternalCopyDialogProps) {
  const [draftText, setDraftText] = useState(text);
  const [acceptTextPointer, setAcceptTextPointer] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftText(text);
    setAcceptTextPointer(false);
    let settled = false;
    let frame = 0;
    const settle = () => {
      if (settled) return;
      settled = true;
      frame = requestAnimationFrame(() => {
        textAreaRef.current?.setSelectionRange(0, 0);
        setAcceptTextPointer(true);
      });
    };
    const timeout = window.setTimeout(settle, 300);
    window.addEventListener("pointerup", settle, { capture: true, once: true });
    window.addEventListener("touchend", settle, { capture: true, once: true });
    window.addEventListener("mouseup", settle, { capture: true, once: true });
    return () => {
      window.clearTimeout(timeout);
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointerup", settle, { capture: true });
      window.removeEventListener("touchend", settle, { capture: true });
      window.removeEventListener("mouseup", settle, { capture: true });
    };
  }, [open, text]);

  return (
    <DialogRoot
      open={open}
      ariaLabel="Copy text"
      onClose={onClose}
      presentation={isMobile ? "fullscreen" : "modal"}
      panelClassName={`flex flex-col ${isMobile ? "min-h-0" : "max-h-[70vh]"}`}
      widthClassName="max-w-surface-sm"
    >
      <DialogHeader title="Copy text" onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <textarea
          ref={textAreaRef}
          aria-label="Selected terminal text"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          className={`cm-mono min-h-[12rem] flex-1 resize-none rounded-control border border-border bg-bg-primary px-2.5 py-2 text-sm text-text-primary outline-none focus:border-accent ${
            acceptTextPointer ? "" : "pointer-events-none"
          }`}
        />
        <DialogFooter>
          <DialogButton onClick={onClose}>Close</DialogButton>
          <DialogButton
            variant="primary"
            onClick={() => {
              void onCopy(draftText).then((ok) => {
                if (ok) onClose();
              });
            }}
          >
            Copy
          </DialogButton>
        </DialogFooter>
      </div>
    </DialogRoot>
  );
}
