import { type ChildProcess, spawn } from "node:child_process";

export interface CaffeinateControllerOptions {
  platform?: NodeJS.Platform;
  spawner?: (command: string, args: string[]) => ChildProcess;
  parentPid?: number;
}

/**
 * Keeps a `caffeinate -i` child alive while the server is configured to
 * prevent idle sleep AND at least one WS client is attached. No-op on
 * non-darwin hosts -- callers may construct unconditionally.
 *
 * Uses `caffeinate -w <parent-pid>` so the child self-terminates when the
 * parent process dies ungracefully (SIGKILL / crash). Without this binding
 * an orphaned caffeinate would keep the Mac awake indefinitely until the
 * user manually killed it.
 */
export class CaffeinateController {
  private readonly platform: NodeJS.Platform;
  private readonly spawner: (command: string, args: string[]) => ChildProcess;
  private readonly parentPid: number;
  private proc: ChildProcess | null = null;
  private enabled = false;
  private clientCount = 0;

  constructor(opts: CaffeinateControllerOptions = {}) {
    this.platform = opts.platform ?? process.platform;
    this.spawner =
      opts.spawner ??
      ((command, args) => spawn(command, args, { stdio: "ignore" }));
    this.parentPid = opts.parentPid ?? process.pid;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reconcile();
  }

  setClientCount(count: number): void {
    if (this.clientCount === count) return;
    this.clientCount = count;
    this.reconcile();
  }

  isRunning(): boolean {
    return this.proc !== null;
  }

  shutdown(): void {
    this.killProc();
  }

  private reconcile(): void {
    const shouldRun =
      this.platform === "darwin" && this.enabled && this.clientCount > 0;
    if (shouldRun && this.proc === null) {
      this.startProc();
    } else if (!shouldRun && this.proc !== null) {
      this.killProc();
    }
  }

  private startProc(): void {
    const proc = this.spawner("caffeinate", [
      "-i",
      "-w",
      String(this.parentPid),
    ]);
    this.proc = proc;
    proc.on("exit", () => {
      if (this.proc === proc) this.proc = null;
    });
  }

  private killProc(): void {
    if (this.proc !== null) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
