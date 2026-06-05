import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomSheet } from "./BottomSheet.js";

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test element");
  return value;
}

describe("BottomSheet", () => {
  afterEach(() => cleanup());

  it("renders a portal under document.body when open", () => {
    render(
      <BottomSheet open onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const dialog = document.querySelector(
      '[role="dialog"][aria-label="Test sheet"]',
    );
    expect(dialog).not.toBeNull();
  });

  it("supports labelled-by and alertdialog semantics", () => {
    render(
      <BottomSheet
        open
        dialogRole="alertdialog"
        ariaLabelledBy="sheet-title"
        onDismiss={() => {}}
      >
        <h2 id="sheet-title">Critical sheet</h2>
        <button type="button">Action</button>
      </BottomSheet>,
    );

    const dialog = document.querySelector(
      '[role="alertdialog"][aria-labelledby="sheet-title"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("focuses the first focusable element when focus management is enabled", async () => {
    render(
      <BottomSheet open onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(document.activeElement?.textContent).toBe("Action");
  });

  it("leaves existing focus alone when focus management is disabled", async () => {
    const anchor = document.createElement("button");
    anchor.type = "button";
    anchor.textContent = "Terminal focus sentinel";
    document.body.appendChild(anchor);
    anchor.focus();

    render(
      <BottomSheet
        open
        manageFocus={false}
        onDismiss={() => {}}
        ariaLabel="Test sheet"
      >
        <button type="button">Action</button>
      </BottomSheet>,
    );
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it("hides the panel via translateY(100%) when closed", () => {
    render(
      <BottomSheet open={false} onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const dialog = document.querySelector<HTMLDivElement>(
      '[role="dialog"][aria-label="Test sheet"]',
    );
    expect(must(dialog).style.transform).toBe("translateY(100%)");
  });

  it("slides in after the first open animation frame", async () => {
    render(
      <BottomSheet open onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const dialog = document.querySelector<HTMLDivElement>(
      '[role="dialog"][aria-label="Test sheet"]',
    );
    expect(must(dialog).style.transform).toBe("translateY(100%)");

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(must(dialog).style.transform).toBe("translateY(0px)");
  });

  it("removes panel shadow while closed so offscreen blur cannot leak", () => {
    const { rerender } = render(
      <BottomSheet open={false} onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const dialog = document.querySelector<HTMLDivElement>(
      '[role="dialog"][aria-label="Test sheet"]',
    );
    expect(must(dialog).className).toContain("shadow-none");
    expect(must(dialog).className).not.toContain("shadow-[0_-8px_24px");

    rerender(
      <BottomSheet open onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    expect(must(dialog).className).toContain("shadow-[0_-8px_24px");
    expect(must(dialog).className).not.toContain("shadow-none");
  });

  it("invokes onDismiss when the scrim is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet open onDismiss={onDismiss} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const scrim = document.querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    expect(scrim).not.toBeNull();
    act(() => {
      scrim.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onDismiss from the scrim when closeOnScrim=false", () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet
        open
        closeOnScrim={false}
        onDismiss={onDismiss}
        ariaLabel="Test sheet"
      >
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const scrim = document.querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    act(() => {
      scrim.click();
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("invokes onDismiss when ESC is pressed", () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet open onDismiss={onDismiss} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onDismiss from ESC when closeOnEscape=false", () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet
        open
        closeOnEscape={false}
        onDismiss={onDismiss}
        ariaLabel="Test sheet"
      >
        <button type="button">Action</button>
      </BottomSheet>,
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("renders a drag handle when dragHandle is unset", () => {
    render(
      <BottomSheet open onDismiss={() => {}} ariaLabel="Test sheet">
        <button type="button">Action</button>
      </BottomSheet>,
    );
    // First child of the dialog panel is the drag handle area.
    const panel = document.querySelector<HTMLDivElement>(
      '[role="dialog"][aria-label="Test sheet"]',
    );
    const handleArea = panel?.firstElementChild as HTMLElement | null;
    // Inside the handle area is the visual grab pill.
    const pill = must(handleArea).querySelector("div");
    expect(pill).not.toBeNull();
  });

  it("hides the drag handle when dragHandle=false", () => {
    render(
      <BottomSheet
        open
        dragHandle={false}
        onDismiss={() => {}}
        ariaLabel="Test sheet"
      >
        <button type="button">Action</button>
      </BottomSheet>,
    );
    const panel = document.querySelector<HTMLDivElement>(
      '[role="dialog"][aria-label="Test sheet"]',
    );
    // With dragHandle=false the first child is the scroll wrapper, not a
    // touch-bearing handle.
    const firstChild = panel?.firstElementChild as HTMLElement | null;
    expect(firstChild?.className.includes("cursor-grab")).toBe(false);
  });
});
