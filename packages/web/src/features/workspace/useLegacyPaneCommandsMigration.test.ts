import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/pane-command-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/pane-command-store.js")>();
  return {
    ...actual,
    loadPaneCommands: vi.fn(),
  };
});

import {
  type CustomPaneCommand,
  loadPaneCommands,
} from "../../lib/pane-command-store.js";
import { useLegacyPaneCommandsMigration } from "./useLegacyPaneCommandsMigration.js";

const mockLoad = vi.mocked(loadPaneCommands);

const sampleCommand: CustomPaneCommand = {
  id: "cmd-1",
  label: "echo",
  initialInput: "echo hi",
};

beforeEach(() => {
  mockLoad.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLegacyPaneCommandsMigration", () => {
  it("does not run while the store has not hydrated", () => {
    const onMigrate = vi.fn();
    renderHook(() =>
      useLegacyPaneCommandsMigration({
        hydrated: false,
        paneCommandsCount: 0,
        onMigrate,
      }),
    );
    expect(mockLoad).not.toHaveBeenCalled();
    expect(onMigrate).not.toHaveBeenCalled();
  });

  it("does not run when the server already has pane commands", () => {
    const onMigrate = vi.fn();
    renderHook(() =>
      useLegacyPaneCommandsMigration({
        hydrated: true,
        paneCommandsCount: 3,
        onMigrate,
      }),
    );
    expect(mockLoad).not.toHaveBeenCalled();
    expect(onMigrate).not.toHaveBeenCalled();
  });

  it("runs once when hydrated with zero server commands and forwards legacy entries", () => {
    mockLoad.mockReturnValue([sampleCommand]);
    const onMigrate = vi.fn();
    renderHook(() =>
      useLegacyPaneCommandsMigration({
        hydrated: true,
        paneCommandsCount: 0,
        onMigrate,
      }),
    );
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(onMigrate).toHaveBeenCalledWith([sampleCommand]);
  });

  it("skips onMigrate when legacy storage is empty (and still marks attempted)", () => {
    mockLoad.mockReturnValue([]);
    const onMigrate = vi.fn();
    const { rerender } = renderHook(
      ({ count }: { count: number }) =>
        useLegacyPaneCommandsMigration({
          hydrated: true,
          paneCommandsCount: count,
          onMigrate,
        }),
      { initialProps: { count: 0 } },
    );
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(onMigrate).not.toHaveBeenCalled();
    // Re-render should not run the migration again because `attempted`
    // was latched.
    rerender({ count: 0 });
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it("swallows storage errors and skips onMigrate", () => {
    mockLoad.mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const onMigrate = vi.fn();
    renderHook(() =>
      useLegacyPaneCommandsMigration({
        hydrated: true,
        paneCommandsCount: 0,
        onMigrate,
      }),
    );
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(onMigrate).not.toHaveBeenCalled();
  });

  it("does not re-run after a successful migration even if paneCommandsCount drops back to 0", () => {
    mockLoad.mockReturnValue([sampleCommand]);
    const onMigrate = vi.fn();
    const { rerender } = renderHook(
      ({ count }: { count: number }) =>
        useLegacyPaneCommandsMigration({
          hydrated: true,
          paneCommandsCount: count,
          onMigrate,
        }),
      { initialProps: { count: 0 } },
    );
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(onMigrate).toHaveBeenCalledTimes(1);
    // Server clears commands; migration must NOT re-fire (the
    // `attempted` ref is a permanent latch for the component's lifetime).
    rerender({ count: 1 });
    rerender({ count: 0 });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });

  it("re-reads legacy storage only the first time the gate opens (hydration toggles true)", () => {
    mockLoad.mockReturnValue([sampleCommand]);
    const onMigrate = vi.fn();
    const { rerender } = renderHook(
      ({ hydrated }: { hydrated: boolean }) =>
        useLegacyPaneCommandsMigration({
          hydrated,
          paneCommandsCount: 0,
          onMigrate,
        }),
      { initialProps: { hydrated: false } },
    );
    expect(mockLoad).not.toHaveBeenCalled();
    rerender({ hydrated: true });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(onMigrate).toHaveBeenCalledWith([sampleCommand]);
  });
});
