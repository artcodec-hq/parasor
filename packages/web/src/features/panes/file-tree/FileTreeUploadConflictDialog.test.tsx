import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTreeUploadConflictDialog } from "./FileTreeUploadConflictDialog.js";

const defaults = {
  open: true,
  conflicts: ["README.md", "src/App.tsx"],
  totalCount: 4,
  targetLabel: "src",
  onResolve: vi.fn(),
  onCancel: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("FileTreeUploadConflictDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <FileTreeUploadConflictDialog {...defaults} open={false} />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders as an accessible modal dialog with conflict context", () => {
    render(<FileTreeUploadConflictDialog {...defaults} />);

    const dialog = screen.getByRole("dialog", {
      name: "Resolve upload conflict",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Files already exist")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByText("src/App.tsx")).toBeTruthy();
    expect(screen.getByText(/2 other files will follow/)).toBeTruthy();
  });

  it("focuses Keep both as the safe default action", async () => {
    render(<FileTreeUploadConflictDialog {...defaults} />);

    const keepBoth = screen.getByRole("button", { name: "Keep both" });
    await waitFor(() => expect(document.activeElement).toBe(keepBoth));
  });

  it("resolves each action with the apply-to-all state", () => {
    const onResolve = vi.fn();
    render(
      <FileTreeUploadConflictDialog {...defaults} onResolve={onResolve} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(onResolve).toHaveBeenNthCalledWith(1, "skip", true);
    expect(onResolve).toHaveBeenNthCalledWith(2, "keep-both", true);
    expect(onResolve).toHaveBeenNthCalledWith(3, "replace", true);
  });

  it("uses the unchecked apply-to-all state", () => {
    const onResolve = vi.fn();
    render(
      <FileTreeUploadConflictDialog {...defaults} onResolve={onResolve} />,
    );

    fireEvent.click(screen.getByLabelText("Apply to all files in this drop"));
    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));

    expect(onResolve).toHaveBeenCalledWith("keep-both", false);
  });

  it("resets apply-to-all when reopened", () => {
    const onResolve = vi.fn();
    const { rerender } = render(
      <FileTreeUploadConflictDialog {...defaults} onResolve={onResolve} />,
    );

    fireEvent.click(screen.getByLabelText("Apply to all files in this drop"));
    rerender(
      <FileTreeUploadConflictDialog
        {...defaults}
        open={false}
        onResolve={onResolve}
      />,
    );
    rerender(
      <FileTreeUploadConflictDialog {...defaults} onResolve={onResolve} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));

    expect(onResolve).toHaveBeenCalledWith("keep-both", true);
  });

  it("calls onCancel from Escape, Cancel, and backdrop", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <FileTreeUploadConflictDialog {...defaults} onCancel={onCancel} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(container.firstElementChild as HTMLElement);

    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it("handles the single-file copy", () => {
    render(
      <FileTreeUploadConflictDialog
        {...defaults}
        conflicts={["README.md"]}
        totalCount={1}
        targetLabel=""
      />,
    );

    expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
      "1 of 1 file already exists in .",
    );
    expect(screen.queryByText(/other file/)).toBeNull();
    expect(screen.getByText(".")).toBeTruthy();
  });
});
