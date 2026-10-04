import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_METADATA, APP_VERSION } from "../../lib/app-version.js";
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

  it("shows the app version in the About section", () => {
    const { getByText } = renderOverlay({ desktop: true });

    fireEvent.click(getByText("About"));

    expect(document.body.textContent).toContain("Parasor");
    expect(document.body.textContent).toContain(
      "Mobile-first local development workspace.",
    );
    expect(document.body.textContent).toContain("Version");
    expect(document.body.textContent).toContain(APP_VERSION);
    expect(document.body.textContent).toContain("License");
    expect(document.body.textContent).toContain(APP_METADATA.license);

    const repository = getByText("GitHub").closest("a");
    expect(repository?.getAttribute("href")).toBe(APP_METADATA.repositoryUrl);
    expect(repository?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(repository?.getAttribute("referrerpolicy")).toBe("no-referrer");

    const issues = getByText("Issues").closest("a");
    expect(issues?.getAttribute("href")).toBe(APP_METADATA.issuesUrl);
  });

  it("gives every settings form field a stable id, name, and accessible label", () => {
    const server: ServerSettingsBinding = {
      hostPlatform: "darwin",
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: 10,
        dropSizeHardMaxBytes: 20,
      },
      onPreventIdleSleepChange: vi.fn(),
      onPortDetectionChange: vi.fn(),
      onDropSizeMaxBytesChange: vi.fn(),
      ideCommands: [
        { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
      ],
      onIdeCommandsChange: vi.fn(),
    };
    const { getByText } = renderOverlay({ desktop: true, server });

    const dialogFields = () => [
      ...document.body.querySelectorAll(
        '[role="dialog"][aria-label="Settings"] input, [role="dialog"][aria-label="Settings"] textarea, [role="dialog"][aria-label="Settings"] select',
      ),
    ];

    const fields = new Set<Element>();
    const collect = () => {
      for (const field of dialogFields()) fields.add(field);
    };

    // Desktop starts on the first section (Appearance); also open the
    // custom-theme sub-form so its fields are covered too.
    collect();
    fireEvent.click(getByText("Add theme"));
    collect();

    const sectionNames = [...document.body.querySelectorAll("nav button")].map(
      (button) => button.textContent?.trim() ?? "",
    );
    for (const name of sectionNames) {
      const navButton = [...document.body.querySelectorAll("nav button")].find(
        (button) => button.textContent?.trim() === name,
      );
      if (navButton) fireEvent.click(navButton);
      collect();
    }

    expect(fields.size).toBeGreaterThan(0);
    for (const field of fields) {
      const id = field.getAttribute("id");
      const description = `${field.tagName.toLowerCase()}#${id ?? "?"} (${field.getAttribute("placeholder") ?? field.getAttribute("type") ?? "field"})`;
      expect(id, `${description} is missing an id`).toBeTruthy();
      expect(
        field.getAttribute("name"),
        `${description} is missing a name`,
      ).toBe(id);
      const wrappingLabel = field.closest("label");
      const hasAccessibleLabel =
        field.getAttribute("aria-label") ??
        (id && document.body.querySelector(`label[for="${id}"]`)) ??
        (wrappingLabel?.textContent?.trim() || null);
      expect(
        hasAccessibleLabel,
        `${description} has no accessible label`,
      ).toBeTruthy();
    }
  });
});
