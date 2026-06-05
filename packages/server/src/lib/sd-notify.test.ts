import { describe, expect, it, vi } from "vitest";
import { notifyReady, notifyWatchdog } from "./sd-notify.js";

/*
 * sd-notify writes to NOTIFY_SOCKET via `systemd-notify`. node has no native
 * AF_UNIX-DGRAM support, so we shell out to the systemd-provided CLI which is
 * always present on systemd hosts. When NOTIFY_SOCKET is unset the module is
 * a no-op -- the non-systemd path is what we unit-test here (actual socket
 * round-trip is validated on Linux during manual Linux checks).
 */
describe("sd-notify", () => {
  it("is a no-op when NOTIFY_SOCKET is unset", () => {
    const prior = process.env.NOTIFY_SOCKET;
    delete process.env.NOTIFY_SOCKET;
    const spy = vi.fn();
    try {
      notifyReady({ spawn: spy });
      notifyWatchdog({ spawn: spy });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      if (prior !== undefined) process.env.NOTIFY_SOCKET = prior;
    }
  });

  it("invokes systemd-notify with READY=1 when NOTIFY_SOCKET is set", () => {
    const prior = process.env.NOTIFY_SOCKET;
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    const spy = vi.fn();
    try {
      notifyReady({ spawn: spy });
      expect(spy).toHaveBeenCalledWith("systemd-notify", ["READY=1"]);
    } finally {
      if (prior !== undefined) process.env.NOTIFY_SOCKET = prior;
      else delete process.env.NOTIFY_SOCKET;
    }
  });

  it("invokes systemd-notify with WATCHDOG=1 when NOTIFY_SOCKET is set", () => {
    const prior = process.env.NOTIFY_SOCKET;
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    const spy = vi.fn();
    try {
      notifyWatchdog({ spawn: spy });
      expect(spy).toHaveBeenCalledWith("systemd-notify", ["WATCHDOG=1"]);
    } finally {
      if (prior !== undefined) process.env.NOTIFY_SOCKET = prior;
      else delete process.env.NOTIFY_SOCKET;
    }
  });

  it("swallows spawn errors (systemd-notify missing is survivable)", () => {
    const prior = process.env.NOTIFY_SOCKET;
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    const spy = vi.fn(() => {
      throw new Error("ENOENT");
    });
    try {
      expect(() => notifyReady({ spawn: spy })).not.toThrow();
    } finally {
      if (prior !== undefined) process.env.NOTIFY_SOCKET = prior;
      else delete process.env.NOTIFY_SOCKET;
    }
  });
});
