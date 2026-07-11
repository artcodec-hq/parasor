import type { MutableRefObject } from "react";
import { attachTerminalClipboardImagePaste } from "./terminal-clipboard-image-paste.js";
import { clearTerminalInputDiagnosticTimers } from "./terminal-input-diagnostics.js";
import { attachTerminalImeLifecycle } from "./terminal-input-lifecycle.js";

type ImeDuplicateGate = {
  composing: boolean;
  serial: number;
  activeSerial: number;
  suppressUntil: number;
  lastSentText: string;
  lastSentAt: number;
  lastSentSerial: number;
};

export function attachTerminalTextareaAdjunctLifecycle({
  textarea,
  imeDuplicateGateRef,
  inputDiagnosticTimersRef,
  dropEnabledRef,
  runUploadRef,
  setCtrl,
}: {
  textarea: HTMLTextAreaElement | undefined;
  imeDuplicateGateRef: MutableRefObject<ImeDuplicateGate>;
  inputDiagnosticTimersRef: MutableRefObject<Set<number>>;
  dropEnabledRef: MutableRefObject<boolean>;
  runUploadRef: MutableRefObject<(files: readonly File[]) => Promise<void>>;
  setCtrl: (value: boolean) => void;
}) {
  const cleanupImeLifecycle = attachTerminalImeLifecycle({
    textarea,
    imeDuplicateGateRef,
    setCtrl,
  });
  const cleanupClipboardImagePaste = attachTerminalClipboardImagePaste({
    textarea,
    dropEnabledRef,
    runUploadRef,
  });

  return () => {
    cleanupImeLifecycle();
    cleanupClipboardImagePaste();
    clearTerminalInputDiagnosticTimers(inputDiagnosticTimersRef.current);
  };
}
