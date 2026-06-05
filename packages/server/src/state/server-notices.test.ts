import { describe, expect, it } from "vitest";
import { ServerNoticesStore } from "./server-notices.js";

describe("ServerNoticesStore", () => {
  it("starts empty", () => {
    const store = new ServerNoticesStore();
    expect(store.list()).toEqual([]);
    expect(store.has("daemon-auto-restarted")).toBe(false);
  });

  it("records daemon-auto-restarted with version detail and timestamp", () => {
    const store = new ServerNoticesStore();
    store.recordDaemonAutoRestarted({
      serverProtocolVersion: "1.1.0",
      daemonProtocolVersion: "1.0.0",
    });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("daemon-auto-restarted");
    expect(list[0].serverProtocolVersion).toBe("1.1.0");
    expect(list[0].daemonProtocolVersion).toBe("1.0.0");
    expect(() => new Date(list[0].occurredAt).toISOString()).not.toThrow();
  });

  it("collapses repeat events to one entry per kind", () => {
    const store = new ServerNoticesStore();
    store.recordDaemonAutoRestarted({
      serverProtocolVersion: "1.1.0",
      daemonProtocolVersion: "1.0.0",
    });
    store.recordDaemonAutoRestarted({
      serverProtocolVersion: "1.2.0",
      daemonProtocolVersion: "1.1.0",
    });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].serverProtocolVersion).toBe("1.2.0");
    expect(list[0].daemonProtocolVersion).toBe("1.1.0");
  });

  it("dismiss removes the notice and reports whether it existed", () => {
    const store = new ServerNoticesStore();
    expect(store.dismiss("daemon-auto-restarted")).toBe(false);
    store.recordDaemonAutoRestarted({});
    expect(store.has("daemon-auto-restarted")).toBe(true);
    expect(store.dismiss("daemon-auto-restarted")).toBe(true);
    expect(store.has("daemon-auto-restarted")).toBe(false);
    expect(store.list()).toEqual([]);
  });
});
