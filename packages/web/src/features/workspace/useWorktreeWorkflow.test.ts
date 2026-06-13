import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY } from "../../lib/terminal-internal-clipboard.js";
import { useWorktreeWorkflow } from "./useWorktreeWorkflow.js";

function installStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("useWorktreeWorkflow", () => {
  beforeEach(() => {
    installStorage();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException("blocked")),
      },
    });
  });

  it("copies worktree paths into the terminal paste fallback clipboard", async () => {
    const { result } = renderHook(() => useWorktreeWorkflow());

    act(() => {
      result.current.copyWorktreePath("/repo/worktrees/feature");
    });

    await waitFor(() => {
      expect(
        window.localStorage.getItem(TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY),
      ).toBe("/repo/worktrees/feature");
    });
  });
});
