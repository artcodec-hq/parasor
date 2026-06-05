import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRuntimeDir, resolveDaemonPaths } from "./paths.js";

describe("resolveDaemonPaths", () => {
  it("honors PARASOR_PTY_SOCK override and derives sibling files from it", () => {
    const paths = resolveDaemonPaths({
      PARASOR_PTY_SOCK: "/tmp/test/x.sock",
    } as NodeJS.ProcessEnv);
    expect(paths.runtimeDir).toBe("/tmp/test");
    expect(paths.socketPath).toBe("/tmp/test/x.sock");
    expect(paths.pidFile).toBe("/tmp/test/x.sock.pid");
    expect(paths.lockFile).toBe("/tmp/test/x.sock.lock");
    expect(paths.logFile).toBe("/tmp/test/x.sock.log");
  });

  it("uses XDG_RUNTIME_DIR/parasor when set without override", () => {
    const paths = resolveDaemonPaths({
      XDG_RUNTIME_DIR: "/run/user/1000",
    } as NodeJS.ProcessEnv);
    expect(paths.runtimeDir).toBe("/run/user/1000/parasor");
    expect(paths.socketPath).toBe("/run/user/1000/parasor/parasor-pty.sock");
    expect(paths.pidFile).toBe("/run/user/1000/parasor/parasor-pty.pid");
    expect(paths.lockFile).toBe("/run/user/1000/parasor/parasor-pty.lock");
  });

  it("falls back to ~/.parasor/run when neither env is set", () => {
    const paths = resolveDaemonPaths({} as NodeJS.ProcessEnv);
    expect(paths.runtimeDir.endsWith("/.parasor/run")).toBe(true);
    expect(paths.socketPath.endsWith("/.parasor/run/parasor-pty.sock")).toBe(
      true,
    );
  });

  it("ignores empty-string env values", () => {
    const paths = resolveDaemonPaths({
      PARASOR_PTY_SOCK: "",
      XDG_RUNTIME_DIR: "",
    } as NodeJS.ProcessEnv);
    expect(paths.runtimeDir.endsWith("/.parasor/run")).toBe(true);
  });
});

describe("resolveDaemonPaths -- per-PID socket (PARASOR_PTY_SOCK_PER_PID=1, R5)", () => {
  it("appends -<pid> suffix to all canonical basenames when PER_PID=1", () => {
    const paths = resolveDaemonPaths(
      {
        XDG_RUNTIME_DIR: "/run/user/1000",
        PARASOR_PTY_SOCK_PER_PID: "1",
      } as NodeJS.ProcessEnv,
      99999,
    );
    expect(paths.socketPath).toBe(
      "/run/user/1000/parasor/parasor-pty-99999.sock",
    );
    expect(paths.pidFile).toBe("/run/user/1000/parasor/parasor-pty-99999.pid");
    expect(paths.lockFile).toBe(
      "/run/user/1000/parasor/parasor-pty-99999.lock",
    );
    expect(paths.logFile).toBe("/run/user/1000/parasor/parasor-pty-99999.log");
    expect(paths.runtimeDir).toBe("/run/user/1000/parasor");
  });

  it("applies PER_PID suffix with fallback runtimeDir (~/.parasor/run)", () => {
    const paths = resolveDaemonPaths(
      { PARASOR_PTY_SOCK_PER_PID: "1" } as NodeJS.ProcessEnv,
      12345,
    );
    expect(paths.socketPath.endsWith("/parasor-pty-12345.sock")).toBe(true);
    expect(paths.lockFile.endsWith("/parasor-pty-12345.lock")).toBe(true);
    expect(paths.logFile.endsWith("/parasor-pty-12345.log")).toBe(true);
  });

  it("PARASOR_PTY_SOCK override beats PER_PID -- override wins, no suffix", () => {
    const paths = resolveDaemonPaths(
      {
        PARASOR_PTY_SOCK: "/tmp/override.sock",
        PARASOR_PTY_SOCK_PER_PID: "1",
      } as NodeJS.ProcessEnv,
      42,
    );
    expect(paths.socketPath).toBe("/tmp/override.sock");
    expect(paths.lockFile).toBe("/tmp/override.sock.lock");
  });

  it("ignores PER_PID when value is not '1'", () => {
    const paths = resolveDaemonPaths(
      {
        XDG_RUNTIME_DIR: "/run/user/1000",
        PARASOR_PTY_SOCK_PER_PID: "0",
      } as NodeJS.ProcessEnv,
      55555,
    );
    expect(paths.socketPath).toBe("/run/user/1000/parasor/parasor-pty.sock");
  });

  it("uses process.pid by default when pid arg is omitted", () => {
    const paths = resolveDaemonPaths({
      XDG_RUNTIME_DIR: "/run/user/1000",
      PARASOR_PTY_SOCK_PER_PID: "1",
    } as NodeJS.ProcessEnv);
    expect(paths.socketPath).toBe(
      `/run/user/1000/parasor/parasor-pty-${process.pid}.sock`,
    );
  });
});

describe("ensureRuntimeDir", () => {
  it("creates the directory recursively with mode 0700", () => {
    const root = mkdtempSync(join(tmpdir(), "paths-ensure-"));
    try {
      const target = join(root, "deep", "nested", "runtime");
      ensureRuntimeDir(target);
      expect(existsSync(target)).toBe(true);
      const mode = statSync(target).mode & 0o777;
      expect(mode).toBe(0o700);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent -- calling twice on an existing dir is a no-op", () => {
    const root = mkdtempSync(join(tmpdir(), "paths-ensure-"));
    try {
      const target = join(root, "runtime");
      ensureRuntimeDir(target);
      expect(() => ensureRuntimeDir(target)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
