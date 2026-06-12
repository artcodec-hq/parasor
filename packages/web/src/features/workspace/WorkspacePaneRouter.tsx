import type {
  GitState,
  IdeCommandConfig,
  PaneEntry,
  Session,
} from "@parasor/shared";
import { useEffect, useMemo, useRef } from "react";
import { PaGlyph } from "../../components/primitives/index.js";
import type { PaMenuItem } from "../../components/primitives/PaMenu.js";
import { useEdgeSwipeBack } from "../../hooks/use-edge-swipe-back.js";
import type { IdeEditor } from "../../lib/git-api.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { displayTitleForTerminal } from "../../lib/session-title.js";
import { traceTerminalEvent } from "../../lib/terminal-trace.js";
import type { GitGraphSelection } from "../panes/git-graph/GitGraphPane.js";
import { BrowserPaneView } from "./views/BrowserPaneView.js";
import { FilesPaneView } from "./views/FilesPaneView.js";
import { GitPaneView } from "./views/GitPaneView.js";
import {
  type SessionCrumb,
  SessionPaneHeader,
  type SessionPaneView,
} from "./views/SessionPaneHeader.js";
import { TerminalPaneView } from "./views/TerminalPaneView.js";
import {
  setFilesPaneSelection,
  useFilesPaneSelection,
} from "./views/use-files-pane-selection.js";
import {
  type WorktreeCounters,
  type WorktreeGitMenuActions,
  type WorktreeTab,
  WorktreeView,
} from "./views/WorktreeView.js";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState.js";

function basename(filePath: string): string {
  const trimmed = filePath.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function worktreeFilesPaneId(worktreePath: string): string {
  return `files:${worktreePath}`;
}

interface WorkspacePaneRouterProps {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectPath: string | null;
  /**
   * `false` when the active project's root has been confirmed not a git
   * repo. Drives crumb[1]'s folder vs worktree glyph (matching the
   * sidebar's WorktreeRow) and hides the More menu's Rename / Remove
   * worktree entries when there's no git surface to operate on.
   */
  activeProjectIsRepo: boolean;
  allPanes?: PaneEntry[];
  focusedPane: PaneEntry | null;
  /** Worktree directory name (path basename / "main" / "root"). Crumb[1] in pane header. */
  focusedWorktreeDirName: string | null;
  fileChangeSeq: number;
  gitState: GitState | null;
  hydrated: boolean;
  isMobile: boolean;
  gitMenuActions?: WorktreeGitMenuActions;
  gitGraphSelection: GitGraphSelection | null;
  onGitGraphSelectionChange: (next: GitGraphSelection | null) => void;
  gitBranchName: string | null;
  commitBusy: boolean;
  commitError: string | null;
  onClearCommitError: () => void;
  onSubmitInlineCommit: (input: {
    message: string;
    paths: string[];
  }) => Promise<void> | void;
  sessions: Session[];
  onToggleDrawer: () => void;
  onClosePane: (paneId: string) => Promise<void> | void;
  onRequestClosePane: (
    paneId: string,
    paneKind: "terminal" | "browser",
    title: string,
  ) => void;
  onNewProject: () => void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onBrowserUrlChange?: (paneId: string, url: string) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
  onSelectWorktreeTab: (worktreePath: string, tab: WorktreeTab) => void;
  onToggleSessionPin: (sessionId: string) => Promise<void> | void;
  /** Worktree-scoped lifecycle actions surfaced in the pane header ⋯ menu. */
  onOpenWorktreeInFinder?: (projectId: string, worktreePath: string) => void;
  onOpenWorktreeInIde?: (
    projectId: string,
    worktreePath: string,
    editor: IdeEditor,
  ) => void;
  ideCommands?: IdeCommandConfig[];
  canOpenLocalIde?: boolean;
  onCopyWorktreePath?: (worktreePath: string) => void;
  onRenameWorktree?: (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => void;
  onRemoveWorktree?: (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => void;
  onDeleteProject?: (projectId: string) => void;
}

/**
 * Renders the focused pane for the active project. A thin dispatcher on
 * top of `PaneEntry.kind`; each view component owns its own body +
 * optional 2-col split. The mobile top bar is built here so it can read
 * the focused pane state and synthesize crumbs / Row 2 segmented / more
 * popover.
 */
export function WorkspacePaneRouter({
  activeProjectId,
  activeProjectName,
  activeProjectPath,
  activeProjectIsRepo,
  allPanes = [],
  focusedPane,
  focusedWorktreeDirName,
  fileChangeSeq,
  gitState,
  hydrated,
  isMobile,
  gitMenuActions,
  gitGraphSelection,
  onGitGraphSelectionChange,
  gitBranchName,
  commitBusy,
  commitError,
  onClearCommitError,
  onSubmitInlineCommit,
  sessions,
  onToggleDrawer,
  onClosePane,
  onRequestClosePane,
  onNewProject,
  onOpenUrl,
  onBrowserUrlChange,
  onRestartSession,
  onRenameSession,
  onSelectWorktreeTab,
  onToggleSessionPin,
  onOpenWorktreeInFinder,
  onOpenWorktreeInIde,
  ideCommands = [],
  canOpenLocalIde = false,
  onCopyWorktreePath,
  onRemoveWorktree,
  onDeleteProject,
}: WorkspacePaneRouterProps) {
  const gitFileStatuses = gitState?.fileStatuses;
  const gitDirtyCount = gitState?.dirtyCount ?? 0;
  const counters: WorktreeCounters | undefined = gitState
    ? {
        ahead: gitState.ahead,
        behind: gitState.behind,
        dirty: gitState.dirtyCount,
      }
    : undefined;
  const filesPane = focusedPane?.state.kind === "files" ? focusedPane : null;
  const gitPane = focusedPane?.state.kind === "git" ? focusedPane : null;
  const worktreePane = filesPane ?? gitPane;
  const isFilesPane = filesPane !== null;
  const isGitPane = gitPane !== null;
  const isWorktreePane = worktreePane !== null;
  const filesPaneId = filesPane?.id ?? null;
  const [filesSelection, setFilesSelection] =
    useFilesPaneSelection(filesPaneId);
  const isFilesChild = isFilesPane && filesSelection !== null;
  const isGitChild = isGitPane && gitGraphSelection !== null;
  const childTitle = isFilesChild
    ? basename(filesSelection)
    : isGitChild
      ? buildGitChildTitle(gitGraphSelection)
      : focusedPane
        ? buildChildTitle(focusedPane, sessions)
        : null;
  const focusedWorktreeIsActive =
    !!focusedPane &&
    !!activeProjectPath &&
    focusedPane.worktreePath === activeProjectPath;
  const crumbs = buildSessionCrumbs(
    activeProjectName,
    focusedWorktreeDirName,
    focusedWorktreeIsActive,
    activeProjectIsRepo,
    gitBranchName,
  );
  const view: SessionPaneView | undefined =
    worktreePane && !isFilesChild && !isGitChild
      ? (worktreePane.state.kind as SessionPaneView)
      : undefined;
  const onChangeView =
    worktreePane && !isFilesChild && !isGitChild
      ? (next: SessionPaneView) =>
          onSelectWorktreeTab(worktreePane.worktreePath, next)
      : undefined;
  const onBack = isFilesChild
    ? () => setFilesSelection(null)
    : isGitChild
      ? () => onGitGraphSelectionChange(null)
      : null;
  const closableKind =
    focusedPane?.state.kind === "terminal" ||
    focusedPane?.state.kind === "browser"
      ? focusedPane.state.kind
      : null;
  const onClose =
    focusedPane && closableKind
      ? () =>
          onRequestClosePane(focusedPane.id, closableKind, childTitle ?? "pane")
      : undefined;
  const terminalState =
    focusedPane?.state.kind === "terminal" ? focusedPane.state : null;
  const terminalSession = terminalState
    ? sessions.find((s) => s.id === terminalState.sessionId)
    : undefined;
  const pin = terminalSession
    ? {
        pinned: terminalSession.pinned === true,
        onToggle: () => void onToggleSessionPin(terminalSession.id),
      }
    : null;
  // Terminal and browser pane-specific actions belong to their inner pane
  // chrome; the outer SessionPaneHeader owns workspace crumbs/navigation.
  const hasInnerPaneChrome =
    focusedPane?.state.kind === "terminal" ||
    focusedPane?.state.kind === "browser";
  const outerPin = hasInnerPaneChrome ? null : pin;
  const outerOnClose = hasInnerPaneChrome ? undefined : onClose;
  const terminalLayerPanes =
    allPanes.length > 0 ? allPanes : focusedPane ? [focusedPane] : [];
  const handleOpenTerminalFilePath = (
    worktreePath: string,
    filePath: string,
  ) => {
    setFilesPaneSelection(worktreeFilesPaneId(worktreePath), filePath);
    onSelectWorktreeTab(worktreePath, "files");
  };
  useEdgeSwipeBack(isMobile ? onBack : null);

  const moreMenuItems = useMemo<PaMenuItem[]>(() => {
    if (!focusedPane || !activeProjectId) return [];
    const worktreePath = focusedPane.worktreePath;
    const isProjectRootPane =
      !!activeProjectPath && worktreePath === activeProjectPath;
    const items: PaMenuItem[] = [];
    if (onCopyWorktreePath) {
      items.push({
        id: "copy-path",
        label: "Copy path",
        onSelect: () => onCopyWorktreePath(worktreePath),
      });
    }
    if (onOpenWorktreeInFinder) {
      items.push({
        id: "open-finder",
        label: "Open in Finder",
        separatorBefore: items.length > 0,
        onSelect: () => onOpenWorktreeInFinder(activeProjectId, worktreePath),
      });
    }
    if (onOpenWorktreeInIde) {
      const disabled = !canOpenLocalIde;
      const title = disabled
        ? "Available when parasor is opened from localhost on the server machine"
        : undefined;
      const separatorBefore = items.length > 0 && !onOpenWorktreeInFinder;
      items.push(
        {
          id: "open-cursor",
          label: "Open in Cursor",
          disabled,
          title,
          separatorBefore,
          onSelect: () =>
            onOpenWorktreeInIde(activeProjectId, worktreePath, "cursor"),
        },
        {
          id: "open-vscode",
          label: "Open in VS Code",
          disabled,
          title,
          onSelect: () =>
            onOpenWorktreeInIde(activeProjectId, worktreePath, "vscode"),
        },
      );
      for (const command of ideCommands) {
        items.push({
          id: `open-custom-ide:${command.id}`,
          label: `Open in ${command.label}`,
          disabled,
          title,
          onSelect: () =>
            onOpenWorktreeInIde(activeProjectId, worktreePath, command.id),
        });
      }
    }
    if (!isProjectRootPane && activeProjectIsRepo && onRemoveWorktree) {
      items.push({
        id: "remove",
        label: "Remove worktree…",
        separatorBefore: items.length > 0,
        tone: "danger",
        onSelect: () =>
          onRemoveWorktree(
            activeProjectId,
            worktreePath,
            focusedWorktreeDirName ?? "main",
          ),
      });
    }
    if (isProjectRootPane && onDeleteProject) {
      items.push({
        id: "close-project",
        label: "Close project…",
        separatorBefore: items.length > 0,
        onSelect: () => onDeleteProject(activeProjectId),
      });
    }
    return items;
  }, [
    focusedPane,
    activeProjectId,
    activeProjectPath,
    activeProjectIsRepo,
    focusedWorktreeDirName,
    onOpenWorktreeInFinder,
    onOpenWorktreeInIde,
    ideCommands,
    canOpenLocalIde,
    onCopyWorktreePath,
    onRemoveWorktree,
    onDeleteProject,
  ]);

  return (
    <main className="flex-1 min-w-0 bg-bg-terminal flex flex-col touch-pan-y">
      {focusedPane && (
        <SessionPaneHeader
          crumbs={crumbs}
          onBack={onBack}
          onToggleDrawer={onToggleDrawer}
          view={view}
          onChangeView={onChangeView}
          dirty={isWorktreePane ? gitDirtyCount : undefined}
          pin={outerPin}
          onClose={outerOnClose}
          moreMenuItems={moreMenuItems}
        />
      )}
      <div className="relative flex-1 overflow-hidden">
        {focusedPane && activeProjectId ? (
          <>
            {focusedPane.state.kind !== "terminal" && (
              <div className="absolute inset-0 min-h-0 min-w-0">
                <PaneBody
                  activeProjectId={activeProjectId}
                  activeProjectPath={activeProjectPath}
                  focusedPane={focusedPane}
                  focusedWorktreeDirName={focusedWorktreeDirName}
                  fileChangeSeq={fileChangeSeq}
                  gitState={gitState}
                  gitFileStatuses={gitFileStatuses}
                  gitBranchName={gitBranchName}
                  counters={counters}
                  gitMenuActions={gitMenuActions}
                  gitGraphSelection={gitGraphSelection}
                  onGitGraphSelectionChange={onGitGraphSelectionChange}
                  commitBusy={commitBusy}
                  commitError={commitError}
                  onClearCommitError={onClearCommitError}
                  onSubmitInlineCommit={onSubmitInlineCommit}
                  isMobile={isMobile}
                  sessions={sessions}
                  terminalPin={pin}
                  terminalOnClose={onClose}
                  browserOnClose={onClose}
                  onClosePane={onClosePane}
                  onOpenUrl={onOpenUrl}
                  onBrowserUrlChange={onBrowserUrlChange}
                  onRestartSession={onRestartSession}
                  onRenameSession={onRenameSession}
                  onSelectWorktreeTab={onSelectWorktreeTab}
                />
              </div>
            )}
            <TerminalPaneLayer
              panes={terminalLayerPanes}
              focusedPaneId={focusedPane.id}
              sessions={sessions}
              pin={pin}
              onClose={onClose}
              onClosePane={onClosePane}
              onOpenUrl={onOpenUrl}
              onOpenFilePath={handleOpenTerminalFilePath}
              onRestartSession={onRestartSession}
              onRenameSession={onRenameSession}
            />
          </>
        ) : (
          <WorkspaceEmptyState
            activeProjectId={activeProjectId}
            hydrated={hydrated}
            onNewProject={onNewProject}
          />
        )}
      </div>
    </main>
  );
}

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

function TerminalPaneLayer({
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

interface PaneBodyProps {
  activeProjectId: string;
  activeProjectPath: string | null;
  focusedPane: PaneEntry;
  focusedWorktreeDirName: string | null;
  fileChangeSeq: number;
  gitState: GitState | null;
  gitFileStatuses?: Record<string, string>;
  gitBranchName: string | null;
  counters?: WorktreeCounters;
  gitMenuActions?: WorktreeGitMenuActions;
  gitGraphSelection: GitGraphSelection | null;
  onGitGraphSelectionChange: (next: GitGraphSelection | null) => void;
  commitBusy: boolean;
  commitError: string | null;
  onClearCommitError: () => void;
  onSubmitInlineCommit: (input: {
    message: string;
    paths: string[];
  }) => Promise<void> | void;
  isMobile: boolean;
  sessions: Session[];
  /** Inner terminal-header pin toggle; null for non-terminal panes. */
  terminalPin: { pinned: boolean; onToggle: () => void } | null;
  /** Inner terminal-header × button. */
  terminalOnClose?: () => void;
  /** Inner browser-header × button. */
  browserOnClose?: () => void;
  onClosePane: (paneId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onBrowserUrlChange?: (paneId: string, url: string) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
  onSelectWorktreeTab: (worktreePath: string, tab: WorktreeTab) => void;
}

function PaneBody({
  activeProjectId,
  activeProjectPath,
  focusedPane,
  focusedWorktreeDirName,
  fileChangeSeq,
  gitState,
  gitFileStatuses,
  counters,
  gitMenuActions,
  gitGraphSelection,
  onGitGraphSelectionChange,
  commitBusy,
  commitError,
  onClearCommitError,
  onSubmitInlineCommit,
  isMobile,
  sessions,
  terminalPin,
  terminalOnClose,
  browserOnClose,
  onClosePane,
  onOpenUrl,
  onBrowserUrlChange,
  onRestartSession,
  onRenameSession,
  onSelectWorktreeTab,
}: PaneBodyProps) {
  const { state } = focusedPane;
  switch (state.kind) {
    case "files":
      return (
        <WorktreeView
          activeTab="files"
          worktreeName={focusedWorktreeDirName}
          worktreePath={focusedPane.worktreePath}
          counters={counters}
        >
          <FilesPaneView
            paneId={focusedPane.id}
            projectId={activeProjectId}
            worktreePath={focusedPane.worktreePath}
            fileChangeSeq={fileChangeSeq}
            gitFileStatuses={gitFileStatuses}
            isMobile={isMobile}
            onChangeTab={(tab) =>
              onSelectWorktreeTab(focusedPane.worktreePath, tab)
            }
          />
        </WorktreeView>
      );
    case "terminal": {
      const session = sessions.find((s) => s.id === state.sessionId);
      return (
        <TerminalPaneView
          paneId={focusedPane.id}
          state={state}
          worktreePath={focusedPane.worktreePath}
          session={session}
          pin={terminalPin}
          onClose={terminalOnClose}
          onClosePane={onClosePane}
          onOpenUrl={onOpenUrl}
          onOpenFilePath={(filePath) => {
            setFilesPaneSelection(
              worktreeFilesPaneId(focusedPane.worktreePath),
              filePath,
            );
            onSelectWorktreeTab(focusedPane.worktreePath, "files");
          }}
          onRestartSession={onRestartSession}
          onRenameSession={onRenameSession}
        />
      );
    }
    case "browser":
      return (
        <BrowserPaneView
          state={state}
          paneId={focusedPane.id}
          onClose={browserOnClose}
          onUrlChange={
            onBrowserUrlChange
              ? (url) => onBrowserUrlChange(focusedPane.id, url)
              : undefined
          }
        />
      );
    case "git":
      return (
        <WorktreeView
          activeTab="git"
          worktreeName={focusedWorktreeDirName}
          worktreePath={focusedPane.worktreePath}
          counters={counters}
        >
          <GitPaneView
            projectId={activeProjectId}
            worktreePath={focusedPane.worktreePath}
            fileChangeSeq={fileChangeSeq}
            isMobile={isMobile}
            gitState={gitState}
            projectPath={activeProjectPath}
            selection={gitGraphSelection}
            onSelectionChange={onGitGraphSelectionChange}
            commitBusy={commitBusy}
            commitError={commitError}
            onClearCommitError={onClearCommitError}
            onSubmitInlineCommit={onSubmitInlineCommit}
            onChangeTab={(tab) =>
              onSelectWorktreeTab(focusedPane.worktreePath, tab)
            }
            {...(gitMenuActions && { gitActions: gitMenuActions })}
          />
        </WorktreeView>
      );
  }
}

function buildGitChildTitle(selection: GitGraphSelection): string {
  if (selection.kind === "working-tree") return "Working tree";
  return selection.commit.sha.slice(0, 7);
}

function buildChildTitle(pane: PaneEntry, sessions: Session[]): string | null {
  const { state } = pane;
  if (state.kind === "terminal") {
    const session = sessions.find((s) => s.id === state.sessionId);
    return displayTitleForTerminal(session);
  }
  if (state.kind === "browser") {
    try {
      return new URL(state.url).host || state.url;
    } catch {
      return state.url;
    }
  }
  return null;
}

/**
 * Build the SessionPaneHeader breadcrumb chain for the focused pane.
 *
 * Glyph selection mirrors the sidebar's WorktreeRow:
 *   - non-repo project root -> folder
 *   - repo worktree -> git
 *
 * `branchName` surfaces only when the git poll has produced a non-empty
 * branch (caller passes `null` otherwise).
 */
export function buildSessionCrumbs(
  projectName: string | null,
  worktreeDirName: string | null,
  _worktreeIsActive: boolean,
  worktreeIsRepo: boolean,
  branchName: string | null,
): SessionCrumb[] {
  const crumbs: SessionCrumb[] = [];
  if (projectName) {
    crumbs.push({ label: projectName, dim: true, maxWidth: 96 });
  }
  if (worktreeDirName) {
    const worktreeGlyph = !worktreeIsRepo ? (
      <PaGlyph.folder />
    ) : (
      <PaGlyph.git />
    );
    crumbs.push({
      label: worktreeDirName,
      dim: true,
      maxWidth: 96,
      glyph: worktreeGlyph,
    });
  }
  if (branchName) {
    crumbs.push({
      label: branchName,
      dim: true,
      glyph: <PaGlyph.branch />,
    });
  }
  if (crumbs.length === 0) {
    crumbs.push({ label: "parasor" });
  }
  return crumbs;
}
