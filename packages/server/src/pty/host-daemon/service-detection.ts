import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Returns true when a service-managed PTY-host unit is installed for the
 * current user -- `~/Library/LaunchAgents/com.parasor.pty-host.plist` on
 * macOS, `~/.config/systemd/user/parasor-pty-host.service` on linux.
 *
 * Filesystem-only: presence of the unit file is the "this machine has a
 * canonical daemon owner" signal. We deliberately do NOT probe whether
 * the unit is loaded or running -- a stopped service is still the
 * canonical owner, and a manual `parasor` invocation must defer to it
 * rather than spawn a competing daemon and fight over the canonical
 * socket. `service restart --all` is the user's lever to bring it back.
 *
 * Used by host.ts to flip the `PARASOR_PTY_AUTOSTART` default off when
 * a service unit exists; this prevents the unmanaged-daemon
 * inconsistency that `service install` and `service restart --all`
 * exist to heal.
 */
export interface ServiceDetectionDeps {
  platform?: NodeJS.Platform;
  home?: string;
  existsSync?: (path: string) => boolean;
}

export function isServiceManagedDaemonInstalled(
  deps: ServiceDetectionDeps = {},
): boolean {
  const p = deps.platform ?? platform();
  const h = deps.home ?? homedir();
  const exists = deps.existsSync ?? existsSync;
  if (p === "darwin") {
    return exists(
      join(h, "Library", "LaunchAgents", "com.parasor.pty-host.plist"),
    );
  }
  if (p === "linux") {
    return exists(
      join(h, ".config", "systemd", "user", "parasor-pty-host.service"),
    );
  }
  return false;
}
