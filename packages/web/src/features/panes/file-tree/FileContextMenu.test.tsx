import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileContextMenu } from "./FileContextMenu.js";

const entry = {
  name: "README.md",
  path: "docs/README.md",
  type: "file" as const,
};

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function setMobile(mobile: boolean) {
  if (mobile) {
    Object.defineProperty(window, "ontouchstart", {
      configurable: true,
      value: null,
    });
    return;
  }
  delete (window as { ontouchstart?: unknown }).ontouchstart;
}

afterEach(() => {
  cleanup();
  delete (window as { ontouchstart?: unknown }).ontouchstart;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("FileContextMenu", () => {
  it("renders the desktop menu at the requested coordinates", () => {
    setMobile(false);
    const { container } = render(
      <FileContextMenu entry={entry} x={24} y={48} onClose={vi.fn()} />,
    );

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu?.style.position).toBe("fixed");
    expect(menu?.style.left).toBe("24px");
    expect(menu?.style.top).toBe("48px");
    expect(container.firstElementChild).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders the mobile menu as a bottom sheet", () => {
    setMobile(true);
    render(<FileContextMenu entry={entry} x={0} y={0} onClose={vi.fn()} />);

    const sheet = document.body.querySelector(
      '[role="dialog"][aria-label="Actions for README.md"]',
    );
    expect(sheet).toBeTruthy();
    expect(sheet?.className).toContain("rounded-t-xl");
    expect(document.body.textContent).toContain("docs/README.md");
  });

  it("runs mobile actions and closes the sheet", async () => {
    setMobile(true);
    const writeText = mockClipboard();
    const onClose = vi.fn();
    render(<FileContextMenu entry={entry} x={0} y={0} onClose={onClose} />);

    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Copy as @path"),
      ) as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("@docs/README.md"),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes the mobile sheet from Cancel", () => {
    setMobile(true);
    const onClose = vi.fn();
    render(<FileContextMenu entry={entry} x={0} y={0} onClose={onClose} />);

    fireEvent.click(
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Cancel",
      ) as HTMLButtonElement,
    );

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("delegates mobile Escape dismissal to the bottom sheet", () => {
    setMobile(true);
    const onClose = vi.fn();
    render(<FileContextMenu entry={entry} x={0} y={0} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
