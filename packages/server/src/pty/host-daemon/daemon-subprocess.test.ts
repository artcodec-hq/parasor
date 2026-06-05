/*
 * -- best-effort subprocess integration.
 *
 * This test forks the real `parasor-pty-host` entry script via
 * `child_process.spawn` and verifies the daemon boots, writes its pid
 * file, and shuts down cleanly on SIGTERM. It is gated behind a
 * platform/CI guard because:
 *   - macOS sandbox-exec blocks AF_UNIX bind() and (sometimes) the
 *     `child_process.spawn` of node -- the test would hang or crash.
 *   - CI may not have a writable XDG_RUNTIME_DIR. We use PARASOR_PTY_SOCK
 *     to point at a temp dir, but the test still requires loosened
 *     sandbox.
 *
 * Run locally with: `pnpm --filter @parasor/server test src/pty/host-daemon/daemon-subprocess.test.ts`
 * (with sandbox disabled). Skipped under sandbox / CI.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Heuristic: sandbox-exec sets a few env vars that real shells don't,
// and CI sets CI=true. Skip in either case.
/*
 * -- claude-code's bash tool runs under
 * sandbox-exec which blocks AF_UNIX bind() but leaves SANDBOX_EXEC
 * unset. CLAUDECODE / SANDBOX_RUNTIME are the env vars that actually
 * mark the sandboxed shell. Add them so the test cleanly skips here
 * (it now runs under raw `node --import tsx` and would otherwise fail
 * mid-listen).
 */
const IN_SANDBOX =
  !!process.env.SANDBOX_EXEC ||
  !!process.env.SANDBOX_RUNTIME ||
  !!process.env.CLAUDECODE ||
  !!process.env.CI;

/*
 * -- the previous guard required
 * dist/pty/host-daemon/entry.js AND a compiled shared/src/client.js,
 * both of which only exist after `pnpm build`. The test therefore
 * always skipped under vitest+tsx (the dev/test runtime). Switch to
 * invoking the TypeScript source directly via `node --import tsx
 * entry.ts`. tsx resolves the cross-workspace ESM imports
 * (@parasor/shared) the same way the rest of the test suite does, so
 * we no longer require a pre-built dist/. Only the sandbox guard
 * remains.
 */
const here = dirname(fileURLToPath(import.meta.url));
const entryTs = resolve(here, "entry.ts");
const SKIP = IN_SANDBOX || !existsSync(entryTs);

describe.skipIf(SKIP)("parasor-pty-host subprocess (best-effort)", () => {
  let root: string;
  let socketPath: string;
  let pidFile: string;
  let child: ChildProcess | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "daemon-subprocess-"));
    mkdirSync(join(root, "config"), { recursive: true });
    socketPath = join(root, "p.sock");
    pidFile = `${socketPath}.pid`;
    child = null;
  });

  afterEach(async () => {
    // `child.killed` becomes true the moment a signal
    // is sent -- it does NOT reflect actual exit. Use `child.exitCode`
    // (number once exited, null while alive) so SIGKILL escalation
    // actually fires when SIGTERM was ignored. Otherwise a hung
    // subprocess silently leaks across tests.
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("boots, writes pidfile, accepts a connection, exits cleanly on SIGTERM", async () => {
    child = spawn(process.execPath, ["--import", "tsx", entryTs], {
      env: {
        ...process.env,
        PARASOR_CONFIG_DIR: join(root, "config"),
        PARASOR_PTY_SOCK: socketPath,
        PARASOR_PTY_HOST_DEBUG: "1",
      },
      stdio: "ignore",
    });
    const runningChild = child;

    // Wait for socket to come up, max 5s.
    const deadline = Date.now() + 5_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (existsSync(socketPath)) {
        // Try to actually connect.
        const ok = await new Promise<boolean>((resolve) => {
          const s = net.connect(socketPath);
          s.once("connect", () => {
            s.destroy();
            resolve(true);
          });
          s.once("error", () => {
            s.destroy();
            resolve(false);
          });
          s.setTimeout(250, () => {
            s.destroy();
            resolve(false);
          });
        });
        if (ok) {
          ready = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isFinite(pid)).toBe(true);
    expect(pid).toBe(runningChild.pid);

    // SIGTERM and wait for exit.
    runningChild.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => {
      runningChild.once("exit", (code) => resolve(code));
    });
    expect(exitCode).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
  }, 10_000);
});
