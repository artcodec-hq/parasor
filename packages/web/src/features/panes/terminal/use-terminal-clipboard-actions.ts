import type { Terminal as XTerm } from "@xterm/xterm";
import { type RefObject, useCallback, useState } from "react";
import { copyTextToNativeClipboard } from "../../../lib/native-clipboard.js";
import {
  readTerminalInternalClipboard,
  writeTerminalInternalClipboard,
} from "../../../lib/terminal-internal-clipboard.js";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";

type UseTerminalClipboardActionsArgs = {
  sessionId: string;
  xtermRef: RefObject<XTerm | null>;
  send: (msg: { type: "input"; data: string }) => void;
  clearSelectionUi: () => void;
};

function getErrorName(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof err.name === "string" &&
    err.name.length > 0
  ) {
    return err.name;
  }
  return "unknown";
}

export function useTerminalClipboardActions({
  sessionId,
  xtermRef,
  send,
  clearSelectionUi,
}: UseTerminalClipboardActionsArgs): {
  externalCopyText: string | null;
  closeExternalCopyDialog: () => void;
  handleCopySelection: () => Promise<void>;
  openExternalCopyDialog: () => void;
  copyExternalText: (text: string) => Promise<boolean>;
  handlePasteFromTerminalToolbar: () => Promise<void>;
} {
  const [externalCopyText, setExternalCopyText] = useState<string | null>(null);

  const closeExternalCopyDialog = useCallback(() => {
    setExternalCopyText(null);
  }, []);

  const handleCopySelection = useCallback(async () => {
    const term = xtermRef.current;
    if (!term) return;
    const text = term.getSelection();
    if (!text) {
      traceTerminalEvent("terminal-toolbar-copy-skipped", {
        sessionId,
        reason: "empty-selection",
      });
      return;
    }

    traceTerminalEvent("terminal-toolbar-copy-attempt", {
      sessionId,
      dataLength: text.length,
    });

    const internalWritten = writeTerminalInternalClipboard(text);
    if (internalWritten) {
      traceTerminalEvent("terminal-toolbar-copy", {
        sessionId,
        status: "internal",
        dataLength: text.length,
      });
    } else {
      traceTerminalEvent("terminal-toolbar-copy-failed", {
        sessionId,
        status: "internal",
        reason: "local-storage-unavailable",
      });
    }

    const nativeCopyResult = await copyTextToNativeClipboard(text);
    if (nativeCopyResult.ok) {
      traceTerminalEvent("terminal-toolbar-copy", {
        sessionId,
        status: "native",
        dataLength: text.length,
      });
    } else {
      traceTerminalEvent("terminal-toolbar-copy-failed", {
        sessionId,
        status: "native",
        reason: nativeCopyResult.reason,
      });
    }

    if (!internalWritten && !nativeCopyResult.ok) return;
    traceTerminalEvent("terminal-toolbar-copy-complete", {
      sessionId,
      dataLength: text.length,
    });
    term.clearSelection();
    clearSelectionUi();
  }, [clearSelectionUi, sessionId, xtermRef]);

  const openExternalCopyDialog = useCallback(() => {
    const text = xtermRef.current?.getSelection() ?? "";
    if (!text) return;
    setExternalCopyText(text);
    traceTerminalEvent("terminal-external-copy-dialog-open", {
      sessionId,
      dataLength: text.length,
    });
  }, [sessionId, xtermRef]);

  const copyExternalText = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;
      const internalWritten = writeTerminalInternalClipboard(text);
      if (internalWritten) {
        traceTerminalEvent("terminal-external-copy-dialog-copy", {
          sessionId,
          status: "internal",
          dataLength: text.length,
        });
      } else {
        traceTerminalEvent("terminal-external-copy-dialog-copy-failed", {
          sessionId,
          status: "internal",
          reason: "local-storage-unavailable",
        });
      }
      const result = await copyTextToNativeClipboard(text);
      traceTerminalEvent(
        result.ok
          ? "terminal-external-copy-dialog-copy"
          : "terminal-external-copy-dialog-copy-failed",
        {
          sessionId,
          status: "native",
          dataLength: text.length,
          ...(result.ok ? {} : { reason: result.reason }),
        },
      );
      return internalWritten || result.ok;
    },
    [sessionId],
  );

  const handlePasteFromTerminalToolbar = useCallback(async () => {
    const term = xtermRef.current;
    const readText = navigator.clipboard?.readText;
    const pasteText = (text: string, source: "native" | "internal") => {
      send({ type: "input", data: text });
      traceTerminalEvent("terminal-toolbar-paste", {
        sessionId,
        status: source,
        dataLength: text.length,
      });
      term?.clearSelection();
      clearSelectionUi();
    };

    try {
      if (readText) {
        const text = await readText.call(navigator.clipboard);
        if (text) {
          pasteText(text, "native");
          return;
        }
        traceTerminalEvent("terminal-toolbar-paste-skipped", {
          sessionId,
          status: "native",
          reason: "empty-clipboard",
        });
      } else {
        traceTerminalEvent("terminal-toolbar-paste-failed", {
          sessionId,
          status: "native",
          reason: "clipboard-api-unavailable",
        });
      }
    } catch (err) {
      traceTerminalEvent("terminal-toolbar-paste-failed", {
        sessionId,
        status: "native",
        reason: getErrorName(err),
      });
    }

    const internalText = readTerminalInternalClipboard();
    if (internalText) {
      pasteText(internalText, "internal");
      return;
    }

    traceTerminalEvent("terminal-toolbar-paste-failed", {
      sessionId,
      status: "internal",
      reason: "internal-clipboard-empty",
    });
  }, [clearSelectionUi, send, sessionId, xtermRef]);

  return {
    externalCopyText,
    closeExternalCopyDialog,
    handleCopySelection,
    openExternalCopyDialog,
    copyExternalText,
    handlePasteFromTerminalToolbar,
  };
}
