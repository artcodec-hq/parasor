import { existsSync } from "node:fs";

export type ProjectPresenceChange = (
  projectId: string,
  missing: boolean,
) => void;

export interface ProjectPresence {
  isMissing(projectId: string): boolean;
  missingIds(): string[];
  /**
   * Boot-only. Sync `existsSync`. Do **not** call from the 5 minute loop.
   * Returns whether the mark changed.
   */
  probeSync(project: { id: string; path: string }): boolean;
  markMissing(projectId: string, path: string, reason: string): boolean;
  markPresent(projectId: string, path: string): boolean;
  delete(projectId: string): void;
  /** Fired only after a mark *changes*. Set after the boot probe. */
  setOnChange(listener: ProjectPresenceChange | null): void;
}

export function createProjectPresence(): ProjectPresence {
  const missing = new Set<string>();
  let onChange: ProjectPresenceChange | null = null;

  return {
    isMissing(projectId) {
      return missing.has(projectId);
    },
    missingIds() {
      return [...missing];
    },
    probeSync(project) {
      if (existsSync(project.path)) {
        return this.markPresent(project.id, project.path);
      }
      return this.markMissing(project.id, project.path, "boot-probe");
    },
    markMissing(projectId, path, _reason) {
      if (missing.has(projectId)) return false;
      missing.add(projectId);
      console.warn(
        `[project-presence] missing project=${projectId} path=${path}`,
      );
      onChange?.(projectId, true);
      return true;
    },
    markPresent(projectId, path) {
      if (!missing.has(projectId)) return false;
      missing.delete(projectId);
      console.warn(
        `[project-presence] restored project=${projectId} path=${path}`,
      );
      onChange?.(projectId, false);
      return true;
    },
    delete(projectId) {
      missing.delete(projectId);
    },
    setOnChange(listener) {
      onChange = listener;
    },
  };
}
