import type { PaneEntry, Session } from "@parasor/shared";
import { useEffect, useRef } from "react";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { traceTerminalEvent } from "../../lib/terminal-trace.js";
import { TerminalPaneView } from "./views/TerminalPaneView.js";

interface TerminalPaneLayerProps {
  panes: PaneEntry[];
  focusedPaneId: string;
  sessions: Session[];
  pin: { pinned: boolean; onToggle: () => void } | null;
  onClose?: () => void;
  onClosePane: (paneId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onOpenFilePath: (worktreePath: string, filePath: string) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
}

export function TerminalPaneLayer({
  panes,
  focusedPaneId,
  sessions,
  pin,
  onClose,
  onClosePane,
  onOpenUrl,
  onOpenFilePath,
  onRestartSession,
  onRenameSession,
}: TerminalPaneLayerProps) {
  const terminalPanes = panes.filter(
    (pane) => pane.state.kind === "terminal" && pane.id === focusedPaneId,
  );
  return (
    <>
      {terminalPanes.map((pane) => {
        if (pane.state.kind !== "terminal") return null;
        const state = pane.state;
        const session = sessions.find((s) => s.id === state.sessionId);
        return (
          <TerminalPaneLayerItem
            key={pane.id}
            pane={pane}
            state={state}
            session={session}
            pin={pin}
            onClose={onClose}
            onClosePane={onClosePane}
            onOpenUrl={onOpenUrl}
            onOpenFilePath={onOpenFilePath}
            onRestartSession={onRestartSession}
            onRenameSession={onRenameSession}
          />
        );
      })}
    </>
  );
}

interface TerminalPaneLayerItemProps {
  pane: PaneEntry;
  state: Extract<PaneEntry["state"], { kind: "terminal" }>;
  session: Session | undefined;
  pin: { pinned: boolean; onToggle: () => void } | null;
  onClose?: () => void;
  onClosePane: (paneId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onOpenFilePath: (worktreePath: string, filePath: string) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
}

function TerminalPaneLayerItem({
  pane,
  state,
  session,
  pin,
  onClose,
  onClosePane,
  onOpenUrl,
  onOpenFilePath,
  onRestartSession,
  onRenameSession,
}: TerminalPaneLayerItemProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    traceTerminalEvent("terminal-layer-visibility", {
      sessionId: state.sessionId,
      paneId: pane.id,
      visible: true,
    });
    const frame = window.requestAnimationFrame(() => {
      const rect = layerRef.current?.getBoundingClientRect();
      traceTerminalEvent("terminal-layer-layout", {
        sessionId: state.sessionId,
        paneId: pane.id,
        visible: true,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pane.id, state.sessionId]);

  return (
    <div
      ref={layerRef}
      className="pointer-events-auto absolute inset-0 min-h-0 min-w-0"
    >
      <TerminalPaneView
        paneId={pane.id}
        state={state}
        worktreePath={pane.worktreePath}
        session={session}
        pin={pin}
        onClose={onClose}
        onClosePane={onClosePane}
        onOpenUrl={onOpenUrl}
        onOpenFilePath={(filePath) =>
          onOpenFilePath(pane.worktreePath, filePath)
        }
        onRestartSession={onRestartSession}
        onRenameSession={onRenameSession}
      />
    </div>
  );
}
