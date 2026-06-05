import type { Session } from "@parasor/shared";
import { useCallback, useRef } from "react";
import { usePaneFocusHandler } from "../../../hooks/usePaneFocusHandler.js";
import type { OpenUrlOptions } from "../../../lib/open-url-options.js";
import { isCoarsePointer } from "../../../lib/pointer.js";
import { type PaneInputHandle, Terminal } from "./Terminal.js";

interface TerminalPaneProps {
  sessionId: string;
  session?: Session;
  onRestartSession?: (sessionId: string) => void;
  onOpenUrl?: (url: string, options?: OpenUrlOptions) => void;
  onOpenFilePath?: (filePath: string) => void;
  onClosePane?: (paneId: string) => void;
  paneId: string;
  worktreePath?: string;
}

export function TerminalPane({
  sessionId,
  session,
  onRestartSession,
  onOpenUrl,
  onOpenFilePath,
  onClosePane,
  paneId,
  worktreePath,
}: TerminalPaneProps) {
  const handleRef = useRef<PaneInputHandle>(null);
  const focusPane = useCallback(() => handleRef.current?.focus(), []);
  // Skip auto-focus on touch devices: popping the soft keyboard mid-tap is surprising.
  usePaneFocusHandler(paneId, focusPane, !isCoarsePointer());

  return (
    <Terminal
      ref={handleRef}
      sessionId={sessionId}
      paneId={paneId}
      projectId={session?.projectId}
      sessionState={session?.state === "spawning" ? "running" : session?.state}
      sessionTitle={session?.title}
      sessionCommand={session?.command}
      sessionEndReason={session?.endReason}
      onRestart={() => onRestartSession?.(sessionId)}
      onCloseSession={() => onClosePane?.(paneId)}
      onOpenUrl={onOpenUrl}
      worktreePath={worktreePath}
      onOpenFilePath={onOpenFilePath}
    />
  );
}
