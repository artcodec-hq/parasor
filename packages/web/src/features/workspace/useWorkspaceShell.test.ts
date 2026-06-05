import type { Project } from "@parasor/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShell } from "./useWorkspaceShell.js";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    pinned: false,
    lastAccessedAt: 0,
    ...overrides,
  } as Project;
}

beforeEach(() => {
  // This jsdom config provides neither matchMedia nor localStorage; the hook
  // (via useMediaQuery + a legacy-key cleanup effect) touches both.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("useWorkspaceShell", () => {
  it("does not read or clear pending open URLs (handled by App.openUrl now)", () => {
    const setActiveProjectId = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceShell({
        activeProjectId: "p1",
        projects: [project("p1")],
        setActiveProjectId,
      }),
    );
    // The hook's surface is settings + isMobile only -- no pending-URL plumbing.
    expect(Object.keys(result.current).sort()).toEqual([
      "closeSettings",
      "isMobile",
      "openSettings",
      "settingsOpen",
    ]);
  });

  it("toggles settings open/closed", () => {
    const { result } = renderHook(() =>
      useWorkspaceShell({
        activeProjectId: "p1",
        projects: [],
        setActiveProjectId: vi.fn(),
      }),
    );
    expect(result.current.settingsOpen).toBe(false);
    act(() => result.current.openSettings());
    expect(result.current.settingsOpen).toBe(true);
    act(() => result.current.closeSettings());
    expect(result.current.settingsOpen).toBe(false);
  });
});
