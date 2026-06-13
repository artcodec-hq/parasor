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
      "Attach files",
      "Show keyboard",
    ]);
  });

  it("uses shared SVG icons at the keybar's original 20px size", () => {
    const { container } = renderBar();
    const labels = [
      "Return",
      "Left",
      "Up",
      "Down",
      "Right",
      "Attach files",
      "Show keyboard",
    ];
    for (const label of labels) {
      const svg = buttonByLabel(container, label).querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("20");
      expect(svg?.getAttribute("height")).toBe("20");
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
      expect(svg?.getAttribute("width")).toBe("20");
      expect(svg?.getAttribute("height")).toBe("20");
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

  it("opens the OS file picker from the attach button without stealing focus", () => {
    const anchor = document.createElement("button");
    anchor.type = "button";
    anchor.textContent = "Terminal focus sentinel";
    document.body.appendChild(anchor);
    anchor.focus();
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { container } = renderBar({ onAttachFiles: vi.fn() });
    const attach = buttonByLabel(container, "Attach files");

    act(() => {
      expect(fireEvent.pointerDown(attach)).toBe(false);
      attach.click();
    });

    expect(document.activeElement).toBe(anchor);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
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

  it("disables attach when onAttachFiles is undefined", () => {
    const { container } = renderBar({ onAttachFiles: undefined });
    expect(buttonByLabel(container, "Attach files").disabled).toBe(true);
  });

  it("uses a single unrestricted multi-file input for attachments", () => {
    const { container } = renderBar({ onAttachFiles: vi.fn() });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.multiple).toBe(true);
    expect(input?.hasAttribute("accept")).toBe(false);
    expect(input?.hasAttribute("capture")).toBe(false);
  });

  it("forwards picked files to onAttachFiles", () => {
    const onAttachFiles = vi.fn();
    const onAfterSend = vi.fn();
    const { container } = renderBar({ onAttachFiles, onAfterSend });
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("missing file input");
    const image = new File(["x"], "x.png", { type: "image/png" });
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [image, text],
    });
    act(() => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAttachFiles).toHaveBeenCalledWith([image, text]);
    expect(onAfterSend).toHaveBeenCalledTimes(1);
    expect(fileInput.value).toBe("");
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
