import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatcherLifecycle } from "./watcher-lifecycle.js";

describe("WatcherLifecycle", () => {
  let lifecycle: WatcherLifecycle;
  let startCalls: string[];
  let stopCalls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    startCalls = [];
    stopCalls = [];
    lifecycle = new WatcherLifecycle({
      onActivate: async (projectId) => {
        startCalls.push(projectId);
      },
      onSuspend: async (projectId) => {
        stopCalls.push(projectId);
      },
      idleTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    lifecycle.dispose();
    vi.useRealTimers();
  });

  it("activates on first session", async () => {
    await lifecycle.onSessionCreated("proj-1");
    expect(startCalls).toContain("proj-1");
  });

  it("does not duplicate activation", async () => {
    await lifecycle.onSessionCreated("proj-1");
    await lifecycle.onSessionCreated("proj-1");
    expect(startCalls).toEqual(["proj-1"]);
  });

  it("suspends after idle timeout with no sessions", async () => {
    await lifecycle.onSessionCreated("proj-1");
    await lifecycle.onSessionEnded("proj-1");
    await lifecycle.onClientFocusLost("proj-1");

    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();

    expect(stopCalls).toContain("proj-1");
  });

  it("stays active if client is focused", async () => {
    await lifecycle.onSessionCreated("proj-1");
    lifecycle.onClientFocused("proj-1");
    await lifecycle.onSessionEnded("proj-1");

    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();

    expect(stopCalls).not.toContain("proj-1");
  });

  it("reactivates on new session", async () => {
    await lifecycle.onSessionCreated("proj-1");
    await lifecycle.onSessionEnded("proj-1");
    await lifecycle.onClientFocusLost("proj-1");

    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();

    expect(stopCalls).toContain("proj-1");

    startCalls.length = 0;
    await lifecycle.onSessionCreated("proj-1");
    expect(startCalls).toContain("proj-1");
  });

  it("cleans up on project delete", async () => {
    await lifecycle.onSessionCreated("proj-1");
    await lifecycle.onProjectDeleted("proj-1");
    expect(stopCalls).toContain("proj-1");
  });

  it("starts suspended and does not activate missing projects", async () => {
    const skipped: string[] = [];
    const gated = new WatcherLifecycle({
      onActivate: async (projectId) => {
        startCalls.push(projectId);
      },
      onSuspend: async (projectId) => {
        stopCalls.push(projectId);
      },
      shouldActivate: (id) => {
        if (id === "gone") {
          skipped.push(id);
          return false;
        }
        return true;
      },
      idleTimeoutMs: 1000,
    });
    await gated.onClientFocused("gone");
    expect(gated.isActive("gone")).toBe(false);
    expect(gated.hasInterest("gone")).toBe(true);
    expect(startCalls).not.toContain("gone");
    expect(skipped).toEqual(["gone"]);
    gated.dispose();
  });

  it("forceSuspend tears down an active watcher without dropping counters", async () => {
    await lifecycle.onSessionCreated("proj-1");
    expect(startCalls).toContain("proj-1");
    await lifecycle.forceSuspend("proj-1");
    expect(stopCalls).toContain("proj-1");
    expect(lifecycle.isActive("proj-1")).toBe(false);
    expect(lifecycle.hasInterest("proj-1")).toBe(true);
    startCalls.length = 0;
    await lifecycle.ensureActive("proj-1");
    expect(startCalls).toEqual(["proj-1"]);
  });
});
