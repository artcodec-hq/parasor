import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommitBody,
  CommitDialog,
  type CommitFileEntry,
} from "./CommitDialog.js";

const files: CommitFileEntry[] = [
  { path: "src/App.tsx", status: "M" },
  { path: "README.md", status: "A" },
];

function renderDialog(
  overrides: Partial<Parameters<typeof CommitDialog>[0]> = {},
) {
  const props = {
    open: true,
    busy: false,
    error: null,
    branchName: "main",
    files,
    isMobile: false,
    onClose: vi.fn(),
    onCommit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CommitDialog {...props} />) };
}

afterEach(() => {
  cleanup();
});

describe("CommitDialog", () => {
  it("renders the desktop dialog as an accessible dialog", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Commit · main" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("closes the desktop dialog from Escape, backdrop, and Cancel", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.firstElementChild as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("does not close the desktop dialog from Escape, backdrop, or Cancel while busy", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ busy: true, onClose });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.firstElementChild as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders desktop errors as an inline alert", () => {
    renderDialog({ error: "Commit failed: please resolve hooks." });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Commit failed: please resolve hooks.");
    expect(alert.className).toContain("rounded-control");
  });

  it("submits selected files with Ctrl+Enter", async () => {
    const onCommit = vi.fn();
    renderDialog({ onCommit });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Update dialogs\n\nUse shared shell" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Commit 2" })).toBeTruthy(),
    );
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    expect(onCommit).toHaveBeenCalledWith({
      message: "Update dialogs\n\nUse shared shell",
      paths: ["src/App.tsx", "README.md"],
    });
  });

  it("renders the mobile path as a fullscreen dialog", () => {
    renderDialog({ isMobile: true });

    const dialog = screen.getByRole("dialog", { name: "Commit · main" });
    expect(dialog.className).toContain("h-full");
    expect(document.body.querySelector(".rounded-t-xl")).toBeNull();
  });
});

describe("CommitBody", () => {
  it("invokes the file-open action from a changed file row", () => {
    const onOpenFilePath = vi.fn();
    render(
      <CommitBody
        files={files}
        selected={new Set(files.map((file) => file.path))}
        toggle={vi.fn()}
        toggleAll={vi.fn()}
        message=""
        setMessage={vi.fn()}
        layout="inline"
        onOpenFilePath={onOpenFilePath}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open src/App.tsx" }));

    expect(onOpenFilePath).toHaveBeenCalledWith("src/App.tsx");
  });
});
