import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPaneFocusRegistryForTests,
  clearPendingPaneFocus,
  registerPaneFocus,
  requestPaneFocus,
} from "./pane-focus-registry.js";

describe("pane-focus-registry", () => {
  beforeEach(() => {
    __resetPaneFocusRegistryForTests();
  });

  it("calls the registered handler when request fires after register", () => {
    const fn = vi.fn();
    registerPaneFocus("pane-a", fn);
    requestPaneFocus("pane-a");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("replays a pending request when handler registers later (mount race)", () => {
    const fn = vi.fn();
    requestPaneFocus("pane-b");
    expect(fn).not.toHaveBeenCalled();
    registerPaneFocus("pane-b", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire on subsequent registers after the pending was consumed", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    requestPaneFocus("pane-c");
    registerPaneFocus("pane-c", fn1);
    expect(fn1).toHaveBeenCalledTimes(1);
    registerPaneFocus("pane-c", fn2);
    expect(fn2).not.toHaveBeenCalled();
  });

  it("isolates requests by paneId", () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    registerPaneFocus("pane-a", fnA);
    registerPaneFocus("pane-b", fnB);
    requestPaneFocus("pane-a");
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).not.toHaveBeenCalled();
  });

  it("unregister returns a disposer that drops only the matching handler", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const dispose1 = registerPaneFocus("pane-a", fn1);
    registerPaneFocus("pane-a", fn2);
    dispose1();
    requestPaneFocus("pane-a");
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("clearPendingPaneFocus drops a pending request before any handler arrives", () => {
    const fn = vi.fn();
    requestPaneFocus("pane-a");
    clearPendingPaneFocus("pane-a");
    registerPaneFocus("pane-a", fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
