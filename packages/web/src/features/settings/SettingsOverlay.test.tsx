import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsOverlay } from "./SettingsOverlay.js";
import { SettingsProvider } from "./SettingsProvider.js";
import type { ServerSettingsBinding } from "./settings-sections.js";

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
  server,
}: {
  desktop: boolean;
  onClose?: () => void;
  server?: ServerSettingsBinding;
}) {
  mockDesktopMedia(desktop);
  return {
    onClose,
    ...render(
      <SettingsProvider>
        <SettingsOverlay open onClose={onClose} server={server} />
      </SettingsProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("SettingsOverlay", () => {
  it("renders desktop settings as an accessible dialog with detail selected", () => {
    renderOverlay({ desktop: true });

    const dialog = document.body.querySelector(
      '[role="dialog"][aria-label="Settings"]',
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.className).toContain("rounded-window");
    expect(dialog?.className).toContain("flex ");
    expect(dialog?.className).toContain("flex-col");
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
    expect(document.body.textContent).toContain("Appearance");
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

  it("wires the prevent idle sleep toggle to the server settings handler", () => {
    const onPreventIdleSleepChange = vi.fn();
    const server: ServerSettingsBinding = {
      hostPlatform: "darwin",
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: 10,
        dropSizeHardMaxBytes: 20,
      },
      onPreventIdleSleepChange,
      onPortDetectionChange: vi.fn(),
      onDropSizeMaxBytesChange: vi.fn(),
    };
    const { getByText } = renderOverlay({ desktop: true, server });

    fireEvent.click(getByText("Local environment"));

    const row = getByText("Prevent idle sleep").closest(".min-h-12");
    const checkbox = row?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    expect(checkbox?.checked).toBe(false);

    fireEvent.click(checkbox as HTMLInputElement);

    expect(onPreventIdleSleepChange).toHaveBeenCalledWith(true);
  });
});
