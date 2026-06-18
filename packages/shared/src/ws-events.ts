import type { IdeCommandConfig } from "./ide-commands.js";
import type { PaneCommandConfig } from "./pane-commands.js";
import type { WorktreePanes } from "./pane-model.js";
import type { PaneNode } from "./panes.js";
import type {
  AgentState,
  GitState,
  Notification,
  PortInfo,
  SessionActivityRecord,
  Worktree,
} from "./runtime.js";
import type { RuntimeServiceInfo } from "./runtime-services.js";
import type {
  AppState,
  Project,
  ProjectSidebarState,
  ServiceConfig,
  Session,
  SessionEndReason,
} from "./state.js";

export type WsEventMessage =
  | { type: "session-created"; session: Session }
  | { type: "session-closed"; sessionId: string; projectId: string }
  | { type: "agent-state"; state: AgentState }
  | { type: "notification"; notification: Notification }
  | { type: "project-created"; project: Project }
  | { type: "project-updated"; project: Project }
  | { type: "project-deleted"; projectId: string }
  | {
      type: "worktree-created";
      projectId: string;
      worktree: Worktree;
    }
  | {
      type: "worktree-renamed";
      projectId: string;
      worktreePath: string;
      oldBranch: string;
      newBranch: string;
    }
  | {
      type: "worktree-removed";
      projectId: string;
      worktreePath: string;
    }
  | { type: "app-state-snapshot"; payload: HydrationPayload }
  | { type: "layout-updated"; projectId: string; layout: PaneNode | null }
  | {
      type: "panes-updated";
      projectId: string;
      worktrees: WorktreePanes[];
      focusedPaneId: string | null;
    }
  | { type: "session-restarted"; session: Session; generation: number }
  | {
      type: "session-ended";
      sessionId: string;
      generation: number;
      endReason: SessionEndReason;
      error?: string;
    }
  | { type: "browser-url-changed"; paneId: string; url: string }
  | {
      type: "activity-recorded";
      record: SessionActivityRecord;
    }
  | {
      type: "filetree-expanded";
      paneId: string;
      path: string;
      expanded: boolean;
    }
  | { type: "ports-updated"; projectId: string; ports: PortInfo[] }
  | {
      type: "services-updated";
      projectId: string;
      services: RuntimeServiceInfo[];
    }
  | {
      type: "git-state";
      projectId: string;
      worktreePath: string;
      state: GitState | null;
    }
  | {
      type: "file-change";
      projectId: string;
      event: "create" | "update" | "delete";
      path: string;
    }
  | { type: "gitignore-updated"; projectId: string }
  | { type: "session-cwd-changed"; sessionId: string; cwd: string }
  | {
      type: "session-title-changed";
      sessionId: string;
      title: string;
      titleManual?: boolean;
    }
  | { type: "session-pin-changed"; sessionId: string; pinned: boolean }
  | { type: "service-config-changed"; config: ServiceConfig }
  | {
      type: "sidebar-state-changed";
      projectId: string;
      sidebar: ProjectSidebarState;
    }
  | { type: "pane-commands-changed"; commands: PaneCommandConfig[] }
  | { type: "ide-commands-changed"; commands: IdeCommandConfig[] }
  | { type: "pong"; ts: number };

/**
 * Client->server messages on `/ws/events`. Heartbeat ping; the server
 * echoes a `pong` carrying the same `ts` so the client can detect
 * silent-dead TCP paths (NAT idle timeout, mobile background freeze)
 * where `ws.close` never fires.
 */
export type WsEventClientMessage = { type: "ping"; ts: number };

export interface HydrationPayload {
  seq: number;
  state: AppState;
  agentStates: Record<string, AgentState>;
  notifications: Notification[];
  ports: Record<string, PortInfo[]>;
  services: Record<string, RuntimeServiceInfo[]>;
  /**
   * Per-worktree git state, grouped by project. Outer key = projectId,
   * inner key = absolute worktree path. The project's main checkout
   * appears under its own path entry (no implicit "main" alias).
   */
  gitStates: Record<string, Record<string, GitState | null>>;
  /** Per-project worktree list (`git worktree list --porcelain` snapshot). */
  worktrees: Record<string, Worktree[]>;
  /** Most recent session activity records for hydration. */
  activityHistory?: SessionActivityRecord[];
  /**
   * Node process.platform of the host running parasor server. Web clients
   * use this to gate platform-specific UI (e.g. macOS-only service
   * toggles).
   */
  hostPlatform: NodeJS.Platform;
}

export interface WsEventEnvelope {
  seq: number;
  message: WsEventMessage;
}
