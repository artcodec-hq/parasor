import type {
  PaneNode,
  SessionCommand,
  SessionLaunchPreset,
} from "@parasor/shared";
import { expandUserHome } from "../../lib/path.js";
import type { PtyHost } from "../../pty/host.js";
import type { AppStateStore } from "../../state/app-state.js";
import type { EventPublisher } from "../ports.js";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "./errors.js";

function removePaneBySessionId(
  node: PaneNode,
  sessionId: string,
): PaneNode | null {
  if (node.type === "terminal") {
    return node.sessionId === sessionId ? null : node;
  }
  if (node.type === "split") {
    const children: PaneNode[] = [];
    const sizes: number[] = [];

    for (let index = 0; index < node.children.length; index++) {
      const child = removePaneBySessionId(node.children[index], sessionId);
      if (child !== null) {
        children.push(child);
        sizes.push(node.sizes[index]);
      }
    }

    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes };
  }
  return node;
}

interface CreateSessionCommandsDeps {
  appStateStore: AppStateStore;
  eventBus: EventPublisher;
  ptyManager: PtyHost;
  isProjectMissing?: (projectId: string) => boolean;
}

export function createSessionCommands({
  appStateStore,
  eventBus,
  ptyManager,
  isProjectMissing,
}: CreateSessionCommandsDeps) {
  return {
    async createSession(input: {
      projectId: string;
      command?: SessionCommand;
      cwd?: string;
      title?: string;
      launchPreset?: SessionLaunchPreset;
      bootstrapInput?: string;
    }) {
      const project = appStateStore
        .get()
        .projects.find((entry) => entry.id === input.projectId);
      if (!project) {
        throw new WorkspaceNotFoundError("Project not found");
      }
      if (isProjectMissing?.(input.projectId)) {
        throw new WorkspaceConflictError("Project directory is missing");
      }

      const session = await ptyManager.create({
        projectId: input.projectId,
        command: input.command ?? { type: "shell" },
        cwd: expandUserHome(input.cwd ?? project.path),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.launchPreset !== undefined && {
          launchPreset: input.launchPreset,
        }),
        ...(input.bootstrapInput !== undefined && {
          bootstrapInput: input.bootstrapInput,
        }),
      });

      eventBus.broadcast({ type: "session-created", session });
      return session;
    },

    async setSessionPinned(id: string, pinned: boolean) {
      const session = ptyManager.get(id);
      if (!session) {
        throw new WorkspaceNotFoundError();
      }
      const changed = ptyManager.setPinned(id, pinned);
      if (changed) {
        eventBus.broadcast({
          type: "session-pin-changed",
          sessionId: id,
          pinned,
        });
      }
      const latest = ptyManager.get(id);
      return latest ?? session;
    },

    async setSessionTitle(id: string, rawTitle: string) {
      const session = ptyManager.get(id);
      if (!session) {
        throw new WorkspaceNotFoundError();
      }
      const title = rawTitle.trim();
      const titleManual = title.length > 0;
      const changed = ptyManager.setTitle(id, title, titleManual);
      if (changed) {
        eventBus.broadcast({
          type: "session-title-changed",
          sessionId: id,
          title,
          titleManual,
        });
      }
      const latest = ptyManager.get(id);
      return latest ?? session;
    },

    async restartSession(id: string) {
      const session = ptyManager.get(id);
      if (!session) {
        throw new WorkspaceNotFoundError();
      }
      if (session.state !== "ended") {
        throw new WorkspaceConflictError("Session is not ended");
      }

      const restarted = await ptyManager.restart(id);
      eventBus.broadcast({
        type: "session-restarted",
        session: restarted,
        generation: restarted.generation,
      });
      return restarted;
    },

    async deleteSession(id: string) {
      const session = ptyManager.get(id);
      if (!session) {
        throw new WorkspaceNotFoundError();
      }

      await ptyManager.dispose(id);

      appStateStore.mutateProjectStates((state) => {
        const projectState = state.projectStates[session.projectId];
        if (!projectState?.layout) return;

        const layout = removePaneBySessionId(projectState.layout, id);
        projectState.layout = layout;
        eventBus.broadcast({
          type: "layout-updated",
          projectId: session.projectId,
          layout,
        });
      });

      eventBus.broadcast({
        type: "session-closed",
        sessionId: id,
        projectId: session.projectId,
      });
    },
  };
}
