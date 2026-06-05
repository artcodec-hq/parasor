import { spawnSync } from "node:child_process";

/*
 * Thin wrapper around systemd's sd_notify protocol. The protocol writes
 * newline-separated `KEY=VALUE` lines to an AF_UNIX DGRAM socket at
 * $NOTIFY_SOCKET. Node lacks native AF_UNIX DGRAM support, so we shell out
 * to the `systemd-notify` CLI (guaranteed to exist on systemd hosts -- it
 * ships as part of the systemd package).
 *
 * On non-systemd hosts (darwin, BSD, minimal containers without systemd)
 * $NOTIFY_SOCKET is never set, so every call short-circuits to a no-op and
 * no child process is spawned.
 */

type SpawnFn = (cmd: string, args: string[]) => void;

export interface SdNotifyDeps {
  spawn?: SpawnFn;
}

const defaultSpawn: SpawnFn = (cmd, args) => {
  spawnSync(cmd, args, { stdio: "ignore" });
};

function notify(payload: string, deps?: SdNotifyDeps): void {
  if (!process.env.NOTIFY_SOCKET) return;
  const spawn = deps?.spawn ?? defaultSpawn;
  try {
    spawn("systemd-notify", [payload]);
  } catch {
    /*
     * systemd-notify missing (e.g. NOTIFY_SOCKET leaked from an unusual env
     * without systemd installed) must not crash the server -- the watchdog
     * will still fire via systemd's own timeout and the operator will see
     * the restart in journalctl.
     */
  }
}

export function notifyReady(deps?: SdNotifyDeps): void {
  notify("READY=1", deps);
}

export function notifyWatchdog(deps?: SdNotifyDeps): void {
  notify("WATCHDOG=1", deps);
}
