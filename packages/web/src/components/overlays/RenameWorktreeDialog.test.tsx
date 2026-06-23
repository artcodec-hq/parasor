import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameWorktreeDialog } from "./RenameWorktreeDialog.js";

afterEach(() => {
  cleanup();
});

describe("RenameWorktreeDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <RenameWorktreeDialog
        open={false}
        currentBranch="feat/a"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("pre-fills the input with currentBranch on open", () => {
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const input = container.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    expect(input.value).toBe("feat/a");
  });

  it("renders as an accessible dialog", () => {
    render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Rename branch feat/a",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("disables submit while value equals currentBranch", () => {
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables submit and calls onSubmit with trimmed value", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const input = container.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  feat/b  " } });
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("feat/b");
  });

  it("disables submit while busy", () => {
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        busy={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const input = container.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "feat/b" } });
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Renaming…");
  });

  it("renders error banner when error is set", () => {
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        error="branch already exists"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("branch already exists");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(getByText("Cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores focus to the opener after closing", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open rename
          </button>
          <RenameWorktreeDialog
            open={open}
            currentBranch="feat/a"
            onClose={() => setOpen(false)}
            onSubmit={vi.fn()}
          />
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByText("Open rename");
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.activeElement).toBe(opener);
  });

  it("disables submit when value is whitespace-only", () => {
    const { container } = render(
      <RenameWorktreeDialog
        open={true}
        currentBranch="feat/a"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const input = container.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
