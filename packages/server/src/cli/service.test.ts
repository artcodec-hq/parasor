import { describe, expect, it, vi } from "vitest";
import {
  cliService,
  resolveBinPath,
  resolveDaemonEntryPath,
} from "./service.js";

/*
 * The service entry is a thin router: parse subcommand -> detect platform ->
 * dispatch to a platform adapter. Platform adapters are tested separately
 * (service-darwin.test.ts / service-linux.test.ts); here we only verify
 * the dispatch surface.
 *
 * Install is the SINGLE canonical path. There
 * is no `--with-daemon` flag -- install always provisions both server and
 * daemon units. Adapter methods take no options other than `logs(follow)`.
 */
describe("cliService", () => {
  function makeAdapter() {
    return {
      install: vi.fn().mockResolvedValue(undefined),
      uninstall: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue(undefined),
      restart: vi.fn().mockResolvedValue(undefined),
      logs: vi.fn().mockResolvedValue(undefined),
    };
  }

  /**
   * restart confirmation -- restart now probes the daemon socket before delegating to the
   * adapter. Tests that exercise the dispatch surface inject a stub so we
   * never touch a real Unix socket.
   */
  const proceedStub = async () => ({
    proceed: true,
    reason: "test stub",
  });

  it("dispatches 'install' to the platform adapter (no options)", async () => {
    const adapter = makeAdapter();
    await cliService(["install"], { platform: "darwin", adapter });
    expect(adapter.install).toHaveBeenCalledWith();
    expect(adapter.install).toHaveBeenCalledTimes(1);
  });

  it("dispatches 'uninstall'", async () => {
    const adapter = makeAdapter();
    await cliService(["uninstall"], { platform: "darwin", adapter });
    expect(adapter.uninstall).toHaveBeenCalledWith();
  });

  it("dispatches 'status'", async () => {
    const adapter = makeAdapter();
    await cliService(["status"], { platform: "darwin", adapter });
    expect(adapter.status).toHaveBeenCalledWith();
  });

  it("dispatches 'restart' with default scope (server only)", async () => {
    const adapter = makeAdapter();
    await cliService(["restart"], {
      platform: "darwin",
      adapter,
      confirmRestart: proceedStub,
    });
    expect(adapter.restart).toHaveBeenCalledWith({ all: false });
  });

  it("dispatches 'restart --all' to also kick the daemon", async () => {
    const adapter = makeAdapter();
    await cliService(["restart", "--all"], {
      platform: "darwin",
      adapter,
      confirmRestart: proceedStub,
    });
    expect(adapter.restart).toHaveBeenCalledWith({ all: true });
  });

  it("dispatches 'restart --yes' and forwards autoYes via the confirm hook", async () => {
    const adapter = makeAdapter();
    const confirmRestart = vi.fn(async () => ({
      proceed: true,
      reason: "test stub",
    }));
    await cliService(["restart", "--yes"], {
      platform: "darwin",
      adapter,
      confirmRestart,
    });
    expect(confirmRestart).toHaveBeenCalledWith({ autoYes: true });
    expect(adapter.restart).toHaveBeenCalledWith({ all: false });
  });

  it("aborts restart and skips the adapter when the confirm hook declines", async () => {
    const adapter = makeAdapter();
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      await cliService(["restart"], {
        platform: "darwin",
        adapter,
        confirmRestart: async () => ({
          proceed: false,
          reason: "user declined",
        }),
      });
      expect(adapter.restart).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it("strips --yes from the flags before computing --all", async () => {
    const adapter = makeAdapter();
    await cliService(["restart", "--yes", "--all"], {
      platform: "darwin",
      adapter,
      confirmRestart: proceedStub,
    });
    expect(adapter.restart).toHaveBeenCalledWith({ all: true });
  });

  it("dispatches 'logs' with follow flag", async () => {
    const adapter = makeAdapter();
    await cliService(["logs", "-f"], { platform: "linux", adapter });
    expect(adapter.logs).toHaveBeenCalledWith({ follow: true });
  });

  it("dispatches 'logs' without follow when -f missing", async () => {
    const adapter = makeAdapter();
    await cliService(["logs"], { platform: "linux", adapter });
    expect(adapter.logs).toHaveBeenCalledWith({ follow: false });
  });

  it("prints help for --help and returns without dispatching", async () => {
    const adapter = makeAdapter();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cliService(["--help"], { platform: "darwin", adapter });
      expect(adapter.install).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("refuses unsupported platforms with a clear error", async () => {
    const adapter = makeAdapter();
    await expect(
      cliService(["install"], { platform: "win32", adapter }),
    ).rejects.toThrow(/macOS and Linux/);
  });

  it("refuses unknown subcommands with a clear error", async () => {
    const adapter = makeAdapter();
    await expect(
      cliService(["teleport"], { platform: "darwin", adapter }),
    ).rejects.toThrow(/unknown/i);
  });

  it("prints help when no subcommand is given", async () => {
    const adapter = makeAdapter();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cliService([], { platform: "darwin", adapter });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("resolveBinPath", () => {
  it("returns the absolute realpath of process.argv[1]", () => {
    const p = resolveBinPath();
    expect(p).toMatch(/^\//); // POSIX absolute
    expect(p).not.toContain(".."); // realpath normalizes
  });
});

describe("resolveDaemonEntryPath", () => {
  it("ends with pty/host-daemon/entry.{js,ts}", () => {
    const p = resolveDaemonEntryPath();
    expect(p).toMatch(/pty\/host-daemon\/entry\.(js|ts)$/);
  });
});
