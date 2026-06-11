import { beforeEach, describe, expect, it, vi } from "vitest";

function installStorage(): Storage {
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
  return storage;
}

describe("terminal-trace query initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState(null, "", "/");
  });

  it.each([
    "0",
    "false",
  ])("treats terminalTrace=%s as an explicit persisted disable value", async (value) => {
    const storage = installStorage();
    storage.setItem("parasor:terminal-trace", "1");
    window.history.replaceState(null, "", `/?terminalTrace=${value}`);
    const { isTerminalTraceEnabled } = await import("./terminal-trace.js");

    expect(isTerminalTraceEnabled()).toBe(false);
    expect(window.localStorage.getItem("parasor:terminal-trace")).toBeNull();
  });
});
