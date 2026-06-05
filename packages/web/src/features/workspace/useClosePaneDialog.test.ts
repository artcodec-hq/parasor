import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type ClosePaneTarget,
  useClosePaneDialog,
} from "./useClosePaneDialog.js";

describe("useClosePaneDialog", () => {
  it("starts with no target", () => {
    const { result } = renderHook(() =>
      useClosePaneDialog({ onConfirm: vi.fn() }),
    );
    expect(result.current.target).toBe(null);
  });

  it("request sets a terminal target", () => {
    const { result } = renderHook(() =>
      useClosePaneDialog({ onConfirm: vi.fn() }),
    );
    act(() => {
      result.current.request("terminal:s1", "terminal", "Session 1");
    });
    expect(result.current.target).toEqual<ClosePaneTarget>({
      paneId: "terminal:s1",
      paneKind: "terminal",
      title: "Session 1",
    });
  });

  it("request sets a browser target", () => {
    const { result } = renderHook(() =>
      useClosePaneDialog({ onConfirm: vi.fn() }),
    );
    act(() => {
      result.current.request("browser:abc", "browser", "Preview");
    });
    expect(result.current.target?.paneKind).toBe("browser");
    expect(result.current.target?.title).toBe("Preview");
  });

  it("cancel clears the pending target", () => {
    const { result } = renderHook(() =>
      useClosePaneDialog({ onConfirm: vi.fn() }),
    );
    act(() => {
      result.current.request("terminal:s1", "terminal", "x");
    });
    act(() => {
      result.current.cancel();
    });
    expect(result.current.target).toBe(null);
  });

  it("confirm clears the target before invoking onConfirm with the captured value", async () => {
    let observedTargetDuringConfirm: ClosePaneTarget | null | undefined;
    const onConfirm = vi.fn(async (target: ClosePaneTarget) => {
      observedTargetDuringConfirm = target;
    });
    const { result } = renderHook(() => useClosePaneDialog({ onConfirm }));
    act(() => {
      result.current.request("terminal:s1", "terminal", "x");
    });
    await act(async () => {
      await result.current.confirm();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(observedTargetDuringConfirm).toEqual({
      paneId: "terminal:s1",
      paneKind: "terminal",
      title: "x",
    });
    expect(result.current.target).toBe(null);
  });

  it("confirm without a target is a no-op", async () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useClosePaneDialog({ onConfirm }));
    await act(async () => {
      await result.current.confirm();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirm awaits async onConfirm", async () => {
    let resolveOuter!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOuter = resolve;
        }),
    );
    const { result } = renderHook(() => useClosePaneDialog({ onConfirm }));
    act(() => {
      result.current.request("terminal:s1", "terminal", "x");
    });
    let settled = false;
    // Detach the act so we can observe its in-flight state. Capture the
    // returned promise so we can await its completion below.
    const confirmAct = act(async () => {
      await result.current.confirm();
      settled = true;
    });
    // Yield microtasks so confirm() runs up to its inner await.
    await Promise.resolve();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalled();
    expect(settled).toBe(false);

    resolveOuter();
    await confirmAct;
    expect(settled).toBe(true);
    expect(result.current.target).toBe(null);
  });
});
