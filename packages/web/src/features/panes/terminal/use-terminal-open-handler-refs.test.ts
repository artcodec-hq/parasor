import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTerminalOpenHandlerRefs } from "./use-terminal-open-handler-refs.js";

describe("useTerminalOpenHandlerRefs", () => {
  it("keeps stable refs updated with the latest open handler props", () => {
    const openUrl = vi.fn();
    const openFilePath = vi.fn();
    const nextOpenUrl = vi.fn();
    const nextOpenFilePath = vi.fn();

    const { result, rerender } = renderHook(
      ({ onOpenUrl, onOpenFilePath, projectId, worktreePath }) =>
        useTerminalOpenHandlerRefs({
          onOpenUrl,
          onOpenFilePath,
          projectId,
          worktreePath,
        }),
      {
        initialProps: {
          onOpenUrl: openUrl,
          onOpenFilePath: openFilePath,
          projectId: "project-1",
          worktreePath: "/repo",
        },
      },
    );

    const refs = result.current;
    expect(refs.openUrlRef.current).toBe(openUrl);
    expect(refs.openFilePathRef.current).toBe(openFilePath);
    expect(refs.projectIdRef.current).toBe("project-1");
    expect(refs.worktreePathRef.current).toBe("/repo");

    rerender({
      onOpenUrl: nextOpenUrl,
      onOpenFilePath: nextOpenFilePath,
      projectId: "project-2",
      worktreePath: "/repo/app",
    });

    expect(result.current.openUrlRef).toBe(refs.openUrlRef);
    expect(result.current.openFilePathRef).toBe(refs.openFilePathRef);
    expect(result.current.projectIdRef).toBe(refs.projectIdRef);
    expect(result.current.worktreePathRef).toBe(refs.worktreePathRef);
    expect(result.current.openUrlRef.current).toBe(nextOpenUrl);
    expect(result.current.openFilePathRef.current).toBe(nextOpenFilePath);
    expect(result.current.projectIdRef.current).toBe("project-2");
    expect(result.current.worktreePathRef.current).toBe("/repo/app");
  });
});
