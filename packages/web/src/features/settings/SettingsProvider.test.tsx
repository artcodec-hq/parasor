import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "./SettingsProvider.js";

const { injectFontFaceMock } = vi.hoisted(() => ({
  injectFontFaceMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/font-loader.js", () => ({
  injectFontFace: injectFontFaceMock,
}));

function installStorage(): void {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

describe("SettingsProvider font loading", () => {
  beforeEach(() => {
    installStorage();
    injectFontFaceMock.mockClear();
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defers selected preset font injection until after the startup fallback window", () => {
    localStorage.setItem(
      "parasor:settings",
      JSON.stringify({ fontPresetId: "udev-gothic" }),
    );

    render(
      <SettingsProvider>
        <div />
      </SettingsProvider>,
    );

    expect(injectFontFaceMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1199);
    expect(injectFontFaceMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(injectFontFaceMock).toHaveBeenCalledWith({
      family: "UDEV Gothic",
      url: "/api/fonts/file/udev-gothic",
    });
  });
});
