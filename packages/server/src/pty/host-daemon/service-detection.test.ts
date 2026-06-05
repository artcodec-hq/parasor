import { describe, expect, it, vi } from "vitest";
import { isServiceManagedDaemonInstalled } from "./service-detection.js";

describe("isServiceManagedDaemonInstalled", () => {
  it("returns true on darwin when the LaunchAgent plist exists", () => {
    const existsSync = vi.fn(
      (p: string) =>
        p === "/Users/u/Library/LaunchAgents/com.parasor.pty-host.plist",
    );
    expect(
      isServiceManagedDaemonInstalled({
        platform: "darwin",
        home: "/Users/u",
        existsSync,
      }),
    ).toBe(true);
  });

  it("returns false on darwin when the plist is missing", () => {
    expect(
      isServiceManagedDaemonInstalled({
        platform: "darwin",
        home: "/Users/u",
        existsSync: () => false,
      }),
    ).toBe(false);
  });

  it("returns true on linux when the systemd user unit exists", () => {
    const existsSync = vi.fn(
      (p: string) =>
        p === "/home/u/.config/systemd/user/parasor-pty-host.service",
    );
    expect(
      isServiceManagedDaemonInstalled({
        platform: "linux",
        home: "/home/u",
        existsSync,
      }),
    ).toBe(true);
  });

  it("returns false on linux when the unit file is missing", () => {
    expect(
      isServiceManagedDaemonInstalled({
        platform: "linux",
        home: "/home/u",
        existsSync: () => false,
      }),
    ).toBe(false);
  });

  it("returns false on unsupported platforms regardless of files", () => {
    expect(
      isServiceManagedDaemonInstalled({
        platform: "win32",
        home: "C:\\Users\\u",
        existsSync: () => true,
      }),
    ).toBe(false);
  });
});
