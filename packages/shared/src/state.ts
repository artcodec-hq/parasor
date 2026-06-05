import type { IdeCommandConfig } from "./ide-commands.js";
import type { PaneCommandConfig } from "./pane-commands.js";
import type { WorktreePanes } from "./pane-model.js";
import type { PaneNode } from "./panes.js";
import type { WorktreeLocalFileCandidate } from "./worktree-local-files.js";

export interface AppState {
  version: 1;
  projects: Project[];
  projectStates: Record<string, ProjectState>;
  sessions: Session[];
  /**
   * Daemon-mode persisted PTY records. Owned by
   * the `parasor-pty-host` daemon when it is the AppStateStore writer;
   * the in-process host does not write here. Empty `[]` in the safe-side
   * default deployment.
   */
  sessionRecords: SessionRecord[];
  serviceConfig: ServiceConfig;
  /**
   * User-defined commands shown by the Open Container terminal launcher.
   * The built-in empty-shell Terminal entry is client-owned UI behavior and
   * is intentionally not persisted here.
   */
  paneCommands: PaneCommandConfig[];
  /**
   * User-defined local IDE launch commands shown by worktree Open in IDE.
   * Executed server-side with fixed argv, never through a shell.
   */
  ideCommands: IdeCommandConfig[];
}

export type PortDetectionMode = "all-interfaces" | "off";

export interface ServiceConfig {
  /**
   * macOS only: spawn `caffeinate -i` while at least one WS client is
   * attached so an idle host does not sleep mid-session. Ignored on
   * other platforms.
   */
  preventIdleSleep: boolean;
  /**
   * Whether detected listening ports trigger a `port-detected` toast.
   * - `all-interfaces`: notify when a port is bound to 0.0.0.0/:: (reachable from mobile/Tailscale)
   * - `off`: no notification
   *
   * The previous `all` mode (every loopback port, including MCP/LSP/editor
   * RPC) was removed in local notify-mode cleanup -- the noise outweighed the value.
   */
  portDetection: PortDetectionMode;
  /**
   * OS file-drop upload size cap, in bytes. Drops larger than this are
   * rejected with 413. Default `DEFAULT_DROP_SIZE_MAX_BYTES`.
   */
  dropSizeMaxBytes: number;
  /**
   * Absolute upper bound for `dropSizeMaxBytes` the UI is allowed to set;
   * the server enforces it independently as a belt-and-suspenders check
   * against a hand-edited state.json. Default `DEFAULT_DROP_SIZE_HARD_MAX_BYTES`.
   */
  dropSizeHardMaxBytes: number;
}

/**
 * Server default upload cap for OS file drops (10 MiB). Also used by the
 * web client when `serviceConfig.dropSizeMaxBytes` is absent.
 */
export const DEFAULT_DROP_SIZE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Absolute ceiling for user-configurable `dropSizeMaxBytes` (100 MiB).
 */
export const DEFAULT_DROP_SIZE_HARD_MAX_BYTES = 100 * 1024 * 1024;

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastAccessedAt: number;
  pinned?: boolean;
  readOnly?: boolean;
  /**
   * Manual sort index assigned via DnD reorder.
   * When present, takes precedence over `lastAccessedAt`. Pinned-first still
   * applies. Lower = earlier.
   */
  order?: number;
  /**
   * Project-local ignored regular files the user chose to copy into newly
   * created linked worktrees. Paths are relative to the main checkout.
   */
  worktreeLocalFileAllowlist?: WorktreeLocalFileCandidate["path"][];
}

export interface ProjectState {
  projectId: string;
  /**
   * Legacy split-tree layout. Kept so existing reducers compile while UI
   * code moves to `worktrees`.
   */
  layout: PaneNode | null;
  /**
   * Worktree-scoped pane list. Empty until the server first reconciles git
   * worktrees for the project.
   */
  worktrees: WorktreePanes[];
  openFiles: string[];
  /** Legacy focus pointer into `layout`. Removed in 1.4-f. */
  lastFocusedPaneId: string | null;
  /** New focus pointer into `worktrees[].panes[].id`. */
  focusedPaneId: string | null;
  lastAccessedAt: number;
}

export type SessionCommand =
  | { type: "shell" }
  | { type: "claude" }
  | { type: "custom"; command: string; args: string[] };

export type SessionEndReason =
  | { type: "exit"; code: number }
  | { type: "signal"; signal: number }
  | { type: "server-graceful" }
  | { type: "server-crash" }
  | { type: "daemon-graceful" }
  | { type: "daemon-crash" };

export interface Session {
  id: string;
  projectId: string;
  pid: number | null;
  /**
   * spawning = created, PTY not yet spawned (waiting for first WS init)
   * running  = PTY alive
   * ended    = process exited; scrollback preserved for restart
   */
  state: "spawning" | "running" | "ended";
  generation: number;
  title: string;
  /** True when the user explicitly renamed the terminal title. */
  titleManual?: boolean;
  command: SessionCommand;
  cwd: string;
  shell: string;
  createdAt: number;
  endedAt?: number;
  endReason?: SessionEndReason;
  /** User-pinned terminal sessions surface in the Monitor global view. */
  pinned?: boolean;
}
/**
 * Persisted record describing a daemon-owned PTY session
 *. The shape diverges from `Session` because
 * the daemon needs richer process metadata for orphan cleanup and the
 * `pty-host doctor` CLI: pid/pgid for `kill(0)` liveness and group
 * teardown, argv for `ps -p` re-verification, daemonPid+startedAt to
 * detect "different daemon than wrote this record".
 *
 * `state` is intentionally narrower than `Session.state`:
 *   - "running"  : pid alive, owned by current daemon generation
 *   - "exited"   : process exited cleanly (exitCode/exitSignal recorded)
 *   - "lost"     : pid disappeared without a recorded exit (parent died,
 *                  SIGKILL with no reaper, etc.) -- record is dead state
 *   - "orphaned" : pid alive, written by a previous daemon generation --
 *                  reachable only via `pty-host doctor` reap
 *
 * `pid`/`pgid` are nullable to cover the create-stub stage (record
 * inserted before the PTY is spawned by the first WS attach).
 */
export interface SessionRecord {
  id: string;
  projectId: string;
  command: SessionCommand;
  cwd: string;
  pid: number | null;
  pgid: number | null;
  argv: string[];
  /** ISO8601 timestamp the underlying process was spawned (or stub created). */
  startedAt: string;
  state: "running" | "exited" | "lost" | "orphaned";
  exitCode: number | null;
  exitSignal: string | null;
  /** PID of the daemon that wrote this record. */
  daemonPid: number;
  /** ISO8601 timestamp of that daemon's startup; together with daemonPid identifies the writer generation. */
  daemonStartedAt: string;
}
