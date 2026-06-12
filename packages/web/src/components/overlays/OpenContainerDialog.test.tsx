import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CustomPaneCommand,
  paneCommandsWithBuiltins,
} from "../../lib/pane-command-store.js";
import { OpenContainerDialog } from "./OpenContainerDialog.js";

const project = { id: "p1", name: "project", path: "/repo/project" };
const worktree = { id: "wt1", name: "main", path: "/repo" };

function renderDialog(
  overrides: Partial<Parameters<typeof OpenContainerDialog>[0]> = {},
) {
  const customCommands: CustomPaneCommand[] = [
    { id: "cmd:1", label: "Dev server", initialInput: "pnpm dev" },
  ];
  const props = {
    open: true,
    project,
    worktree,
    commands: paneCommandsWithBuiltins(customCommands),
    onClose: vi.fn(),
    onCommandsChange: vi.fn(),
    onRunCommand: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<OpenContainerDialog {...props} />) };
}

afterEach(() => {
  cleanup();
});

describe("OpenContainerDialog command launcher", () => {
  it("renders as an accessible desktop modal dialog", () => {
    renderDialog();
    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="New session in main"]',
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.className).toContain("rounded-window");
  });

  it("renders the mobile path as a bottom sheet", () => {
    renderDialog({ isMobile: true });
    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="New session in main"]',
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain("rounded-t-xl");
  });

  it("renders command rows without an Open button", () => {
    const { queryByText, getByText } = renderDialog();
    expect(getByText("Terminal")).toBeTruthy();
    expect(getByText("Dev server")).toBeTruthy();
    expect(queryByText("Open")).toBeNull();
  });

  it("closes the launcher on Escape", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("runs the built-in Terminal command on click", () => {
    const onRunCommand = vi.fn();
    const onClose = vi.fn();
    const { getByText, props } = renderDialog({ onRunCommand, onClose });
    fireEvent.click(getByText("Terminal"));
    expect(onRunCommand).toHaveBeenCalledWith("/repo", props.commands[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("runs the selected custom command on Enter", () => {
    const onRunCommand = vi.fn();
    const { getByText, props } = renderDialog({ onRunCommand });
    fireEvent.focus(getByText("Dev server"));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRunCommand).toHaveBeenCalledWith(
      "/repo",
      props.commands.find((command) => command.id === "cmd:1"),
    );
  });

  it("creates a custom command from the editor", () => {
    const onCommandsChange = vi.fn();
    const { getByText, container } = renderDialog({
      commands: paneCommandsWithBuiltins([]),
      onCommandsChange,
    });
    fireEvent.click(getByText("Edit commands"));
    fireEvent.click(getByText("Add"));
    const inputs = Array.from(container.querySelectorAll("input"));
    fireEvent.change(inputs[0], { target: { value: "Test" } });
    fireEvent.change(inputs[1], { target: { value: "echo test" } });
    fireEvent.click(getByText("Save"));
    expect(onCommandsChange).toHaveBeenCalledWith([
      expect.objectContaining({ label: "Test", initialInput: "echo test" }),
    ]);
  });

  it("creates a new worktree session from the launcher", async () => {
    const onCreateWorktreeSession = vi.fn();
    const loadLocalFiles = vi.fn(async () => ({
      candidates: [{ path: ".env", size: 9 }],
      rememberedPaths: [".env"],
    }));
    const { getByText, getByPlaceholderText, getByLabelText, props } =
      renderDialog({
        loadLocalFiles,
        onCreateWorktreeSession,
      });

    fireEvent.click(getByText("New worktree session"));

    await waitFor(() => expect(getByText(".env")).toBeTruthy());
    fireEvent.change(getByPlaceholderText("feature/foo"), {
      target: { value: "feature/menu" },
    });
    fireEvent.click(getByText("Create session"));

    expect(loadLocalFiles).toHaveBeenCalledWith("p1");
    expect(getByLabelText(/\.env/) as HTMLInputElement).toBeTruthy();
    expect(onCreateWorktreeSession).toHaveBeenCalledWith({
      branch: "feature/menu",
      base: "",
      copyLocalFiles: [".env"],
      rememberLocalFiles: true,
      parentWorktreePath: "/repo",
      command: props.commands[0],
    });
  });
});
