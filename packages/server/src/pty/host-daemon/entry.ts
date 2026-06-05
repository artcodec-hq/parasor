#!/usr/bin/env node
/*
 * -- `parasor-pty-host` CLI entry point.
 *
 * Boots a daemon, runs until SIGTERM/SIGINT, exits 0 on graceful stop or
 * non-zero on bootstrap failure. No subcommands yet; this entry is what
 * lifecycle commands invoke under the hood (or what a launchd/systemd unit
 * wraps directly).
 *
 * Logging: opt-in via `PARASOR_PTY_HOST_DEBUG=1`. Default is silent so
 * background-spawned daemons don't pollute the terminal that started
 * them.
 */

import { appendFileSync } from "node:fs";
import { UploadStaging } from "../../fs/upload-staging.js";
import { bootstrapDaemon } from "./bootstrap.js";
import { DaemonAlreadyRunningError } from "./lockfile.js";
import { resolveDaemonPaths } from "./paths.js";

async function main(): Promise<void> {
  const paths = resolveDaemonPaths();
  const debug = process.env.PARASOR_PTY_HOST_DEBUG === "1";

  const log = (line: string): void => {
    const stamped = `${new Date().toISOString()} [pty-host] ${line}\n`;
    try {
      appendFileSync(paths.logFile, stamped);
    } catch {
      /* log file write best-effort */
    }
    if (debug) process.stderr.write(stamped);
  };

  try {
    /*
     * Upload staging isolation  -- daemon-side per-session env injection.
     * The daemon is its own process so it cannot share the server's
     * `UploadStaging` instance; we instantiate one here purely for the
     * canonical `uploadsDir` path. The constructor's symlink/owner
     * guards run again as a defence-in-depth check (cheap idempotent
     * mkdir + lstat). The L3 sweep stays in the server process -- the
     * daemon never ticks `sweepStale` to avoid duplicate work, but it
     * does need the canonical path so `InProcessPtyHost.buildSessionEnv`
     * can stamp `PARASOR_UPLOAD_DIR=<dir>/<sid>` on every spawned PTY.
     */
    const uploadStaging = new UploadStaging({});
    const running = await bootstrapDaemon({
      paths,
      log,
      uploadsDir: uploadStaging.uploadsDir,
    });
    log(`pid=${process.pid} ready socket=${running.paths.socketPath}`);
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      //  R4 -- when foreground bootstrap collides with an
      // installed daemon the bare error doesn't tell the user *why* their
      // socket is busy or how to coexist. Emit an explicit hint pointing
      // at `parasor service status` (verifies installed daemon ownership)
      // and the per-PID opt-in (`PARASOR_PTY_SOCK_PER_PID=1`) which gives
      // the foreground process its own socket basename.
      process.stderr.write(`${err.message}\n`);
      process.stderr.write(
        "\nThe installed parasor service may own this socket. Try:\n",
      );
      process.stderr.write(
        "  parasor service status         # check installed service state\n",
      );
      process.stderr.write(
        "  PARASOR_PTY_SOCK_PER_PID=1 parasor server   # foreground daemon on a per-PID socket\n",
      );
      process.exit(2);
    }
    process.stderr.write(
      `parasor-pty-host fatal: ${(err as Error).stack ?? err}\n`,
    );
    process.exit(1);
  }
}

void main();
