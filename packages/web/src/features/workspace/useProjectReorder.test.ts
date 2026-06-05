import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/auth-fetch.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/auth-fetch.js")>();
  return {
    ...actual,
    authFetch: vi.fn(),
  };
});

import { AuthExpiredError, authFetch } from "../../lib/auth-fetch.js";
import { useProjectReorder } from "./useProjectReorder.js";

const mockFetch = vi.mocked(authFetch);

function okResponse(): Response {
  return { ok: true } as unknown as Response;
}

function notOkResponse(): Response {
  return { ok: false } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProjectReorder", () => {
  it("starts with zero pending count and zero reset signal", () => {
    const { result } = renderHook(() =>
      useProjectReorder({ onError: vi.fn() }),
    );
    expect(result.current.pendingProjectReorderCount).toBe(0);
    expect(result.current.reorderResetSignal).toBe(0);
  });

  it("sends PUT /api/projects/order with the supplied ids", async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { result } = renderHook(() =>
      useProjectReorder({ onError: vi.fn() }),
    );
    await act(async () => {
      await result.current.reorder(["p1", "p2", "p3"]);
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["p1", "p2", "p3"] }),
    });
  });

  it("does not bump reorderResetSignal on success and leaves pending count at 0 when done", async () => {
    mockFetch.mockResolvedValue(okResponse());
    const onError = vi.fn();
    const { result } = renderHook(() => useProjectReorder({ onError }));
    await act(async () => {
      await result.current.reorder(["p1"]);
    });
    expect(result.current.reorderResetSignal).toBe(0);
    expect(result.current.pendingProjectReorderCount).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("bumps reorderResetSignal and surfaces the error toast when the response is not ok", async () => {
    mockFetch.mockResolvedValue(notOkResponse());
    const onError = vi.fn();
    const { result } = renderHook(() => useProjectReorder({ onError }));
    await act(async () => {
      await result.current.reorder(["p1"]);
    });
    expect(result.current.reorderResetSignal).toBe(1);
    expect(onError).toHaveBeenCalledWith(
      "Failed to reorder projects -- reverted to previous order.",
    );
  });

  it("bumps reorderResetSignal and surfaces the error toast when authFetch throws a non-auth error", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const onError = vi.fn();
    const { result } = renderHook(() => useProjectReorder({ onError }));
    await act(async () => {
      await result.current.reorder(["p1"]);
    });
    expect(result.current.reorderResetSignal).toBe(1);
    expect(onError).toHaveBeenCalledWith(
      "Failed to reorder projects -- reverted to previous order.",
    );
  });

  it("swallows AuthExpiredError silently -- no reset signal, no toast", async () => {
    mockFetch.mockRejectedValue(new AuthExpiredError());
    const onError = vi.fn();
    const { result } = renderHook(() => useProjectReorder({ onError }));
    await act(async () => {
      await result.current.reorder(["p1"]);
    });
    expect(result.current.reorderResetSignal).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.pendingProjectReorderCount).toBe(0);
  });

  it("decrements pending count even when authFetch rejects with a non-auth error", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    const onError = vi.fn();
    const { result } = renderHook(() => useProjectReorder({ onError }));
    await act(async () => {
      await result.current.reorder(["p1"]);
    });
    expect(result.current.pendingProjectReorderCount).toBe(0);
  });

  it("serializes concurrent reorder calls through the runner", async () => {
    // Resolve fetches in the order they are awaited so we can observe
    // the runner's serialization by checking the call order.
    const resolvers: Array<(value: Response) => void> = [];
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { result } = renderHook(() =>
      useProjectReorder({ onError: vi.fn() }),
    );
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.reorder(["a"]);
      second = result.current.reorder(["b"]);
    });
    // After both calls, only the first fetch should have started -- the
    // runner queues the second until the first resolves.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "/api/projects/order",
      expect.objectContaining({ body: JSON.stringify({ ids: ["a"] }) }),
    );
    // Pending counter reflects both in-flight requests.
    expect(result.current.pendingProjectReorderCount).toBe(2);
    await act(async () => {
      resolvers[0]?.(okResponse());
      await first;
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/projects/order",
      expect.objectContaining({ body: JSON.stringify({ ids: ["b"] }) }),
    );
    await act(async () => {
      resolvers[1]?.(okResponse());
      await second;
    });
    expect(result.current.pendingProjectReorderCount).toBe(0);
  });

  it("does not bump reorderResetSignal when only AuthExpiredError occurs even if pendingCount was incremented", async () => {
    mockFetch.mockRejectedValue(new AuthExpiredError());
    const onError = vi.fn();
    const { result } = renderHook(() => useProjectReorder({ onError }));
    // Two reorders both auth-expire -- neither should trip the reset.
    await act(async () => {
      await Promise.all([
        result.current.reorder(["a"]),
        result.current.reorder(["b"]),
      ]);
    });
    expect(result.current.reorderResetSignal).toBe(0);
    expect(result.current.pendingProjectReorderCount).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });
});
