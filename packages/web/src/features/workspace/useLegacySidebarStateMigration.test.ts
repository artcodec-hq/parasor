import type { ProjectState } from "@parasor/shared";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarProject } from "../../components/sidebar/index.js";
import { useLegacySidebarStateMigration } from "./useLegacySidebarStateMigration.js";

function project(): SidebarProject {
  return {
    id: "p1",
    name: "demo",
    path: "/repo",
    pinned: false,
    readOnly: false,
    worktrees: [
      {
        id: "wt:/repo",
        name: "main",
        path: "/repo",
        active: true,
        dirty: 0,
        ahead: 0,
        behind: 0,
        children: [],
        hasWorkingChild: false,
        hasAlertChild: false,
      },
    ],
  };
}

function projectState(
  sidebar: ProjectState["sidebar"] = { paneOrder: {}, worktreeOpen: {} },
): Record<string, ProjectState> {
  return {
    p1: {
      projectId: "p1",
      layout: null,
      worktrees: [],
      openFiles: [],
      lastFocusedPaneId: null,
      focusedPaneId: null,
      sidebar,
      lastAccessedAt: 1,
    },
  };
}

beforeEach(() => {
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) =>
      void values.set(key, String(value)),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
});

describe("useLegacySidebarStateMigration", () => {
  it("does not run before hydration", () => {
    const onMigrate = vi.fn();
    renderHook(() =>
      useLegacySidebarStateMigration({
        hydrated: false,
        projects: [project()],
        projectStates: projectState(),
        onMigrate,
      }),
    );
    expect(onMigrate).not.toHaveBeenCalled();
  });

  it("migrates legacy pane order and disclosure once server state is empty", async () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/repo": ["terminal:s1"], "/stale": ["ghost"] }),
    );
    window.localStorage.setItem(
      "parasor:sidebar:worktree-open:p1",
      JSON.stringify({ "/repo": false, "/stale": false }),
    );
    const onMigrate = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useLegacySidebarStateMigration({
        hydrated: true,
        projects: [project()],
        projectStates: projectState(),
        onMigrate,
      }),
    );

    expect(onMigrate).toHaveBeenCalledWith("p1", {
      paneOrder: { "/repo": ["terminal:s1"] },
      worktreeOpen: { "/repo": false },
    });
    await waitFor(() => {
      expect(window.localStorage.getItem("paneOrder:p1")).toBeNull();
    });
  });

  it("does not overwrite server fields that already have data", () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/repo": ["terminal:s1"] }),
    );
    window.localStorage.setItem(
      "parasor:sidebar:worktree-open:p1",
      JSON.stringify({ "/repo": false }),
    );
    const onMigrate = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useLegacySidebarStateMigration({
        hydrated: true,
        projects: [project()],
        projectStates: projectState({
          paneOrder: { "/repo": ["terminal:server"] },
          worktreeOpen: {},
        }),
        onMigrate,
      }),
    );

    expect(onMigrate).toHaveBeenCalledWith("p1", {
      worktreeOpen: { "/repo": false },
    });
  });

  it("does not re-run after the first hydrated attempt", () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/repo": ["terminal:s1"] }),
    );
    const onMigrate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ hydrated }: { hydrated: boolean }) =>
        useLegacySidebarStateMigration({
          hydrated,
          projects: [project()],
          projectStates: projectState(),
          onMigrate,
        }),
      { initialProps: { hydrated: false } },
    );

    rerender({ hydrated: true });
    rerender({ hydrated: true });
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });
});
