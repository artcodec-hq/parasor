import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClosePaneDialog } from "./ClosePaneDialog.js";

afterEach(() => {
  cleanup();
});

describe("ClosePaneDialog", () => {
  it("renders the terminal close confirmation as an accessible dialog", () => {
    render(
      <ClosePaneDialog
        paneTitle="Terminal"
        paneKind="terminal"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Close Terminal" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText(/shell session will terminate/)).toBeTruthy();
  });

  it("renders the browser close detail", () => {
    render(
      <ClosePaneDialog
        paneTitle="Preview"
        paneKind="browser"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/browser tab state will be lost/)).toBeTruthy();
  });

  it("keeps the destructive confirm behavior", () => {
    const onConfirm = vi.fn();
    render(
      <ClosePaneDialog
        paneTitle="Terminal"
        paneKind="terminal"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton.className).toContain("bg-danger");
    fireEvent.click(closeButton);

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel from Escape, Cancel, and backdrop", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ClosePaneDialog
        paneTitle="Terminal"
        paneKind="terminal"
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
