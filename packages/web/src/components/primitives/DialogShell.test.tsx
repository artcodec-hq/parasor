import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DialogFooter, DialogRoot } from "./DialogShell.js";

afterEach(() => cleanup());

describe("DialogRoot", () => {
  it("animates modal dialogs into the entered state", async () => {
    render(
      <DialogRoot open ariaLabel="Test dialog" onClose={vi.fn()}>
        <button type="button">Action</button>
      </DialogRoot>,
    );

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    expect(dialog.className).toContain("opacity-0");

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(dialog.className).toContain("opacity-100");
    expect(dialog.className).toContain("scale-100");
  });

  it("passes dialog role and labelling through sheet presentation", () => {
    render(
      <DialogRoot
        open
        presentation="sheet"
        dialogRole="alertdialog"
        ariaLabelledBy="sheet-title"
        onClose={vi.fn()}
      >
        <h2 id="sheet-title">Connection lost</h2>
        <button type="button">Retry</button>
      </DialogRoot>,
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Connection lost",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("sheet-title");
  });
});

describe("DialogFooter", () => {
  it("stacks actions without reversing DOM focus order", () => {
    const { container } = render(
      <DialogFooter layout="stack">
        <button type="button">Primary</button>
        <button type="button">Cancel</button>
      </DialogFooter>,
    );

    const footer = container.firstElementChild as HTMLElement;
    expect(footer.className).toContain("flex-col");
    expect(footer.className).not.toContain("flex-col-reverse");
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Primary", "Cancel"]);
  });
});
