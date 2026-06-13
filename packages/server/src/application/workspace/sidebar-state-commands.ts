import {
  applyProjectSidebarStatePatch,
  createEmptyProjectSidebarState,
  type ProjectSidebarState,
  type ProjectSidebarStatePatch,
} from "@parasor/shared";
import type { AppStateStore } from "../../state/app-state.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventPublisher } from "../ports.js";
import { WorkspaceNotFoundError } from "./errors.js";

interface CreateSidebarStateCommandsDeps {
  appStateStore: AppStateStore;
  eventBus: EventPublisher;
  projectManager: ProjectManager;
}

export function createSidebarStateCommands({
  appStateStore,
  eventBus,
  projectManager,
}: CreateSidebarStateCommandsDeps) {
  return {
    updateSidebarState(
      projectId: string,
      patch: ProjectSidebarStatePatch,
    ): ProjectSidebarState {
      if (!projectManager.get(projectId)) {
        throw new WorkspaceNotFoundError();
      }

      let result = createEmptyProjectSidebarState();
      let foundState = false;
      appStateStore.mutateProjectStates((state) => {
        const projectState = state.projectStates[projectId];
        if (!projectState) return;
        foundState = true;
        const next = applyProjectSidebarStatePatch(projectState.sidebar, patch);
        projectState.sidebar = next;
        result = next;
      });
      if (!foundState) {
        throw new WorkspaceNotFoundError();
      }

      eventBus.broadcast({
        type: "sidebar-state-changed",
        projectId,
        sidebar: result,
      });
      return result;
    },
  };
}

export type SidebarStateCommands = ReturnType<
  typeof createSidebarStateCommands
>;
