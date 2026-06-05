import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteProjectDialog } from "./DeleteProjectDialog.js";

afterEach(() => {
  cleanup();
});

describe("DeleteProjectDialog", () => {
  it("uses Close wording for the workspace project removal confirmation", () => {
    render(
      <DeleteProjectDialog
        projectName="parasor"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Close project parasor" }),
    ).toBeTruthy();
    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton).toBeTruthy();
    expect(closeButton.className).toContain("bg-accent");
    expect(closeButton.className).not.toContain("bg-danger");
    expect(
      screen.getByText(/directory itself will not be deleted/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("keeps the existing confirm behavior", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteProjectDialog
        projectName="parasor"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel from Escape, Cancel, and backdrop", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DeleteProjectDialog
        projectName="parasor"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(container.firstElementChild as HTMLElement);

    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});
