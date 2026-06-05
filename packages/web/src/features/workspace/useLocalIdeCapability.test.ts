import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/git-api.js", () => ({
  fetchLocalIdeCapability: vi.fn(),
}));

import { fetchLocalIdeCapability } from "../../lib/git-api.js";
import { useLocalIdeCapability } from "./useLocalIdeCapability.js";

const mockFetch = vi.mocked(fetchLocalIdeCapability);

function setHostname(hostname: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, hostname },
  });
}

const originalLocation = window.location;

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("useLocalIdeCapability", () => {
  it("starts with capability=null; loopback hostname makes canOpenLocalIde true before the probe resolves", () => {
    setHostname("127.0.0.1");
    // Pending fetch -- never resolves so we can observe the initial state.
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocalIdeCapability());
    expect(result.current.capability).toBe(null);
    expect(result.current.canOpenLocalIde).toBe(true);
  });

  it("starts with capability=null; non-loopback hostname keeps canOpenLocalIde false before the probe resolves", () => {
    setHostname("example.com");
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocalIdeCapability());
    expect(result.current.capability).toBe(null);
    expect(result.current.canOpenLocalIde).toBe(false);
  });

  it("adopts the probed capability=true and prefers it over the hostname fallback", async () => {
    setHostname("example.com");
    mockFetch.mockResolvedValue({ canOpenLocalIde: true });
    const { result } = renderHook(() => useLocalIdeCapability());
    await waitFor(() => expect(result.current.capability).toBe(true));
    expect(result.current.canOpenLocalIde).toBe(true);
  });

  it("adopts the probed capability=false and prefers it over a loopback fallback", async () => {
    setHostname("127.0.0.1");
    mockFetch.mockResolvedValue({ canOpenLocalIde: false });
    const { result } = renderHook(() => useLocalIdeCapability());
    await waitFor(() => expect(result.current.capability).toBe(false));
    // capability=false wins over loopback fallback via `?? localIdeHostnameFallback`.
    expect(result.current.canOpenLocalIde).toBe(false);
  });

  it("leaves capability null on fetch rejection but keeps the hostname fallback intact", async () => {
    setHostname("localhost");
    mockFetch.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useLocalIdeCapability());
    // Wait for the rejection's catch handler to run before asserting.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.capability).toBe(null);
    expect(result.current.canOpenLocalIde).toBe(true);
  });

  it("ignores the resolved capability if the consumer unmounts before the fetch settles", async () => {
    setHostname("example.com");
    let resolveFetch!: (value: { canOpenLocalIde: boolean }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useLocalIdeCapability());
    unmount();
    resolveFetch({ canOpenLocalIde: true });
    await Promise.resolve();
    await Promise.resolve();
    // The hook unmounted, so the last reported capability stays null.
    expect(result.current.capability).toBe(null);
  });
});
