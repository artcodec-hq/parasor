import type { Session, TerminalPaneState } from "@parasor/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPaneView } from "./TerminalPaneView.js";

vi.mock("../../panes/terminal/TerminalPane.js", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-body">{sessionId}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.parasorTerminalTrace = undefined;
});

describe("TerminalPaneView", () => {
  it("captures terminal diagnostics from the terminal pane header", async () => {
    const captureTerminalInput = vi.fn().mockResolvedValue({ ok: true });
    window.parasorTerminalTrace = {
      captureTerminalInput,
    } as unknown as Window["parasorTerminalTrace"];

    render(<TerminalPaneView {...makeProps()} />);

    screen.getByLabelText("Capture terminal diagnostics").click();

    expect(captureTerminalInput).toHaveBeenCalledWith(
      "manual-terminal-button",
      {
        sessionId: "s1",
        paneId: "terminal:s1",
      },
    );
    await waitFor(() => {
      expect(
        screen.getByLabelText("Captured terminal diagnostics"),
      ).toBeTruthy();
    });
  });

  it("does not show the diagnostic capture button for ended terminal sessions", () => {
    render(
      <TerminalPaneView
        {...makeProps({ session: makeSession({ state: "ended" }) })}
      />,
    );

    expect(screen.queryByLabelText("Capture terminal diagnostics")).toBeNull();
  });
});

function makeProps(
  overrides: Partial<Parameters<typeof TerminalPaneView>[0]> = {},
): Parameters<typeof TerminalPaneView>[0] {
  return {
    paneId: "terminal:s1",
    state: { kind: "terminal", sessionId: "s1" } satisfies TerminalPaneState,
    worktreePath: "/repo",
    session: makeSession(),
    onRestartSession: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenUrl: vi.fn(),
    onClosePane: vi.fn(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    projectId: "p1",
    pid: 1234,
    state: "running",
    generation: 0,
    title: "codex",
    command: { type: "shell" },
    cwd: "/repo",
    shell: "/bin/zsh",
    createdAt: 0,
    ...overrides,
  };
}
