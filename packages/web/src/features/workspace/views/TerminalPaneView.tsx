import type { Session, TerminalPaneState } from "@parasor/shared";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import {
  MonitorSwitchButton,
  PaGlyph,
  PaneHeader,
  PaneIconButton,
} from "../../../components/primitives/index.js";
import type { OpenUrlOptions } from "../../../lib/open-url-options.js";
import { displayTitleForTerminal } from "../../../lib/session-title.js";
import {
  isTerminalTraceEnabled,
  subscribeTerminalTraceEnabled,
} from "../../../lib/terminal-trace.js";
import { EditablePaneTitle } from "./EditablePaneTitle.js";
import { PaneCloseButton } from "./PaneCloseButton.js";

const LazyTerminalPane = lazy(() =>
  import("../../panes/terminal/TerminalPane.js").then(({ TerminalPane }) => ({
    default: TerminalPane,
  })),
);

interface TerminalPaneViewProps {
  paneId: string;
  state: TerminalPaneState;
  worktreePath?: string;
  session: Session | undefined;
  pin?: { pinned: boolean; onToggle: () => void } | null;
  onClose?: () => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onOpenFilePath?: (filePath: string) => void;
  onClosePane: (paneId: string) => Promise<void> | void;
}

/**
 * Terminal pane chrome -- inner PaneHeader carrying process name + pin /
 * close, then the xterm host. Outer SessionPaneHeader still owns the
 * project / worktree / branch crumbs.
 */
export function TerminalPaneView({
  paneId,
  state,
  worktreePath,
  session,
  pin,
  onClose,
  onRestartSession,
  onRenameSession,
  onOpenUrl,
  onOpenFilePath,
  onClosePane,
}: TerminalPaneViewProps) {
  const title = displayTitleForTerminal(session, "shell");
  const terminalTraceEnabled = useSyncExternalStore(
    subscribeTerminalTraceEnabled,
    isTerminalTraceEnabled,
    () => false,
  );
  const showDiagnosticCapture =
    terminalTraceEnabled && session !== undefined && session.state !== "ended";
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PaneHeader
        title={title}
        titleAttr={title}
        titleElement={
          session ? (
            <EditablePaneTitle
              value={title}
              onSave={(next) => onRenameSession(session.id, next)}
            />
          ) : undefined
        }
        actions={
          <>
            {showDiagnosticCapture && (
              <TerminalDiagnosticCaptureButton
                sessionId={session.id}
                paneId={paneId}
              />
            )}
            {pin && (
              <MonitorSwitchButton
                pressed={pin.pinned}
                className="bg-bg-secondary"
                onClick={pin.onToggle}
              />
            )}
            {onClose && <PaneCloseButton onClick={onClose} />}
          </>
        }
      />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="h-full bg-bg-terminal" />}>
          <LazyTerminalPane
            paneId={paneId}
            sessionId={state.sessionId}
            session={session}
            onRestartSession={onRestartSession}
            onOpenUrl={onOpenUrl}
            worktreePath={worktreePath}
            onOpenFilePath={onOpenFilePath}
            onClosePane={onClosePane}
          />
        </Suspense>
      </div>
    </div>
  );
}

type DiagnosticCaptureStatus = "idle" | "busy" | "ok" | "error";

function diagnosticCaptureLabel(status: DiagnosticCaptureStatus): string {
  switch (status) {
    case "busy":
      return "Capturing terminal diagnostics";
    case "ok":
      return "Captured terminal diagnostics";
    case "error":
      return "Failed to capture terminal diagnostics";
    case "idle":
      return "Capture terminal diagnostics";
  }
}

function TerminalDiagnosticCaptureButton({
  sessionId,
  paneId,
}: {
  sessionId: string;
  paneId: string;
}) {
  const [status, setStatus] = useState<DiagnosticCaptureStatus>("idle");
  const label = diagnosticCaptureLabel(status);
  const tone =
    status === "ok" ? "accent" : status === "error" ? "danger" : "normal";

  return (
    <PaneIconButton
      label={label}
      title={label}
      tone={tone}
      disabled={status === "busy"}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
      onClick={() => {
        setStatus("busy");
        void window.parasorTerminalTrace
          ?.captureTerminalInput("manual-terminal-button", {
            sessionId,
            paneId,
          })
          .then(() => setStatus("ok"))
          .catch(() => setStatus("error"));
      }}
    >
      <PaGlyph.doc />
    </PaneIconButton>
  );
}
