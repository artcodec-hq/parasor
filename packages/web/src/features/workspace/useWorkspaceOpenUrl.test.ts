import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openHttpUrlInNewTab } from "../../lib/open-external-url.js";
import { useWorkspaceOpenUrl } from "./useWorkspaceOpenUrl.js";

vi.mock("../../lib/open-external-url.js", () => ({
  openHttpUrlInNewTab: vi.fn(),
}));

const mockOpenHttpUrlInNewTab = vi.mocked(openHttpUrlInNewTab);

describe("useWorkspaceOpenUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "window",
      Object.create(window, {
        location: { value: new URL("http://phone.lan:7681") },
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reports an unreachable loopback port without opening a tab", () => {
    const onUnreachablePort = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceOpenUrl({
        activeProjectId: "p1",
        clearPendingUrl: vi.fn(),
        onUnreachablePort,
        pendingOpenUrl: null,
        ports: {},
      }),
    );

    act(() => result.current("http://localhost:7783", { projectId: "p1" }));

    expect(onUnreachablePort).toHaveBeenCalledWith(7783);
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
  });

  it("opens a resolved reachable URL", () => {
    const { result } = renderHook(() =>
      useWorkspaceOpenUrl({
        activeProjectId: "p1",
        clearPendingUrl: vi.fn(),
        onUnreachablePort: vi.fn(),
        pendingOpenUrl: null,
        ports: {
          p1: [{ port: 7783, pid: 1, bindsAll: false, reachablePort: 51234 }],
        },
      }),
    );

    act(() => result.current("http://localhost:7783/path?x=1#section"));

    expect(mockOpenHttpUrlInNewTab).toHaveBeenCalledWith(
      "http://phone.lan:51234/path?x=1#section",
    );
  });
  it("clears a pending unreachable URL once without opening a tab", () => {
    const clearPendingUrl = vi.fn();
    const onUnreachablePort = vi.fn();
    renderHook(() =>
      useWorkspaceOpenUrl({
        activeProjectId: "p1",
        clearPendingUrl,
        onUnreachablePort,
        pendingOpenUrl: "http://[::1]:7783/",
        ports: {},
      }),
    );

    expect(onUnreachablePort).toHaveBeenCalledExactlyOnceWith(7783);
    expect(clearPendingUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
  });
});
