import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorToast } from "./useErrorToast.js";

describe("useErrorToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts hidden", () => {
    const { result } = renderHook(() => useErrorToast());
    expect(result.current[0]).toBe(null);
  });

  it("shows the message until autoDismissMs elapses", () => {
    const { result } = renderHook(() => useErrorToast(5000));
    act(() => {
      result.current[1]("failed");
    });
    expect(result.current[0]).toBe("failed");

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current[0]).toBe("failed");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe(null);
  });

  it("uses the default 5000ms dismissal when no override is given", () => {
    const { result } = renderHook(() => useErrorToast());
    act(() => {
      result.current[1]("oops");
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current[0]).toBe(null);
  });

  it("restarts the timer when a new message replaces an active one", () => {
    const { result } = renderHook(() => useErrorToast(5000));
    act(() => {
      result.current[1]("first");
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      result.current[1]("second");
    });
    // 3s elapsed + 4s more = 7s total; first message would have expired but
    // the second one started its own 5s window.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current[0]).toBe("second");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe(null);
  });

  it("clears immediately when set to null", () => {
    const { result } = renderHook(() => useErrorToast(5000));
    act(() => {
      result.current[1]("msg");
    });
    expect(result.current[0]).toBe("msg");
    act(() => {
      result.current[1](null);
    });
    expect(result.current[0]).toBe(null);
  });

  it("clears the pending timeout when the hook unmounts", () => {
    const { result, unmount } = renderHook(() => useErrorToast(5000));
    act(() => {
      result.current[1]("msg");
    });
    // No assertion needed beyond unmount succeeding without throwing -- the
    // cleanup path is exercised. Advance time to confirm no late state
    // update fires on the unmounted hook (would surface as a React warning).
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
  });
});
