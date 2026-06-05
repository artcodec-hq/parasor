import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog.js";

afterEach(() => {
  cleanup();
});

describe("RemoveWorktreeDialog", () => {
  const defaults = {
    open: true,
    branch: "feat/a",
    worktreePath: "/tmp/wt-a",
    dirtyCount: 0,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  it("renders nothing when closed", () => {
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} open={false} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders the branch and worktree path", () => {
    const { container } = render(<RemoveWorktreeDialog {...defaults} />);
    expect(container.textContent).toContain("feat/a");
    expect(container.textContent).toContain("/tmp/wt-a");
  });

  it("renders as an accessible modal dialog", () => {
    render(<RemoveWorktreeDialog {...defaults} />);
    const dialog = screen.getByRole("dialog", {
      name: "Remove worktree feat/a",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("submit is enabled and labeled 'Remove' when not dirty", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} onSubmit={onSubmit} />,
    );
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Remove");
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ force: false });
  });

  it("blocks submit until force checkbox is confirmed when dirty", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} dirtyCount={3} onSubmit={onSubmit} />,
    );
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Force remove");
    expect(container.textContent).toContain("3 uncommitted files");

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ force: true });
  });

  it("renders 'file' singular when dirtyCount is 1", () => {
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} dirtyCount={1} />,
    );
    expect(container.textContent).toContain("1 uncommitted file ");
    expect(container.textContent).not.toContain("1 uncommitted files");
  });

  it("disables submit while busy even when not dirty", () => {
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} busy={true} />,
    );
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Removing…");
  });

  it("renders error banner when error is set", () => {
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} error="worktree is locked" />,
    );
    expect(container.textContent).toContain("worktree is locked");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<RemoveWorktreeDialog {...defaults} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <RemoveWorktreeDialog {...defaults} onClose={onClose} />,
    );
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("relabels submit as 'Prune' and skips force gate when orphan", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <RemoveWorktreeDialog
        {...defaults}
        orphan
        dirtyCount={5}
        onSubmit={onSubmit}
      />,
    );
    const submit = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Prune");
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(container.textContent).toContain("on-disk directory is gone");
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ force: true });
  });

  it("resets force checkbox between opens", () => {
    const { container, rerender } = render(
      <RemoveWorktreeDialog {...defaults} dirtyCount={2} />,
    );
    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    rerender(
      <RemoveWorktreeDialog {...defaults} dirtyCount={2} open={false} />,
    );
    rerender(<RemoveWorktreeDialog {...defaults} dirtyCount={2} open={true} />);

    const fresh = document.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    expect(fresh.checked).toBe(false);
  });
});
