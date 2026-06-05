import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  connectToDaemonSocket,
  decideAutoSpawn,
  formatNoDaemonError,
} from "./daemon-connect.js";

describe("decideAutoSpawn", () => {
  it("marks ECONNREFUSED as noDaemon", () => {
    const out = decideAutoSpawn({
      code: "ECONNREFUSED",
      explicit: undefined,
      serviceInstalled: false,
    });
    expect(out.noDaemon).toBe(true);
  });

  it("marks ENOENT as noDaemon", () => {
    const out = decideAutoSpawn({
      code: "ENOENT",
      explicit: undefined,
      serviceInstalled: false,
    });
    expect(out.noDaemon).toBe(true);
  });

  it("does not mark EACCES (or any other code) as noDaemon", () => {
    const out = decideAutoSpawn({
      code: "EACCES",
      explicit: undefined,
      serviceInstalled: false,
    });
    expect(out.noDaemon).toBe(false);
    const undef = decideAutoSpawn({
      code: undefined,
      explicit: undefined,
      serviceInstalled: false,
    });
    expect(undef.noDaemon).toBe(false);
  });

  it("explicit '1' forces autoStart=true even when service is installed", () => {
    const out = decideAutoSpawn({
      code: "ECONNREFUSED",
      explicit: "1",
      serviceInstalled: true,
    });
    expect(out.autoStart).toBe(true);
  });

  it("explicit '0' forces autoStart=false even when no service is installed", () => {
    const out = decideAutoSpawn({
      code: "ECONNREFUSED",
      explicit: "0",
      serviceInstalled: false,
    });
    expect(out.autoStart).toBe(false);
  });

  it("default (no explicit) is OFF when serviceInstalled=true", () => {
    const out = decideAutoSpawn({
      code: "ECONNREFUSED",
      explicit: undefined,
      serviceInstalled: true,
    });
    expect(out.autoStart).toBe(false);
  });

  it("default (no explicit) is ON when serviceInstalled=false", () => {
    const out = decideAutoSpawn({
      code: "ECONNREFUSED",
      explicit: undefined,
      serviceInstalled: false,
    });
    expect(out.autoStart).toBe(true);
  });

  it("treats explicit values other than '1'/'0' as default (e.g. 'true' is NOT honoured)", () => {
    /*
     * The host.ts inline checked the literal strings "1" / "0" only --
     * preserved here so an ops sed-replace of `PARASOR_PTY_AUTOSTART=true`
     * keeps falling back to the install-aware default instead of silently
     * flipping behaviour.
     */
    const out = decideAutoSpawn({
      code: "ECONNREFUSED",
      explicit: "true",
      serviceInstalled: true,
    });
    expect(out.autoStart).toBe(false);
  });
});

describe("formatNoDaemonError", () => {
  const err = new Error("connect ENOENT /tmp/socket");
  const socketPath = "/tmp/socket";

  it("noDaemon + serviceInstalled -> service-managed guidance branch", () => {
    const msg = formatNoDaemonError({
      err,
      socketPath,
      noDaemon: true,
      serviceInstalled: true,
    });
    expect(msg).toBe(
      "parasor-pty-host: cannot connect to /tmp/socket: connect ENOENT /tmp/socket. " +
        "A service-managed daemon is installed but not reachable. " +
        "Run `parasor service restart --all` to bring it back up, " +
        "or set PARASOR_PTY_AUTOSTART=1 to override (not recommended -- " +
        "bypasses the service manager and risks split-brain).",
    );
  });

  it("noDaemon + !serviceInstalled -> casual install guidance branch", () => {
    const msg = formatNoDaemonError({
      err,
      socketPath,
      noDaemon: true,
      serviceInstalled: false,
    });
    expect(msg).toBe(
      "parasor-pty-host: cannot connect to /tmp/socket: connect ENOENT /tmp/socket. " +
        "Set PARASOR_PTY_AUTOSTART=1 (default) or start the daemon " +
        "(`parasor-pty-host` entry script). " +
        "Set PARASOR_PTY_DAEMON=0 to fall back to in-process mode.",
    );
  });

  it("!noDaemon -> unhealthy-socket branch (serviceInstalled does not matter)", () => {
    const withService = formatNoDaemonError({
      err,
      socketPath,
      noDaemon: false,
      serviceInstalled: true,
    });
    const withoutService = formatNoDaemonError({
      err,
      socketPath,
      noDaemon: false,
      serviceInstalled: false,
    });
    const expected =
      "parasor-pty-host: cannot connect to /tmp/socket: connect ENOENT /tmp/socket. " +
      "Daemon socket is unhealthy; check the daemon log.";
    expect(withService).toBe(expected);
    expect(withoutService).toBe(expected);
  });

  it("interpolates err.message and socketPath verbatim", () => {
    const msg = formatNoDaemonError({
      err: new Error("transient io spike"),
      socketPath: "/var/run/foo.sock",
      noDaemon: false,
      serviceInstalled: false,
    });
    expect(msg).toContain("/var/run/foo.sock");
    expect(msg).toContain("transient io spike");
  });
});

describe("connectToDaemonSocket", () => {
  it("rejects with ENOENT for a non-existent socket path", async () => {
    /*
     * Sandbox limit: AF_UNIX `listen()` is blocked, so we cannot stand up
     * a real Unix-domain server here to test the resolve path. The
     * production resolve path is exercised transitively by host-contract
     * / pty-host-restart / daemon integration tests. The reject branch
     * (and the typed errno code) is the load-bearing observable behaviour
     * this helper feeds into `decideAutoSpawn`, so we cover that.
     */
    const missing = join("/tmp", `parasor-no-sock-${process.pid}.sock`);
    await expect(connectToDaemonSocket(missing)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
