import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsOverlay } from "./SettingsOverlay.js";
import { SettingsProvider } from "./SettingsProvider.js";

function mockDesktopMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(min-width: 768px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function renderOverlay({
  desktop,
  onClose = vi.fn(),
}: {
  desktop: boolean;
  onClose?: () => void;
}) {
  mockDesktopMedia(desktop);
  return {
    onClose,
    ...render(
      <SettingsProvider>
        <SettingsOverlay open onClose={onClose} />
      </SettingsProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("SettingsOverlay", () => {
  it("renders desktop settings as an accessible modal dialog with detail selected", () => {
    renderOverlay({ desktop: true });

    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="Settings"]',
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.className).toContain("rounded-window");
    expect(dialog?.className).toContain("flex ");
    expect(dialog?.className).toContain("flex-row");
    expect(document.body.textContent).toContain("Color theme");
  });

  it("renders mobile settings as a full-screen dialog starting on the section list", () => {
    renderOverlay({ desktop: false });

    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="Settings"]',
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain("h-full");
    expect(dialog?.className).not.toContain("rounded-window");
    expect(document.body.textContent).toContain("Theme");
    expect(document.body.textContent).not.toContain("Color theme");
  });

  it("returns mobile detail to the section list on Escape before closing", () => {
    const onClose = vi.fn();
    renderOverlay({ desktop: false, onClose });

    fireEvent.click(document.body.querySelector("nav button") as HTMLElement);
    expect(document.body.textContent).toContain("Color theme");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Color theme");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
