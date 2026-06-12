import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileKeyBar } from "./MobileKeyBar.js";

interface BarProps extends Partial<Parameters<typeof MobileKeyBar>[0]> {}

function defaults(): Parameters<typeof MobileKeyBar>[0] {
  return {
    onSend: vi.fn(),
    ctrlActive: false,
    onCtrlToggle: vi.fn(),
    onAfterSend: vi.fn(),
    keyboardOpen: false,
    onKeyboardToggle: vi.fn(),
  };
}

function renderBar(overrides: BarProps = {}) {
  const props = { ...defaults(), ...overrides };
  const result = render(<MobileKeyBar {...props} />);
  return { ...result, props };
}

function buttonByLabel(
  container: HTMLElement,
  label: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

function sheetButton(label: string): HTMLButtonElement {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`missing sheet button: ${label}`);
  return button;
}

describe("MobileKeyBar", () => {
  afterEach(() => cleanup());

  it("renders the requested core order: Esc/Tab/Ctrl/Return/Up/Down/Left/Right/+ trigger/keyboard", () => {
    const { container } = renderBar();
    const buttons = container.querySelectorAll("button");
    // 10 inline buttons (no sheet open).
    expect(buttons.length).toBe(10);
    const labels = Array.from(buttons).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
    );
    expect(labels).toEqual([
      "Escape",
      "Tab",
      "Ctrl",
      "Return",
      "Up",
      "Down",
      "Left",
      "Right",
      "More actions",
      "Show keyboard",
    ]);
  });

  it("uses shared 16px / 1px SVG icons for controls", () => {
    const { container } = renderBar();
    const labels = [
      "Return",
      "Left",
      "Up",
      "Down",
      "Right",
      "More actions",
      "Show keyboard",
    ];
    for (const label of labels) {
      const svg = buttonByLabel(container, label).querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("16");
      expect(svg?.getAttribute("height")).toBe("16");
      expect(svg?.getAttribute("stroke-width")).toBe("1");
    }
  });

  it("renders text keys as supplied SVG glyphs", () => {
    const { container } = renderBar();
    const escapeKey = buttonByLabel(container, "Escape");
    const tab = buttonByLabel(container, "Tab");
    const ctrl = buttonByLabel(container, "Ctrl");
    expect(escapeKey.textContent).toBe("");
    expect(tab.textContent).toBe("");
    expect(ctrl.textContent).toBe("");
    for (const button of [escapeKey, tab, ctrl]) {
      const svg = button.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("16");
      expect(svg?.getAttribute("height")).toBe("16");
    }
  });

  it("keeps safe-area padding outside the fixed-height key row", () => {
    const { container } = renderBar();
    const chrome = container.firstElementChild as HTMLElement | null;
    expect(chrome?.className).toContain("cm-safe-area-bottom-standalone");
    expect(chrome?.className).toContain("shrink-0");
    expect(chrome?.firstElementChild?.className).toContain("h-bar");
  });

  it("does not add bottom safe-area padding while the keyboard is open", () => {
    const { container } = renderBar({ keyboardOpen: true });
    const chrome = container.firstElementChild as HTMLElement | null;
    expect(chrome?.className).not.toContain("cm-safe-area-bottom-standalone");
    expect(chrome?.firstElementChild?.className).toContain("h-bar");
  });

  it("toggles aria-pressed and label on keyboard button per keyboardOpen", () => {
    const { container, rerender } = renderBar({ keyboardOpen: false });
    const showKb = buttonByLabel(container, "Show keyboard");
    expect(showKb.getAttribute("aria-pressed")).toBe("false");
    rerender(<MobileKeyBar {...defaults()} keyboardOpen={true} />);
    const hideKb = buttonByLabel(container, "Hide keyboard");
    expect(hideKb.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onKeyboardToggle when the keyboard bar button is tapped", () => {
    const onKeyboardToggle = vi.fn();
    const { container } = renderBar({ onKeyboardToggle });
    const kb = buttonByLabel(container, "Show keyboard");
    act(() => {
      kb.click();
    });
    expect(onKeyboardToggle).toHaveBeenCalledTimes(1);
  });

  it("opens the bottom sheet when + is tapped", () => {
    const { container } = renderBar();
    const more = buttonByLabel(container, "More actions");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      fireEvent.pointerDown(more);
      more.click();
    });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const sheet = document.querySelector(
      '[role="dialog"][aria-label="Mobile actions"]',
    );
    expect(sheet).not.toBeNull();
  });

  it("keeps focus outside the More sheet so terminal selection is preserved", async () => {
    const anchor = document.createElement("button");
    anchor.type = "button";
    anchor.textContent = "Terminal focus sentinel";
    document.body.appendChild(anchor);
    anchor.focus();
    const { container } = renderBar();
    const more = buttonByLabel(container, "More actions");

    act(() => {
      expect(fireEvent.pointerDown(more)).toBe(false);
      more.click();
    });
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(anchor);
    const camera = sheetButton("Take Photo");
    expect(fireEvent.pointerDown(camera)).toBe(false);
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it("sends LF when Return is tapped", () => {
    const onSend = vi.fn();
    const { container } = renderBar({ onSend });
    act(() => {
      buttonByLabel(container, "Return").click();
    });
    expect(onSend).toHaveBeenCalledWith("\n");
  });

  it("limits the More sheet to attachment actions", () => {
    const { container } = renderBar();
    act(() => {
      buttonByLabel(container, "More actions").click();
    });
    const sheetButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"][aria-label="Mobile actions"] button',
      ),
    ).map((button) => button.textContent?.trim() ?? "");
    expect(sheetButtons).toEqual(["Take Photo", "Photo Library", "Close"]);
  });

  it("disables attach rows when onAttachFiles is undefined", () => {
    const { container } = renderBar({ onAttachFiles: undefined });
    act(() => {
      buttonByLabel(container, "More actions").click();
    });
    const labels = ["Take Photo", "Photo Library"];
    for (const label of labels) {
      const btn = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((b) => b.textContent?.trim() === label);
      expect(btn?.disabled).toBe(true);
    }
  });

  it("forwards picked images to onAttachFiles when the photo library row is used", () => {
    const onAttachFiles = vi.fn();
    const { container } = renderBar({ onAttachFiles });
    act(() => {
      buttonByLabel(container, "More actions").click();
    });
    const libraryInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept="image/*"]:not([capture])',
    );
    if (!libraryInput) throw new Error("missing library input");
    const file = new File(["x"], "x.png", { type: "image/png" });
    Object.defineProperty(libraryInput, "files", {
      configurable: true,
      value: [file],
    });
    act(() => {
      libraryInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAttachFiles).toHaveBeenCalledWith([file]);
  });

  it("calls onCtrlToggle when Ctrl tapped, and emits Ctrl-arrow combo on next arrow", () => {
    const onSend = vi.fn();
    const onCtrlToggle = vi.fn();
    const { container, rerender } = renderBar({
      ctrlActive: false,
      onSend,
      onCtrlToggle,
    });
    act(() => {
      buttonByLabel(container, "Ctrl").click();
    });
    expect(onCtrlToggle).toHaveBeenCalledTimes(1);

    // Simulate parent toggling ctrlActive=true; arrow should now send Ctrl seq.
    rerender(
      <MobileKeyBar
        {...defaults()}
        ctrlActive
        onSend={onSend}
        onCtrlToggle={onCtrlToggle}
      />,
    );
    act(() => {
      buttonByLabel(container, "Up").click();
    });
    expect(onSend).toHaveBeenCalledWith("\x1b[1;5A");
  });
});
