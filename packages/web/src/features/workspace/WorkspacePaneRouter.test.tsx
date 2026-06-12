import {
  makeBrowserPane,
  makeTerminalPane,
  type Session,
} from "@parasor/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaGlyph } from "../../components/primitives/index.js";
import type { IdeEditor } from "../../lib/git-api.js";
import {
  buildSessionCrumbs,
  WorkspacePaneRouter,
} from "./WorkspacePaneRouter.js";

function makeMatchMedia(coarsePointer: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
}

vi.mock("./views/TerminalPaneView.js", () => ({
  TerminalPaneView: ({
    paneId,
    state,
    pin,
    onClose,
    onOpenFilePath,
  }: {
    paneId: string;
    state: { sessionId: string };
    pin?: { onToggle: () => void } | null;
    onClose?: () => void;
    onOpenFilePath?: (filePath: string) => void;
  }) => (
    <div data-pane-id={paneId} data-testid={`terminal-pane-${state.sessionId}`}>
      <span>{state.sessionId}</span>
      <input aria-label={`terminal input ${state.sessionId}`} />
      {pin && (
        <button type="button" onClick={pin.onToggle}>
          pin
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose}>
          close
        </button>
      )}
      {onOpenFilePath && (
        <button
          type="button"
          onClick={() => onOpenFilePath("packages/web/src/App.tsx")}
        >
          open file
        </button>
      )}
    </div>
  ),
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  });
  vi.stubGlobal("matchMedia", makeMatchMedia(false));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function glyphType(crumb: { glyph?: unknown } | undefined): unknown {
  if (!crumb?.glyph || !isValidElement(crumb.glyph)) return null;
  return crumb.glyph.type;
}

describe("buildSessionCrumbs", () => {
  it("uses the folder glyph for the project root when the project is not a git repo", () => {
    const crumbs = buildSessionCrumbs("acme", "root", true, false, null);
    expect(crumbs.map((c) => c.label)).toEqual(["acme", "root"]);
    expect(glyphType(crumbs[1])).toBe(PaGlyph.folder);
  });

  it("uses the git glyph for the focused root of a git repo", () => {
    const crumbs = buildSessionCrumbs("acme", "main", true, true, null);
    expect(crumbs.map((c) => c.label)).toEqual(["acme", "main"]);
    expect(glyphType(crumbs[1])).toBe(PaGlyph.git);
  });

  it("uses the git glyph for an inactive worktree of a git repo", () => {
    const crumbs = buildSessionCrumbs("acme", "feature", false, true, null);
    expect(crumbs.map((c) => c.label)).toEqual(["acme", "feature"]);
    expect(glyphType(crumbs[1])).toBe(PaGlyph.git);
  });

  it("appends the branch crumb when branchName is non-null", () => {
    const crumbs = buildSessionCrumbs("acme", "main", true, true, "develop");
    expect(crumbs.map((c) => c.label)).toEqual(["acme", "main", "develop"]);
    expect(glyphType(crumbs[2])).toBe(PaGlyph.branch);
  });

  it("omits the branch crumb when branchName is null (e.g. non-repo)", () => {
    const crumbs = buildSessionCrumbs("acme", "root", true, false, null);
    expect(crumbs).toHaveLength(2);
  });

  it("falls back to the parasor placeholder when no crumbs are produced", () => {
    const crumbs = buildSessionCrumbs(null, null, false, true, null);
    expect(crumbs.map((c) => c.label)).toEqual(["parasor"]);
  });
});

describe("WorkspacePaneRouter browser close", () => {
  it.each([
    { isMobile: false, label: "desktop" },
    { isMobile: true, label: "mobile" },
  ])("places Browser pane close in the address header on $label", ({
    isMobile,
  }) => {
    const onRequestClosePane = vi.fn();
    renderBrowserPane({ isMobile, onRequestClosePane });

    const workspaceHeader = screen.getByRole("toolbar", {
      name: "Workspace",
    });
    expect(within(workspaceHeader).getByText("Project")).toBeTruthy();
    expect(within(workspaceHeader).getByText("main")).toBeTruthy();
    expect(
      within(workspaceHeader).queryByRole("button", { name: "Close pane" }),
    ).toBeNull();

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    const closeButton = within(addressBar).getByRole("button", {
      name: "Close pane",
    });
    fireEvent.click(closeButton);

    expect(onRequestClosePane).toHaveBeenCalledWith(
      "browser:p1-main",
      "browser",
      "example.com",
    );
  });

  it.each([
    { isMobile: false, label: "desktop" },
    { isMobile: true, label: "mobile" },
  ])("renders both workspace and browser headers on $label", ({ isMobile }) => {
    renderBrowserPane({ isMobile });

    const workspaceHeader = screen.getByRole("toolbar", {
      name: "Workspace",
    });
    expect(within(workspaceHeader).getByText("Project")).toBeTruthy();
    expect(within(workspaceHeader).getByText("main")).toBeTruthy();

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    expect(
      within(addressBar).getByRole("button", { name: "Close pane" }),
    ).toBeTruthy();
    const urlInput = within(addressBar).getByRole("textbox", {
      name: "URL",
    }) as HTMLInputElement;
    expect(urlInput.value).toBe("https://example.com");

    const iframe = screen.getByTitle("Browser") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("src")).toBe("https://example.com");
  });

  it("shows a blank address field for about:blank while preserving the iframe URL", () => {
    renderBrowserPane({ isMobile: false, url: "about:blank" });

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    const urlInput = within(addressBar).getByRole("textbox", {
      name: "URL",
    }) as HTMLInputElement;
    expect(urlInput.value).toBe("");

    const iframe = screen.getByTitle("Browser") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe("about:blank");
  });

  it("does not navigate when the blank address field is submitted", () => {
    const onBrowserUrlChange = vi.fn();
    renderBrowserPane({
      isMobile: false,
      url: "about:blank",
      onBrowserUrlChange,
    });

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    const urlInput = within(addressBar).getByRole("textbox", {
      name: "URL",
    }) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "   " } });
    fireEvent.submit(addressBar);

    expect(urlInput.value).toBe("");
    expect(screen.getByTitle("Browser").getAttribute("src")).toBe(
      "about:blank",
    );
    expect(onBrowserUrlChange).not.toHaveBeenCalled();
  });

  it("restores the current URL when an empty address is submitted on a non-blank page", () => {
    const onBrowserUrlChange = vi.fn();
    renderBrowserPane({
      isMobile: false,
      url: "https://example.com",
      onBrowserUrlChange,
    });

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    const urlInput = within(addressBar).getByRole("textbox", {
      name: "URL",
    }) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "   " } });
    fireEvent.submit(addressBar);

    expect(urlInput.value).toBe("https://example.com");
    expect(screen.getByTitle("Browser").getAttribute("src")).toBe(
      "https://example.com",
    );
    expect(onBrowserUrlChange).not.toHaveBeenCalled();
  });

  it("keeps explicitly submitted about:blank as a blank visible address", () => {
    const onBrowserUrlChange = vi.fn();
    renderBrowserPane({
      isMobile: false,
      url: "https://example.com",
      onBrowserUrlChange,
    });

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    const urlInput = within(addressBar).getByRole("textbox", {
      name: "URL",
    }) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "about:blank" } });
    fireEvent.submit(addressBar);

    expect(urlInput.value).toBe("");
    expect(screen.getByTitle("Browser").getAttribute("src")).toBe(
      "about:blank",
    );
    expect(onBrowserUrlChange).toHaveBeenCalledWith(
      "browser:p1-main",
      "about:blank",
    );
  });

  it("normalizes typed URLs and shows the navigated URL", () => {
    const onBrowserUrlChange = vi.fn();
    renderBrowserPane({
      isMobile: false,
      url: "about:blank",
      onBrowserUrlChange,
    });

    const addressBar = screen.getByRole("form", {
      name: "Browser address bar",
    });
    const urlInput = within(addressBar).getByRole("textbox", {
      name: "URL",
    }) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "example.com" } });
    fireEvent.submit(addressBar);

    expect(urlInput.value).toBe("https://example.com");
    expect(screen.getByTitle("Browser").getAttribute("src")).toBe(
      "https://example.com",
    );
    expect(onBrowserUrlChange).toHaveBeenCalledWith(
      "browser:p1-main",
      "https://example.com",
    );
  });
});

describe("WorkspacePaneRouter open IDE menu", () => {
  it("enables IDE actions for local viewers and sends the selected editor", () => {
    const onOpenWorktreeInIde = vi.fn();
    renderBrowserPane({
      isMobile: false,
      onOpenWorktreeInIde,
      canOpenLocalIde: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Cursor" }));

    expect(onOpenWorktreeInIde).toHaveBeenCalledWith("p1", "/repo", "cursor");
  });

  it("keeps IDE actions visible but disabled for non-local viewers", () => {
    const onOpenWorktreeInIde = vi.fn();
    renderBrowserPane({
      isMobile: false,
      onOpenWorktreeInIde,
      canOpenLocalIde: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace menu" }));
    const cursor = screen.getByRole("menuitem", { name: "Open in Cursor" });
    const vscode = screen.getByRole("menuitem", { name: "Open in VS Code" });

    expect((cursor as HTMLButtonElement).disabled).toBe(true);
    expect((vscode as HTMLButtonElement).disabled).toBe(true);
    expect(cursor.getAttribute("title")).toBe(
      "Available when parasor is opened from localhost on the server machine",
    );
    fireEvent.click(cursor);
    expect(onOpenWorktreeInIde).not.toHaveBeenCalled();
  });

  it("shows custom IDE actions and sends the command id", () => {
    const onOpenWorktreeInIde = vi.fn();
    renderBrowserPane({
      isMobile: false,
      onOpenWorktreeInIde,
      canOpenLocalIde: true,
      ideCommands: [
        { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Zed" }));

    expect(onOpenWorktreeInIde).toHaveBeenCalledWith("p1", "/repo", "zed");
  });

  it("routes project close from the workspace menu", () => {
    const onDeleteProject = vi.fn();
    renderBrowserPane({
      isMobile: false,
      onDeleteProject,
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close project…" }));

    expect(onDeleteProject).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("menuitem", { name: "Delete project…" })).toBe(
      null,
    );
  });
});

describe("WorkspacePaneRouter terminal retention", () => {
  it("routes terminal file links to the worktree files pane", () => {
    const terminalPane = makeTerminalPane("terminal:s1", "/repo", "s1");
    const onSelectWorktreeTab = vi.fn();
    render(
      <WorkspacePaneRouter
        {...makeRouterProps({
          allPanes: [terminalPane],
          focusedPane: terminalPane,
          sessions: [makeSession({ id: "s1" })],
          onSelectWorktreeTab,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "open file" }));

    expect(onSelectWorktreeTab).toHaveBeenCalledWith("/repo", "files");
    expect(
      localStorage.getItem("parasor:files-pane-selection:files:/repo"),
    ).toBe("packages/web/src/App.tsx");
  });

  it("mounts a terminal pane only while it is focused", () => {
    const browserPane = makeBrowserPane(
      "browser:p1-main",
      "/repo",
      "https://example.com",
    );
    const terminalPane = makeTerminalPane("terminal:s1", "/repo", "s1");
    const allPanes = [terminalPane, browserPane];
    const session = makeSession({ id: "s1" });
    const props = makeRouterProps({
      allPanes,
      focusedPane: browserPane,
      sessions: [session],
    });

    const { rerender } = render(<WorkspacePaneRouter {...props} />);
    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(
      screen.getByRole("form", { name: "Browser address bar" }),
    ).toBeTruthy();

    rerender(
      <WorkspacePaneRouter
        {...props}
        focusedPane={terminalPane}
        focusedWorktreeDirName="main"
      />,
    );

    const visibleTerminal = screen.getByTestId("terminal-pane-s1");
    const terminalLayer = visibleTerminal.parentElement as HTMLElement;
    expect(terminalLayer.style.visibility).toBe("");
    expect(terminalLayer.getAttribute("aria-hidden")).toBeNull();
    expect(terminalLayer.getAttribute("inert")).toBeNull();

    const input = within(visibleTerminal).getByLabelText("terminal input s1");
    input.focus();
    expect(document.activeElement).toBe(input);

    rerender(<WorkspacePaneRouter {...props} />);

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });

  it("does not mount hidden terminal panes on mobile while another pane is focused", () => {
    const browserPane = makeBrowserPane(
      "browser:p1-main",
      "/repo",
      "https://example.com",
    );
    const terminalPane = makeTerminalPane("terminal:s1", "/repo", "s1");

    render(
      <WorkspacePaneRouter
        {...makeRouterProps({
          allPanes: [terminalPane, browserPane],
          focusedPane: browserPane,
          isMobile: true,
          sessions: [makeSession({ id: "s1" })],
        })}
      />,
    );

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(
      screen.getByRole("form", { name: "Browser address bar" }),
    ).toBeTruthy();
  });

  it("does not retain the last focused terminal pane on mobile while another pane is focused", () => {
    const browserPane = makeBrowserPane(
      "browser:p1-main",
      "/repo",
      "https://example.com",
    );
    const terminalPane = makeTerminalPane("terminal:s1", "/repo", "s1");
    const props = makeRouterProps({
      allPanes: [terminalPane, browserPane],
      focusedPane: terminalPane,
      isMobile: true,
      sessions: [makeSession({ id: "s1" })],
    });

    const { rerender } = render(<WorkspacePaneRouter {...props} />);
    expect(screen.getByTestId("terminal-pane-s1")).toBeTruthy();

    rerender(<WorkspacePaneRouter {...props} focusedPane={browserPane} />);

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(
      screen.getByRole("form", { name: "Browser address bar" }),
    ).toBeTruthy();
  });

  it("mounts only the focused terminal pane on mobile", () => {
    const terminalA = makeTerminalPane("terminal:s1", "/repo", "s1");
    const terminalB = makeTerminalPane("terminal:s2", "/repo", "s2");

    render(
      <WorkspacePaneRouter
        {...makeRouterProps({
          allPanes: [terminalA, terminalB],
          focusedPane: terminalB,
          isMobile: true,
          sessions: [makeSession({ id: "s1" }), makeSession({ id: "s2" })],
        })}
      />,
    );

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(screen.getByTestId("terminal-pane-s2")).toBeTruthy();
  });

  it("mounts only the focused terminal pane on coarse-pointer wide layouts", () => {
    vi.stubGlobal("matchMedia", makeMatchMedia(true));
    const terminalA = makeTerminalPane("terminal:s1", "/repo", "s1");
    const terminalB = makeTerminalPane("terminal:s2", "/repo", "s2");

    render(
      <WorkspacePaneRouter
        {...makeRouterProps({
          allPanes: [terminalA, terminalB],
          focusedPane: terminalB,
          isMobile: false,
          sessions: [makeSession({ id: "s1" }), makeSession({ id: "s2" })],
        })}
      />,
    );

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(screen.getByTestId("terminal-pane-s2")).toBeTruthy();
  });

  it("does not retain a hidden terminal on coarse-pointer wide layouts", () => {
    vi.stubGlobal("matchMedia", makeMatchMedia(true));
    const browserPane = makeBrowserPane(
      "browser:p1-main",
      "/repo",
      "https://example.com",
    );
    const terminalPane = makeTerminalPane("terminal:s1", "/repo", "s1");
    const props = makeRouterProps({
      allPanes: [terminalPane, browserPane],
      focusedPane: terminalPane,
      isMobile: false,
      sessions: [makeSession({ id: "s1" })],
    });

    const { rerender } = render(<WorkspacePaneRouter {...props} />);
    expect(screen.getByTestId("terminal-pane-s1")).toBeTruthy();

    rerender(<WorkspacePaneRouter {...props} focusedPane={browserPane} />);

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(
      screen.getByRole("form", { name: "Browser address bar" }),
    ).toBeTruthy();
  });

  it("mounts only the focused terminal pane on desktop fine-pointer layouts", () => {
    const terminalA = makeTerminalPane("terminal:s1", "/repo", "s1");
    const terminalB = makeTerminalPane("terminal:s2", "/repo", "s2");

    render(
      <WorkspacePaneRouter
        {...makeRouterProps({
          allPanes: [terminalA, terminalB],
          focusedPane: terminalB,
          isMobile: false,
          sessions: [makeSession({ id: "s1" }), makeSession({ id: "s2" })],
        })}
      />,
    );

    expect(screen.queryByTestId("terminal-pane-s1")).toBeNull();
    expect(screen.getByTestId("terminal-pane-s2")).toBeTruthy();
  });
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    projectId: "p1",
    pid: 1234,
    state: "running",
    generation: 0,
    title: "",
    command: { type: "shell" },
    cwd: "/repo",
    shell: "/bin/zsh",
    createdAt: 0,
    pinned: false,
    ...overrides,
  };
}

function makeRouterProps(
  overrides: Partial<Parameters<typeof WorkspacePaneRouter>[0]> = {},
): Parameters<typeof WorkspacePaneRouter>[0] {
  return {
    activeProjectId: "p1",
    activeProjectName: "Project",
    activeProjectPath: "/repo",
    activeProjectIsRepo: true,
    allPanes: [],
    focusedPane: null,
    focusedWorktreeDirName: "main",
    fileChangeSeq: 0,
    gitState: null,
    hydrated: true,
    isMobile: false,
    gitGraphSelection: null,
    onGitGraphSelectionChange: vi.fn(),
    gitBranchName: null,
    commitBusy: false,
    commitError: null,
    onClearCommitError: vi.fn(),
    onSubmitInlineCommit: vi.fn(),
    sessions: [],
    onToggleDrawer: vi.fn(),
    onClosePane: vi.fn(),
    onRequestClosePane: vi.fn(),
    onNewProject: vi.fn(),
    onOpenUrl: vi.fn(),
    onBrowserUrlChange: vi.fn(),
    onRestartSession: vi.fn(),
    onRenameSession: vi.fn(),
    onSelectWorktreeTab: vi.fn(),
    onToggleSessionPin: vi.fn(),
    ...overrides,
  };
}

function renderBrowserPane({
  isMobile,
  ideCommands,
  url = "https://example.com",
  onRequestClosePane = vi.fn(),
  onBrowserUrlChange = vi.fn(),
  onOpenWorktreeInIde,
  canOpenLocalIde,
  onDeleteProject,
}: {
  isMobile: boolean;
  ideCommands?: Array<{
    id: string;
    label: string;
    command: string;
    args: string[];
  }>;
  url?: string;
  onRequestClosePane?: (
    paneId: string,
    paneKind: "terminal" | "browser",
    title: string,
  ) => void;
  onBrowserUrlChange?: (paneId: string, url: string) => void;
  onOpenWorktreeInIde?: (
    projectId: string,
    worktreePath: string,
    editor: IdeEditor,
  ) => void;
  canOpenLocalIde?: boolean;
  onDeleteProject?: (projectId: string) => void;
}) {
  const focusedPane = makeBrowserPane("browser:p1-main", "/repo", url);

  return render(
    <WorkspacePaneRouter
      {...makeRouterProps({
        focusedPane,
        isMobile,
        onRequestClosePane,
        onBrowserUrlChange,
        onOpenWorktreeInIde,
        ideCommands,
        canOpenLocalIde,
        onDeleteProject,
      })}
    />,
  );
}
