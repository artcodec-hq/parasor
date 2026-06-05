import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ActionItem, FloatingActionMenu } from "./ActionMenu.js";

function items(onSelect = vi.fn()): ActionItem[] {
  return [
    { id: "rename", label: "Rename", onSelect },
    { id: "duplicate", label: "Duplicate", onSelect: vi.fn() },
  ];
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FloatingActionMenu", () => {
  it("opens from a trigger and runs the selected action", async () => {
    const onSelect = vi.fn();
    render(
      <FloatingActionMenu
        items={items(onSelect)}
        renderTrigger={({ open, toggle, triggerRef, menuId }) => (
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={toggle}
          >
            Open menu
          </button>
        )}
      />,
    );

    fireEvent.click(document.querySelector("button") as HTMLButtonElement);
    fireEvent.click(
      document.querySelector('[role="menuitem"]') as HTMLButtonElement,
    );

    expect(onSelect).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
  });

  it("portals fixed menus outside overflow-clipped hosts", async () => {
    const { container } = render(
      <div data-testid="clipped-host" style={{ overflow: "hidden" }}>
        <FloatingActionMenu
          portal={true}
          items={items()}
          renderTrigger={({ open, toggle, triggerRef, menuId }) => (
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={toggle}
            >
              Branch
            </button>
          )}
        />
      </div>,
    );

    fireEvent.click(container.querySelector("button") as HTMLButtonElement);
    const menu = await waitFor(() => document.querySelector('[role="menu"]'));

    expect(menu).toBeTruthy();
    expect(container.contains(menu)).toBe(false);
    expect((menu as HTMLElement).style.position).toBe("fixed");
  });
});
