import type { SessionEndReason } from "./state.js";

export type AgentLifecycle =
  | "running"
  | "waiting"
  | "completed"
  | "idle"
  | "unknown";

export type AgentSignalSource = "hook" | "notify" | "output" | "activity";

export type AgentSignalConfidence = "high" | "medium" | "low";

export interface AgentState {
  sessionId: string;
  lifecycle: AgentLifecycle;
  source: AgentSignalSource;
  confidence: AgentSignalConfidence;
  detectedAt: number;
}

export type SessionActivityKind =
  | "session-created"
  | "session-restarted"
  | "session-ended"
  | "session-closed"
  | "agent-transition";

export type SessionActivitySource = AgentSignalSource | "daemon";

export interface SessionActivityRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  kind: SessionActivityKind;
  source: SessionActivitySource;
  summary: string;
  projectId?: string;
  agentLifecycle?: AgentLifecycle;
  endReason?: SessionEndReason;
  metadata?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  projectId: string;
  sessionId?: string;
  type: "agent-waiting" | "port-detected" | "info";
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  /** Populated for `port-detected` entries; consumed by toast UI. */
  port?: number;
  bindsAll?: boolean;
  /**
   * `true` when the port is reachable from the viewer device -- already
   * bound to all interfaces, fronted by a parasor TCP forwarder, or
   * parasor is loopback-bound so the viewer is on this machine and
   * `localhost:<port>` already works. (`port-detected` only.)
   */
  reachable?: boolean;
  /**
   * When a TCP forwarder fronts this dev port, the forwarder's OS-assigned
   * listen port. The viewer reaches the dev server at
   * `<page-host>:<reachablePort>`. (`port-detected` only.)
   */
  reachablePort?: number;
}

export interface PortInfo {
  port: number;
  pid: number;
  bindsAll: boolean;
  /**
   * See `Notification.reachable`. Set by the runtime when a `ports-updated`
   * broadcast is built (the bare port scanner does not know about the TCP
   * forwarder); `undefined` on hydration snapshots until the first
   * post-hydration `ports-updated` tick -- treat as `false`.
   */
  reachable?: boolean;
  /**
   * When a TCP forwarder fronts this dev port, the forwarder's OS-assigned
   * listen port. The viewer reaches the dev server at
   * `<page-host>:<reachablePort>`.
   */
  reachablePort?: number;
}

export type WorktreeCreationSource =
  | "ui"
  | "cli"
  | "runtime"
  | "agent"
  | "unknown";

export type WorktreeLineageCaptureSource =
  | "create-worktree-request"
  | "path-prefix"
  | "manual";

export type WorktreeLineageConfidence = "explicit" | "inferred";

export interface WorktreeLineageMetadata {
  /** Stable identity for this observed worktree instance, independent of path. */
  instanceId: string;
  creationSource: WorktreeCreationSource;
  createdAt: number;
  createdWithAgent?: string;
  createdBySessionId?: string;
  createdByPaneCommandId?: string;
  createdByPaneCommandLabel?: string;
  parentWorktreePath?: string;
  parentWorktreeInstanceId?: string;
  lineageCapture: {
    source: WorktreeLineageCaptureSource;
    confidence: WorktreeLineageConfidence;
  };
}

export interface Worktree {
  path: string;
  head: string;
  branch: string;
  /** Commits ahead of upstream (omitted when no upstream tracking). */
  ahead?: number;
  /** Commits behind upstream (omitted when no upstream tracking). */
  behind?: number;
  /** Tracked dirty + untracked file count for this worktree. */
  dirtyCount?: number;
  /**
   * Provenance hint. `"agent"` is set when the path matches a well-known
   * Agent Team isolation directory (`~/.parasor/worktrees/`,
   * `~/.claude/teams/`, `/private/tmp/parasor-issue-*`, `/tmp/parasor-issue-*`).
   * Surfaced as a sidebar pill so users can spot sub-agent checkouts.
   */
  origin?: "agent";
  /** Product-level provenance for explicitly created worktrees. */
  lineage?: WorktreeLineageMetadata;
  /**
   * `true` when `git worktree list --porcelain` enumerates the path but the
   * directory is missing on disk (`git status` returns `ENOENT`). Lets the
   * sidebar default the remove-dialog to `--force` so users can prune a
   * stranded entry in one click.
   */
  orphan?: boolean;
}

export type GitChangeArea = "staged" | "unstaged" | "untracked";

export type GitChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflict";

export interface GitChangeEntry {
  path: string;
  /** Primary staging area for compact source-control views. */
  area: GitChangeArea;
  status: GitChangeStatus;
  /** Single-letter compact status used by existing Git badges. */
  code: string;
  /** Present for rename/copy entries. */
  oldPath?: string;
  /** True for unmerged entries. */
  conflict?: boolean;
  /** Raw porcelain index status when present. */
  indexStatus?: string;
  /** Raw porcelain worktree status when present. */
  worktreeStatus?: string;
}

export interface GitState {
  branch: string;
  dirty: boolean;
  pullRequestUrl?: string;
  fileStatuses?: Record<string, string>;
  /**
   * Structured working-tree entries for richer source-control surfaces.
   * `fileStatuses` remains for compact badges and existing consumers.
   */
  changes?: GitChangeEntry[];
  /** Commits ahead of upstream. `undefined` when no upstream tracking. */
  ahead?: number;
  /** Commits behind upstream. `undefined` when no upstream tracking. */
  behind?: number;
  /**
   * Tracked changes + untracked entries (rename pairs counted once). Mirrors
   * the counter the sidebar/WorktreeTabBar surfaces; sourced from
   * `git status --porcelain=v2`.
   */
  dirtyCount?: number;
  /**
   * `false` when the worktree path is not a git repository (no `.git`).
   * Omitted (≡ `true`) for repos. Lets the Git pane render a `git init`
   * empty-state instead of a transient-error placeholder.
   */
  isRepo?: boolean;
  lastChecked: number;
}

/**
 * Symbolic ref attached to a commit. Type drives how the renderer paints it
 * (HEAD = solid badge, local/remote/tag = different outline colors).
 */
export type GitRefType = "head" | "local" | "remote" | "tag";

export interface GitRef {
  label: string;
  type: GitRefType;
}

/**
 * Snapshot of one swimlane (vertical column in the graph) at a row boundary.
 * `expectingSha` is the next commit the lane will link to (= the commit's
 * parent that travels down this lane). `colorId` is a stable 0..4 index the
 * renderer maps to `--theme-graph-branch-{colorId+1}`; the value is allocated
 * when the lane is first created and persists through every subsequent commit
 * sharing the lane, so a single branch keeps one color across its history.
 */
export interface SwimlaneSnapshot {
  colorId: number;
  expectingSha: string | null;
}

/**
 * One commit row in the Git graph, server-computed so the web client never
 * has to shell out. `inputSwimlanes` is the lane state immediately above this
 * row, `outputSwimlanes` immediately below. The renderer reads both to draw
 * connectors between rows. `lane` is the (post-compaction) horizontal index
 * of this commit's dot.
 */
export interface GitCommit {
  sha: string;
  parents: string[];
  author: string;
  /** Author timestamp (unix seconds). */
  time: number;
  subject: string;
  refs: GitRef[];
  /** Lane index (0-based) of this commit's dot in the rendered row. */
  lane: number;
  /** Branch color id (0..4). Stable across commits in the same branch. */
  colorId: number;
  /** Lane state above the row. Index = lane position. `null` = empty slot. */
  inputSwimlanes: Array<SwimlaneSnapshot | null>;
  /** Lane state below the row. Index = lane position. `null` = empty slot. */
  outputSwimlanes: Array<SwimlaneSnapshot | null>;
}

export interface GitLogResponse {
  commits: GitCommit[];
  /**
   * `true` when the worktree has uncommitted changes. The web Git graph
   * prepends a virtual "Working tree" row above the first commit when set,
   * which becomes the selectable target for the inline commit pane.
   */
  hasUncommitted: boolean;
}

/**
 * Ephemeral server-lifetime notice surfaced to the web UI as a banner. The
 * canonical case (daemon protocol mismatch recovery) is `daemon-auto-restarted`: the server detected a
 * `version-mismatch` from an incompatible running daemon, terminated it,
 * spawned a fresh daemon, and resumed boot. Active PTY sessions were lost
 * -- the banner explains why the session list is empty after an upgrade.
 *
 * Notices are in-memory only (cleared on server restart) and dismissable
 * per-kind via `DELETE /api/notices/:kind`.
 */
export type ServerNoticeKind = "daemon-auto-restarted";

export interface ServerNotice {
  kind: ServerNoticeKind;
  /** ISO timestamp the notice was recorded. */
  occurredAt: string;
  /** Server-side PROTOCOL_VERSION at recovery time. */
  serverProtocolVersion?: string;
  /** Daemon-side PROTOCOL_VERSION the new server NACKed. */
  daemonProtocolVersion?: string;
}

export interface ServerNoticesResponse {
  notices: ServerNotice[];
}
