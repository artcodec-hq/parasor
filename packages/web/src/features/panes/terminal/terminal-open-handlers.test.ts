import { beforeEach, describe, expect, it, vi } from "vitest";
import { openHttpUrlInNewTab } from "../../../lib/open-external-url.js";
import { createTerminalOpenHandlers } from "./terminal-open-handlers.js";

vi.mock("../../../lib/open-external-url.js", () => ({
  openHttpUrlInNewTab: vi.fn(),
}));

const mockOpenHttpUrlInNewTab = vi.mocked(openHttpUrlInNewTab);

describe("createTerminalOpenHandlers", () => {
  beforeEach(() => {
    mockOpenHttpUrlInNewTab.mockReset();
  });

  it("routes embedded terminal URLs through the pane URL callback with project context", () => {
    const openUrl = vi.fn();
    const handlers = createTerminalOpenHandlers({
      openUrlRef: { current: openUrl },
      openFilePathRef: { current: undefined },
      projectIdRef: { current: "project-1" },
      worktreePathRef: { current: undefined },
    });

    handlers.openUrl("http://localhost:5173");

    expect(openUrl).toHaveBeenCalledWith("http://localhost:5173", {
      projectId: "project-1",
    });
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
  });

  it("opens non-embedded URLs in a new browser tab", () => {
    const openUrl = vi.fn();
    const handlers = createTerminalOpenHandlers({
      openUrlRef: { current: openUrl },
      openFilePathRef: { current: undefined },
      projectIdRef: { current: "project-1" },
      worktreePathRef: { current: undefined },
    });

    handlers.openUrl("https://example.com/docs");

    expect(openUrl).not.toHaveBeenCalled();
    expect(mockOpenHttpUrlInNewTab).toHaveBeenCalledWith(
      "https://example.com/docs",
    );
  });

  it("forwards terminal file links and exposes the current worktree path", () => {
    const openFilePath = vi.fn();
    const handlers = createTerminalOpenHandlers({
      openUrlRef: { current: undefined },
      openFilePathRef: { current: openFilePath },
      projectIdRef: { current: undefined },
      worktreePathRef: { current: "/repo" },
    });

    handlers.openFilePath("/repo/src/App.tsx");

    expect(openFilePath).toHaveBeenCalledWith("/repo/src/App.tsx");
    expect(handlers.getWorktreePath()).toBe("/repo");
  });
});
