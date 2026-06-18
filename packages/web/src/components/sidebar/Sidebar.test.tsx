import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../../lib/sidebar-width.js";
import type { SidebarProject, SidebarSelection } from "./model/types.js";
import { Sidebar } from "./Sidebar.js";

const selection: SidebarSelection = {
  monitor: false,
  selectedChildId: null,
  selectedWorktreeId: null,
};

const projects: SidebarProject[] = [
  {
    id: "project-1",
    name: "Project",
    path: "/repo",
    pinned: false,
    readOnly: false,
    worktrees: [],
  },
];

const projectsWithRows: SidebarProject[] = [
  {
    id: "project-1",
    name: "Project",
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
        children: [
          {
            id: "terminal:s1",
            kind: "terminal",
            label: "codex",
            status: "idle",
            pinned: false,
          },
        ],
        hasWorkingChild: false,
        hasAlertChild: false,
      },
    ],
  },
];

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <Sidebar
      projects={projects}
      selection={selection}
      connected
      {...overrides}
    />,
  );
}

describe("Sidebar resize", () => {
  afterEach(() => cleanup());

  it("renders no resize handle unless desktop sidebar opts in", () => {
    renderSidebar({ width: 280, onWidthChange: vi.fn() });

    expect(
      screen.queryByRole("separator", { name: "Resize sidebar" }),
    ).toBeNull();
  });

  it("resizes from pointer drag and clamps to the allowed range", () => {
    const onWidthChange = vi.fn();
    renderSidebar({ width: 280, resizable: true, onWidthChange });
    const aside = screen.getByLabelText("Workspace navigation");
    vi.spyOn(aside, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 10,
      right: 290,
      toJSON: () => ({}),
      top: 0,
      width: 280,
      x: 10,
      y: 0,
    });

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle.className).toContain("before:-inset-x-3");
    fireEvent.pointerDown(handle, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(onWidthChange).toHaveBeenNthCalledWith(1, SIDEBAR_WIDTH_MIN);
    expect(onWidthChange).toHaveBeenNthCalledWith(2, SIDEBAR_WIDTH_MAX);
  });

  it("supports keyboard resize controls", () => {
    const onWidthChange = vi.fn();
    renderSidebar({ width: 280, resizable: true, onWidthChange });
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "End" });

    expect(onWidthChange).toHaveBeenNthCalledWith(1, 296);
    expect(onWidthChange).toHaveBeenNthCalledWith(2, 232);
    expect(onWidthChange).toHaveBeenNthCalledWith(3, SIDEBAR_WIDTH_MIN);
    expect(onWidthChange).toHaveBeenNthCalledWith(4, SIDEBAR_WIDTH_MAX);
  });
});

describe("Sidebar project actions", () => {
  afterEach(() => cleanup());

  it("uses the shared chrome height token in both desktop and fill sidebars", () => {
    renderSidebar({
      projects: projectsWithRows,
      onSelectMonitor: vi.fn(),
      onSelectWorktree: vi.fn(),
      onSelectChild: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /Monitor/ }).className).toContain(
      "h-bar",
    );
    expect(
      screen.getByRole("button", { name: "Reorder Project" }).className,
    ).toContain("h-bar");
    expect(screen.getByRole("button", { name: /codex/ }).className).toContain(
      "h-bar",
    );

    cleanup();

    renderSidebar({
      fill: true,
      projects: projectsWithRows,
      onSelectMonitor: vi.fn(),
      onSelectWorktree: vi.fn(),
      onSelectChild: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /Monitor/ }).className).toContain(
      "h-bar",
    );
    expect(
      screen.getByRole("button", { name: "Reorder Project" }).className,
    ).toContain("h-bar");
    expect(screen.getByRole("button", { name: /codex/ }).className).toContain(
      "h-bar",
    );
  });

  it("replaces footer connection text with a project add button", () => {
    const onNewProject = vi.fn();
    renderSidebar({ onNewProject });

    expect(screen.getByRole("button", { name: "Network ports" })).toBeTruthy();
    expect(screen.queryByText("connected")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("shows new detected ports as a network dot until the port list is opened", () => {
    const baseProps = {
      projects,
      selection,
      connected: true,
      projectNames: { "project-1": "Project" },
      portsByProjectId: {},
    };
    const { rerender } = render(<Sidebar {...baseProps} />);

    expect(screen.getByRole("button", { name: "Network ports" })).toBeTruthy();

    rerender(
      <Sidebar
        {...baseProps}
        portsByProjectId={{
          "project-1": [
            { port: 5173, pid: 10, bindsAll: true, reachable: true },
          ],
        }}
      />,
    );

    const unreadButton = screen.getByRole("button", {
      name: "Network ports, new ports",
    });
    expect(unreadButton).toBeTruthy();

    fireEvent.click(unreadButton);

    expect(screen.getByText("Detected ports")).toBeTruthy();
    expect(screen.getByText("5173")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Network ports" })).toBeTruthy();
  });

  it("opens reachable ports through the sidebar network list", () => {
    const onOpenUrl = vi.fn();
    renderSidebar({
      projectNames: { "project-1": "Project" },
      portsByProjectId: {
        "project-1": [{ port: 5173, pid: 10, bindsAll: true, reachable: true }],
      },
      onOpenUrl,
    });

    fireEvent.click(screen.getByRole("button", { name: "Network ports" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onOpenUrl).toHaveBeenCalledWith("http://localhost:5173", {
      projectId: "project-1",
    });
  });

  it("renders service context and prefers advertised URLs for open and copy", () => {
    const onOpenUrl = vi.fn();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderSidebar({
      projectNames: { "project-1": "Project" },
      sessions: [
        {
          id: "s1",
          projectId: "project-1",
          pid: 100,
          state: "running",
          generation: 1,
          title: "dev",
          command: { type: "shell" },
          cwd: "/repo",
          shell: "/bin/zsh",
          createdAt: 1,
        },
      ],
      servicesByProjectId: {
        "project-1": [
          {
            id: "svc",
            kind: "workspace",
            port: 5173,
            pid: 100,
            processName: "vite",
            bindHost: "127.0.0.1",
            connectHost: "127.0.0.1",
            bindsAll: false,
            protocol: "http",
            serviceName: "vite",
            attribution: {
              source: "session-process-tree",
              confidence: "high",
              projectId: "project-1",
              worktreePath: "/repo",
              sessionId: "s1",
            },
            advertisedUrl: {
              origin: "https://app.test:5173",
              protocol: "https",
              host: "app.test",
              hostKind: "custom",
              sourceSessionId: "s1",
              capturedAt: 1,
              validatedListenerPid: 100,
            },
            reachable: true,
            lifecycle: "reachable",
            firstSeenAt: 1,
            lastSeenAt: 1,
            source: "scanner",
          },
        ],
      },
      onOpenUrl,
    });

    fireEvent.click(screen.getByRole("button", { name: "Network ports" }));
    expect(screen.getByText("vite")).toBeTruthy();
    expect(screen.getByText("Project - repo - dev")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("https://app.test:5173");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://app.test:5173", {
      projectId: "project-1",
    });
  });

  it("does not open advertised URLs for unreachable services", () => {
    const onOpenUrl = vi.fn();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderSidebar({
      projectNames: { "project-1": "Project" },
      servicesByProjectId: {
        "project-1": [
          {
            id: "svc-loopback",
            kind: "workspace",
            port: 5173,
            pid: 100,
            processName: "vite",
            bindHost: "127.0.0.1",
            connectHost: "127.0.0.1",
            bindsAll: false,
            protocol: "http",
            serviceName: "vite",
            attribution: {
              source: "session-process-tree",
              confidence: "high",
              projectId: "project-1",
              worktreePath: "/repo",
              sessionId: "s1",
            },
            advertisedUrl: {
              origin: "http://localhost:5173",
              protocol: "http",
              host: "localhost",
              hostKind: "loopback",
              sourceSessionId: "s1",
              capturedAt: 1,
              validatedListenerPid: 100,
            },
            reachable: false,
            lifecycle: "localhost-only",
            firstSeenAt: 1,
            lastSeenAt: 1,
            source: "scanner",
          },
        ],
      },
      onOpenUrl,
    });

    fireEvent.click(screen.getByRole("button", { name: "Network ports" }));
    expect(screen.getByText("Project - repo - localhost only")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("http://localhost:5173");

    const open = screen.getByRole("button", { name: "Open" });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(open);
    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it("surfaces forwarder lifecycle details for service rows", () => {
    renderSidebar({
      projectNames: { "project-1": "Project" },
      servicesByProjectId: {
        "project-1": [
          {
            id: "svc-pending",
            kind: "workspace",
            port: 5173,
            pid: 100,
            processName: "vite",
            bindHost: "127.0.0.1",
            connectHost: "127.0.0.1",
            bindsAll: false,
            protocol: "http",
            serviceName: "vite",
            attribution: {
              source: "session-process-tree",
              confidence: "high",
              projectId: "project-1",
              worktreePath: "/repo",
              sessionId: "s1",
            },
            reachable: false,
            lifecycle: "forwarder-pending",
            firstSeenAt: 1,
            lastSeenAt: 1,
            source: "scanner",
          },
          {
            id: "svc-failed",
            kind: "workspace",
            port: 5174,
            pid: 101,
            processName: "vite",
            bindHost: "127.0.0.1",
            connectHost: "127.0.0.1",
            bindsAll: false,
            protocol: "http",
            serviceName: "vite",
            attribution: {
              source: "session-process-tree",
              confidence: "high",
              projectId: "project-1",
              worktreePath: "/repo",
              sessionId: "s1",
            },
            reachable: false,
            lifecycle: "forwarder-failed",
            firstSeenAt: 1,
            lastSeenAt: 1,
            source: "scanner",
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Network ports" }));

    expect(screen.getByText("Project - repo - forwarder pending")).toBeTruthy();
    expect(screen.getByText("Project - repo - forwarder failed")).toBeTruthy();
  });

  it("removes closed ports from the sidebar network list", () => {
    const baseProps = {
      projects,
      selection,
      connected: true,
      projectNames: { "project-1": "Project" },
    };
    const { rerender } = render(
      <Sidebar
        {...baseProps}
        portsByProjectId={{
          "project-1": [
            { port: 5173, pid: 10, bindsAll: true, reachable: true },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Network ports" }));
    expect(screen.getByText("5173")).toBeTruthy();

    rerender(<Sidebar {...baseProps} portsByProjectId={{}} />);

    expect(screen.queryByText("5173")).toBeNull();
    expect(screen.getByText("No detected ports")).toBeTruthy();
  });

  it("renders a visible New Project row in addition to the footer action", () => {
    const onNewProject = vi.fn();
    renderSidebar({ onNewProject });

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
  });

  it("routes child pin toggles without selecting the child row", () => {
    const onToggleChildPin = vi.fn();
    const onSelectChild = vi.fn();
    renderSidebar({
      projects: projectsWithRows,
      onSelectChild,
      onToggleChildPin,
    });

    fireEvent.click(screen.getByRole("button", { name: "Pin to Monitor" }));

    expect(onToggleChildPin).toHaveBeenCalledWith("terminal:s1");
    expect(onSelectChild).not.toHaveBeenCalled();
  });

  it("highlights only the child row when a child is selected", () => {
    renderSidebar({
      projects: projectsWithRows,
      selection: {
        monitor: false,
        selectedWorktreeId: "wt:/repo",
        selectedChildId: "terminal:s1",
      },
    });

    expect(
      screen.getByRole("button", { name: "Reorder Project" }).className,
    ).not.toContain("bg-row-hover-bg");
    expect(screen.getByRole("button", { name: /codex/ }).className).toContain(
      "bg-row-selected-bg",
    );
  });

  it("uses the shared selected row treatment when the worktree is selected", () => {
    renderSidebar({
      projects: projectsWithRows,
      selection: {
        monitor: false,
        selectedWorktreeId: "wt:/repo",
        selectedChildId: null,
      },
    });

    expect(
      screen.getByRole("button", { name: "Reorder Project" }).className,
    ).toContain("bg-row-selected-bg");
    expect(
      screen.getByRole("button", { name: /codex/ }).className,
    ).not.toContain("bg-row-selected-bg");
  });

  it("does not render a project overflow menu in the sidebar", () => {
    renderSidebar({ projects: projectsWithRows });

    expect(screen.queryByRole("button", { name: "Project menu" })).toBeNull();
  });
});
