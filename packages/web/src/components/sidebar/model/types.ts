import type { WorktreeLineageMetadata } from "@parasor/shared";
import type { AgentDotState } from "../../primitives/index.js";

/**
 * View-model shapes consumed by the single-column Sidebar. Derived from
 * `WorktreePanes` + `Session` + `Project` so the presentational tree has
 * no knowledge of wire formats.
 */

export type SidebarChildKind = "terminal" | "browser";

export interface SidebarChild {
  id: string;
  kind: SidebarChildKind;
  label: string;
  /** Subtext rendered next to the label. Kept short so it fits one line. */
  hint?: string;
  status: AgentDotState;
  /** Terminal pin state. Always `false` for browser children. */
  pinned: boolean;
  /** Only meaningful for kind==="browser": true = auto port detection. */
  auto?: boolean;
  /**
   * Only meaningful for kind==="terminal". Identifies the agent runtime so
   * the row icon can specialise.
   * Undefined = generic shell.
   */
  agentType?: string;
}

export interface SidebarWorktree {
  id: string;
  name: string;
  path: string;
  /** Current HEAD (active worktree in `git worktree list`). */
  active: boolean;
  /** Numbers we don't yet surface (`dirty` / `ahead` / `behind`) stay 0. */
  dirty: number;
  ahead: number;
  behind: number;
  children: SidebarChild[];
  /** Any child has `status === "working"` -- retained as an agent rollup. */
  hasWorkingChild: boolean;
  /** Any child has `status === "attention"` -- retained as an agent rollup. */
  hasAlertChild: boolean;
  /**
   * Optional provenance pill -- `"agent"` when the path lives under an
   * Agent Team isolation root (see `Worktree.origin`).
   */
  origin?: "agent";
  lineage?: WorktreeLineageMetadata;
  /**
   * `true` when the worktree path no longer exists on disk. The sidebar
   * surfaces a pill and the remove dialog defaults to `--force`.
   */
  orphan?: boolean;
}

export interface SidebarProject {
  id: string;
  name: string;
  path: string;
  pinned: boolean;
  readOnly: boolean;
  /**
   * Project root's git state. `false` when the directory is not a git
   * repository (lets the sidebar disable per-project actions like *New
   * worktree*). `undefined` until the first git poll lands; consumers
   * default to "is a repo" so they don't strobe-disable on hydration.
   */
  isRepo?: boolean;
  worktrees: SidebarWorktree[];
}

export interface SidebarSelection {
  /** Top-level Monitor view (cross-project). */
  monitor: boolean;
  /** Currently-open worktree id. */
  selectedWorktreeId: string | null;
  /** Currently-open child (terminal/browser) id, if any. */
  selectedChildId: string | null;
}
