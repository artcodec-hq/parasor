import type {
  GitState,
  IdeCommandConfig,
  PaneEntry,
  Session,
  UpdateWorkItemInput,
  WorkItem,
  Worktree,
} from "@parasor/shared";
import { useCallback, useEffect, useState } from "react";
import { DialogRoot, PaGlyph } from "../../components/primitives/index.js";
import { useEdgeSwipeBack } from "../../hooks/use-edge-swipe-back.js";
import type { IdeEditor } from "../../lib/git-api.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { displayTitleForTerminal } from "../../lib/session-title.js";
import type { GitGraphSelection } from "../panes/git-graph/GitGraphPane.js";
import {
  getPaneModule,
  isWorkspaceBodyPane,
} from "../panes/pane-module-registry.js";
import { TerminalPaneLayer } from "./TerminalPaneLayer.js";
import { useWorktreeMoreMenuItems } from "./useWorktreeMoreMenuItems.js";
import {
  type SessionCrumb,
  SessionPaneHeader,
  type SessionPaneView,
} from "./views/SessionPaneHeader.js";
import {
  setFilesPaneSelection,
  useFilesPaneSelection,
} from "./views/use-files-pane-selection.js";
import type {
  WorktreeCounters,
  WorktreeGitMenuActions,
  WorktreeTab,
} from "./views/WorktreeView.js";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState.js";
import {
  basename,
  isTemporaryAbsolutePath,
  WorkspaceFileDisplay,
  type WorkspaceFileDisplayTarget,
} from "./WorkspaceFileDisplay.js";
import { WorkspacePaneBody } from "./WorkspacePaneBody.js";

function worktreeFilesPaneId(worktreePath: string): string {
  return `files:${worktreePath}`;
}

function blurActiveEditableElement(): void {
  const active = document.activeElement;
  if (!active || !("blur" in active)) return;
  (active as { blur: () => void }).blur();
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
  allowFilesGit?: boolean;
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
  workItems: WorkItem[];
  worktrees: Worktree[];
  onUpdateWorkItem: (
    workItemId: string,
    input: UpdateWorkItemInput,
  ) => Promise<void> | void;
  onDeleteWorkItem: (workItemId: string) => Promise<void> | void;
  onToggleDrawer: () => void;
  onClosePane: (paneId: string) => Promise<void> | void;
  onRequestClosePane: (
    paneId: string,
    paneKind: "work-item" | "terminal" | "browser",
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
  allowFilesGit = true,
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
  workItems,
  worktrees,
  onUpdateWorkItem,
  onDeleteWorkItem,
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
  const isGitPane = gitPane !== null;
  const isWorktreePane = worktreePane !== null;
  const filesPaneId = filesPane?.id ?? null;
  const [filesSelection] = useFilesPaneSelection(filesPaneId);
  const [fileDisplayTarget, setFileDisplayTarget] =
    useState<WorkspaceFileDisplayTarget | null>(null);
  const isGitChild = isGitPane && gitGraphSelection !== null;
  const childTitle = isGitChild
    ? buildGitChildTitle(gitGraphSelection)
    : focusedPane
      ? buildChildTitle(focusedPane, sessions, workItems)
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
    worktreePane && !isGitChild
      ? (worktreePane.state.kind as SessionPaneView)
      : undefined;
  const onChangeView =
    worktreePane && !isGitChild
      ? (next: SessionPaneView) =>
          onSelectWorktreeTab(worktreePane.worktreePath, next)
      : undefined;
  const onBack = isGitChild ? () => onGitGraphSelectionChange(null) : null;
  const paneModule = focusedPane ? getPaneModule(focusedPane.state.kind) : null;
  const closableKind = paneModule?.closableKind ?? null;
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
  const hasInnerPaneChrome = paneModule?.ownsInnerChrome ?? false;
  const outerPin = hasInnerPaneChrome ? null : pin;
  const outerOnClose = hasInnerPaneChrome ? undefined : onClose;
  const terminalLayerPanes =
    allPanes.length > 0 ? allPanes : focusedPane ? [focusedPane] : [];
  const bodyPane =
    focusedPane && isWorkspaceBodyPane(focusedPane) ? focusedPane : null;
  const handleOpenFilePath = useCallback(
    (worktreePath: string, filePath: string) => {
      const openerPaneId = focusedPane?.id ?? worktreeFilesPaneId(worktreePath);
      if (isMobile) blurActiveEditableElement();
      setFilesPaneSelection(worktreeFilesPaneId(worktreePath), filePath);
      setFileDisplayTarget({ worktreePath, filePath, openerPaneId });
    },
    [focusedPane?.id, isMobile],
  );

  const handleCloseFileDisplay = useCallback(() => {
    setFileDisplayTarget(null);
  }, []);

  const handleOpenTerminalFilePath = useCallback(
    (worktreePath: string, filePath: string) => {
      if (isTemporaryAbsolutePath(filePath)) {
        const openerPaneId =
          focusedPane?.id ?? worktreeFilesPaneId(worktreePath);
        if (isMobile) blurActiveEditableElement();
        setFileDisplayTarget({
          worktreePath,
          filePath,
          temporaryFilePath: filePath,
          openerPaneId,
        });
        return;
      }
      handleOpenFilePath(worktreePath, filePath);
    },
    [focusedPane?.id, handleOpenFilePath, isMobile],
  );
  useEffect(() => {
    if (!fileDisplayTarget) return;
    if (!activeProjectId) {
      setFileDisplayTarget(null);
      return;
    }
    const worktreeStillVisible = terminalLayerPanes.some(
      (pane) => pane.worktreePath === fileDisplayTarget.worktreePath,
    );
    if (!worktreeStillVisible) setFileDisplayTarget(null);
  }, [activeProjectId, fileDisplayTarget, terminalLayerPanes]);

  useEdgeSwipeBack(isMobile ? onBack : null);

  const moreMenuItems = useWorktreeMoreMenuItems({
    activeProjectId,
    activeProjectIsRepo,
    activeProjectPath,
    canOpenLocalIde,
    focusedPane,
    focusedWorktreeDirName,
    ideCommands,
    onCopyWorktreePath,
    onDeleteProject,
    onOpenWorktreeInFinder,
    onOpenWorktreeInIde,
    onRemoveWorktree,
  });

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
            <div className="absolute inset-0 flex min-h-0 min-w-0">
              <div className="relative min-h-0 min-w-0 flex-1">
                {bodyPane && (
                  <div className="absolute inset-0 min-h-0 min-w-0">
                    <WorkspacePaneBody
                      activeProjectId={activeProjectId}
                      activeProjectPath={activeProjectPath}
                      focusedPane={bodyPane}
                      focusedWorktreeDirName={focusedWorktreeDirName}
                      fileChangeSeq={fileChangeSeq}
                      gitState={gitState}
                      gitFileStatuses={gitFileStatuses}
                      filesSelection={filesSelection}
                      counters={counters}
                      gitMenuActions={gitMenuActions}
                      gitGraphSelection={gitGraphSelection}
                      onGitGraphSelectionChange={onGitGraphSelectionChange}
                      commitBusy={commitBusy}
                      commitError={commitError}
                      onClearCommitError={onClearCommitError}
                      onSubmitInlineCommit={onSubmitInlineCommit}
                      isMobile={isMobile}
                      browserOnClose={onClose}
                      workItemOnClose={onClose}
                      workItems={workItems}
                      worktrees={worktrees}
                      onUpdateWorkItem={onUpdateWorkItem}
                      onDeleteWorkItem={onDeleteWorkItem}
                      onBrowserUrlChange={onBrowserUrlChange}
                      onSelectWorktreeTab={onSelectWorktreeTab}
                      onOpenFilePath={handleOpenFilePath}
                      allowFilesGit={allowFilesGit}
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
              </div>
              {fileDisplayTarget && allowFilesGit && !isMobile && (
                <div className="h-full w-[42vw] min-w-80 max-w-[720px] shrink-0 border-l border-border bg-bg-primary">
                  <WorkspaceFileDisplay
                    projectId={activeProjectId}
                    target={fileDisplayTarget}
                    fileChangeSeq={fileChangeSeq}
                    onClose={handleCloseFileDisplay}
                  />
                </div>
              )}
            </div>
            {fileDisplayTarget && allowFilesGit && isMobile && (
              <DialogRoot
                open
                presentation="fullscreen"
                ariaLabel={`File preview: ${basename(fileDisplayTarget.filePath)}`}
                onClose={handleCloseFileDisplay}
                panelClassName="flex-col"
              >
                <WorkspaceFileDisplay
                  projectId={activeProjectId}
                  target={fileDisplayTarget}
                  fileChangeSeq={fileChangeSeq}
                  onClose={handleCloseFileDisplay}
                />
              </DialogRoot>
            )}
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

function buildGitChildTitle(selection: GitGraphSelection): string {
  if (selection.kind === "working-tree") return "Working tree";
  return selection.commit.sha.slice(0, 7);
}

function buildChildTitle(
  pane: PaneEntry,
  sessions: Session[],
  workItems: WorkItem[],
): string | null {
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
  if (state.kind === "work-item") {
    return (
      workItems.find((item) => item.id === state.workItemId)?.title ??
      "work item"
    );
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
