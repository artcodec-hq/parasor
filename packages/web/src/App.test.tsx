import type { Project, Session, Worktree } from "@parasor/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authFetchMock, useEventSocketMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
  useEventSocketMock: vi.fn(),
}));

vi.mock("./lib/auth-fetch.js", () => ({
  AuthExpiredError: class AuthExpiredError extends Error {},
  authFetch: authFetchMock,
}));

vi.mock("./features/settings/index.js", () => ({
  SettingsOverlay: ({
    server,
  }: {
    server?: {
      onIdeCommandsChange?: (
        commands: Array<{
          id: string;
          label: string;
          command: string;
          args: string[];
        }>,
      ) => void;
    };
  }) => (
    <button
      type="button"
      onClick={() =>
        server?.onIdeCommandsChange?.([
          { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
        ])
      }
    >
      save ide command
    </button>
  ),
  useSettings: () => ({
    playAttentionSound: false,
    playCompletionSound: false,
  }),
}));

vi.mock("./hooks/useEventSocket.js", () => ({
  useEventSocket: useEventSocketMock,
}));

vi.mock("./components/sidebar/index.js", () => ({
  applyPaneOrderOverrides: <T,>(projects: T) => projects,
  buildSidebarProjects: ({ projects }: { projects: Project[] }) => projects,
  readClientBrowserChildPanes: () => ({}),
  Sidebar: ({
    onOpenContainer,
  }: {
    onOpenContainer?: (projectId: string, worktreeId: string) => void;
  }) => (
    <button type="button" onClick={() => onOpenContainer?.("p1", "wt:/repo")}>
      open terminal launcher
    </button>
  ),
}));

vi.mock("./components/overlays/OpenContainerDialog.js", () => ({
  OpenContainerDialog: ({
    commands,
    onCommandsChange,
    onRunCommand,
    worktree,
  }: {
    commands: Array<{ id: string; label: string; initialInput: string }>;
    onCommandsChange: (
      commands: Array<{ id: string; label: string; initialInput: string }>,
    ) => void;
    onRunCommand: (
      worktreePath: string,
      command: { id: string; label: string; initialInput: string },
    ) => void;
    worktree: { path: string };
  }) => (
    <div>
      <div data-testid="launcher-commands">
        {commands.map((command) => command.label).join(",")}
      </div>
      <button
        type="button"
        onClick={() => onRunCommand(worktree.path, commands[0])}
      >
        run terminal
      </button>
      <button
        type="button"
        onClick={() =>
          onCommandsChange([
            { id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" },
          ])
        }
      >
        save command
      </button>
    </div>
  ),
}));

vi.mock("./components/overlays/CommitDialog.js", () => ({
  CommitDialog: () => null,
}));
vi.mock("./components/overlays/NewWorktreeDialog.js", () => ({
  NewWorktreeDialog: () => null,
}));
vi.mock("./components/overlays/ProjectModal.js", () => ({
  ProjectModal: () => null,
}));
vi.mock("./components/overlays/RemoveWorktreeDialog.js", () => ({
  RemoveWorktreeDialog: () => null,
}));
vi.mock("./components/overlays/RenameWorktreeDialog.js", () => ({
  RenameWorktreeDialog: () => null,
}));

vi.mock("./components/toasts/CopyToast.js", () => ({ CopyToast: () => null }));
vi.mock("./components/toasts/OfflineBanner.js", () => ({
  OfflineBanner: () => null,
}));
vi.mock("./components/toasts/ServerNoticesBanner.js", () => ({
  ServerNoticesBanner: () => null,
}));
vi.mock("./components/toasts/SyncToastSet.js", () => ({
  SyncToastSet: () => null,
}));

vi.mock("./features/monitor/MonitorView.js", () => ({
  MonitorView: () => null,
}));

vi.mock("./features/workspace/WorkspacePaneRouter.js", () => ({
  WorkspacePaneRouter: ({
    activeProjectId,
    canOpenLocalIde,
    focusedPane,
    onDeleteProject,
    onRequestClosePane,
  }: {
    activeProjectId: string | null;
    canOpenLocalIde?: boolean;
    focusedPane: {
      id: string;
      state: { kind: string; sessionId?: string };
    } | null;
    onDeleteProject?: (projectId: string) => void;
    onRequestClosePane?: (
      paneId: string,
      paneKind: "terminal" | "browser",
      title: string,
    ) => void;
  }) => (
    <>
      <div data-testid="can-open-local-ide">{String(canOpenLocalIde)}</div>
      <div data-testid="active-project">{activeProjectId ?? "none"}</div>
      <div data-testid="focused-pane">
        {focusedPane?.state.kind === "terminal"
          ? `terminal:${focusedPane.state.sessionId}`
          : (focusedPane?.state.kind ?? "none")}
        {focusedPane?.state.kind === "terminal" && (
          <button
            type="button"
            onClick={() =>
              onRequestClosePane?.(focusedPane.id, "terminal", "Terminal")
            }
          >
            request close pane
          </button>
        )}
      </div>
      {activeProjectId && (
        <button
          type="button"
          onClick={() => onDeleteProject?.(activeProjectId)}
        >
          request close project
        </button>
      )}
    </>
  ),
}));

vi.mock("./features/workspace/useWorkspaceShell.js", () => ({
  useWorkspaceShell: () => ({
    closeSettings: vi.fn(),
    isMobile: false,
    openSettings: vi.fn(),
    settingsOpen: false,
  }),
}));

import { App } from "./App.js";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Project",
    path: "/repo",
    createdAt: 0,
    lastAccessedAt: 0,
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-new",
    projectId: "p1",
    pid: 1234,
    state: "running",
    generation: 0,
    title: "",
    command: { type: "shell" },
    cwd: "/repo",
    shell: "/bin/zsh",
    createdAt: 0,
    ...overrides,
  };
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    path: "/repo",
    head: "abc",
    branch: "main",
    ...overrides,
  };
}

function eventStore(overrides: Record<string, unknown> = {}) {
  return {
    projects: [project()],
    projectStates: {},
    sessions: [],
    agentStates: {},
    notifications: [],
    ports: {},
    gitStates: {},
    paneCommands: [],
    ideCommands: [],
    serviceConfig: {
      preventIdleSleep: false,
      portDetection: "all-interfaces",
      dropSizeMaxBytes: 10,
      dropSizeHardMaxBytes: 20,
    },
    hostPlatform: "darwin",
    fileChangeSeq: 0,
    worktrees: { p1: [worktree()] },
    pendingOpenUrl: null,
    connected: true,
    hydrated: true,
    snapshotApplied: true,
    eventSocketConnected: true,
    unreadCount: 0,
    markRead: vi.fn(),
    clearPendingUrl: vi.fn(),
    seedProject: vi.fn(),
    seedPaneCommands: vi.fn(),
    seedIdeCommands: vi.fn(),
    seedSidebarState: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  const localStore = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => localStore.get(key) ?? null,
    setItem: (key: string, value: string) =>
      void localStore.set(key, String(value)),
    removeItem: (key: string) => void localStore.delete(key),
    clear: () => void localStore.clear(),
  });
  localStorage.clear();
  localStorage.setItem(
    "parasor:preferences",
    JSON.stringify({ focusedProjectId: "p1" }),
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  useEventSocketMock.mockReturnValue(eventStore());
  authFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/sessions") {
      return {
        ok: true,
        json: async () => session(),
      };
    }
    if (url === "/api/pane-commands") {
      return {
        ok: true,
        json: async () => ({
          commands: [{ id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" }],
        }),
      };
    }
    if (url === "/api/ide-commands") {
      return {
        ok: true,
        json: async () => ({
          commands: [
            { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("App session creation routes", () => {
  it("shows a newly-created terminal immediately on desktop before the WS session-created event", async () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "open terminal launcher" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "run terminal" }));

    await waitFor(() => {
      expect(screen.getByTestId("focused-pane").textContent).toContain(
        "terminal:s-new",
      );
    });
    expect(window.location.pathname).toBe("/sessions/s-new");
  });

  it("uses server pane commands in the terminal launcher", () => {
    useEventSocketMock.mockReturnValue(
      eventStore({
        paneCommands: [
          { id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" },
        ],
      }),
    );

    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "open terminal launcher" }),
    );

    expect(screen.getByTestId("launcher-commands").textContent).toBe(
      "Terminal,Dev",
    );
  });

  it("saves edited pane commands through the server API", async () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "open terminal launcher" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "save command" }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith("/api/pane-commands", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: [{ id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" }],
        }),
      });
    });
  });

  it("saves edited IDE commands through the server API", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "save ide command" }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith("/api/ide-commands", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: [
            { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
          ],
        }),
      });
    });
  });

  it("rolls back optimistic pane commands and toasts when the save fails", async () => {
    const store = eventStore();
    useEventSocketMock.mockReturnValue(store);
    authFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/pane-commands") {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "open terminal launcher" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "save command" }));

    // Optimistic seed happens first with the edited commands.
    expect(store.seedPaneCommands).toHaveBeenNthCalledWith(1, [
      { id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" },
    ]);
    // On failure, App rolls back to the previous (empty) list and toasts.
    await waitFor(() => {
      expect(store.seedPaneCommands).toHaveBeenNthCalledWith(2, []);
    });
    expect(screen.getByText("Failed to save terminal commands")).toBeTruthy();
  });

  it("does not seed an optimistic session or navigate when create returns non-ok", async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/sessions") {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "open terminal launcher" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "run terminal" }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/sessions",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(screen.getByTestId("focused-pane").textContent).not.toContain(
      "terminal:s-new",
    );
    expect(window.location.pathname).toBe("/");
  });

  it("uses the server local IDE capability for workspace menus", async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/projects/local-ide-capability") {
        return {
          ok: true,
          json: async () => ({ canOpenLocalIde: true }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("can-open-local-ide").textContent).toBe("true");
    });
  });

  it("migrates legacy local pane commands only when the server list is empty", async () => {
    localStorage.setItem(
      "parasor:pane-commands",
      JSON.stringify([
        { id: "cmd:legacy", label: "Legacy", initialInput: "pnpm dev" },
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith("/api/pane-commands", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: [
            { id: "cmd:legacy", label: "Legacy", initialInput: "pnpm dev" },
          ],
        }),
      });
    });
  });

  it("shows a closeable missing-session state on desktop before hydration", () => {
    window.history.replaceState(null, "", "/sessions/missing-session");
    useEventSocketMock.mockReturnValue({
      ...eventStore(),
      sessions: [],
      connected: false,
      hydrated: false,
      snapshotApplied: false,
      eventSocketConnected: false,
    });

    render(<App />);

    expect(screen.getByText("Opening session")).toBeTruthy();
    expect(screen.getByText("missing-session")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(window.location.pathname).toBe("/");
  });

  it("clears a desktop session route before deleting the current terminal pane", async () => {
    window.history.replaceState(null, "", "/sessions/stale-session");
    let store = eventStore({
      sessions: [session({ id: "stale-session", title: "zsh" })],
    });
    useEventSocketMock.mockImplementation(() => store);

    const { rerender } = render(<App />);

    expect(screen.getByTestId("focused-pane").textContent).toContain(
      "terminal:stale-session",
    );

    fireEvent.click(screen.getByRole("button", { name: "request close pane" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(authFetchMock).toHaveBeenCalledWith("/api/sessions/stale-session", {
      method: "DELETE",
    });

    store = eventStore({ sessions: [] });
    rerender(<App />);

    expect(screen.queryByText("Session not found")).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("replaces a hydrated stale worktree route instead of reselecting a closed project", async () => {
    window.history.replaceState(
      null,
      "",
      "/worktree?project=p1&path=%2Frepo&tab=files",
    );
    localStorage.setItem(
      "parasor:preferences",
      JSON.stringify({
        focusedProjectId: "p2",
        focusedPaneId: "files:/repo2",
      }),
    );
    useEventSocketMock.mockReturnValue(
      eventStore({
        projects: [project({ id: "p2", name: "Project 2", path: "/repo2" })],
        worktrees: { p2: [worktree({ path: "/repo2" })] },
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByTestId("active-project").textContent).toBe("p2");
    expect(screen.getByTestId("focused-pane").textContent).toBe("files");
  });

  it("clears a routed project close before the delete broadcast removes that project", async () => {
    window.history.replaceState(
      null,
      "",
      "/worktree?project=p1&path=%2Frepo&tab=files",
    );
    let store = eventStore({
      projects: [
        project(),
        project({ id: "p2", name: "Project 2", path: "/repo2" }),
      ],
      worktrees: {
        p1: [worktree()],
        p2: [worktree({ path: "/repo2" })],
      },
    });
    useEventSocketMock.mockImplementation(() => store);

    const { rerender } = render(<App />);

    expect(screen.getByTestId("active-project").textContent).toBe("p1");

    fireEvent.click(
      screen.getByRole("button", { name: "request close project" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/projects/p1?force=true",
        {
          method: "DELETE",
        },
      );
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });

    store = eventStore({
      projects: [project({ id: "p2", name: "Project 2", path: "/repo2" })],
      worktrees: { p2: [worktree({ path: "/repo2" })] },
    });
    rerender(<App />);

    expect(window.location.pathname).toBe("/");
    await waitFor(() => {
      expect(screen.getByTestId("active-project").textContent).toBe("p2");
    });
    expect(screen.getByTestId("focused-pane").textContent).toBe("files");
  });

  it("shows a closeable unavailable-session state for a non-resumable ended route session", () => {
    window.history.replaceState(null, "", "/sessions/crashed-session");
    useEventSocketMock.mockReturnValue({
      ...eventStore(),
      sessions: [
        session({
          id: "crashed-session",
          pid: null,
          state: "ended",
          title: "zsh",
          endReason: { type: "daemon-crash" },
        }),
      ],
    });

    render(<App />);

    expect(
      screen.getByText("parasor PTY host exited unexpectedly"),
    ).toBeTruthy();
    expect(screen.getByText("zsh")).toBeTruthy();
    expect(screen.queryByTestId("focused-pane")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(window.location.pathname).toBe("/");
    expect(authFetchMock).toHaveBeenCalledWith(
      "/api/sessions/crashed-session",
      {
        method: "DELETE",
      },
    );
  });
});
