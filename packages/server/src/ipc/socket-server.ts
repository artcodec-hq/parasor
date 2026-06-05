import {
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { join } from "node:path";
import lockfile from "proper-lockfile";

const MAX_REQUEST_SIZE = 64 * 1024;
const READ_TIMEOUT = 2000;
const LOCK_STALE_MS = 5000;

interface IpcRequest {
  cmd: string;
  args: Record<string, unknown>;
}

interface IpcResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

type CommandHandler = (
  args: Record<string, unknown>,
) => IpcResponse | Promise<IpcResponse>;

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

export class IpcServer {
  private server: Server | null = null;
  private readonly socketPath: string;
  private readonly lockPath: string;
  private lockRelease: (() => Promise<void>) | null = null;
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(opts: { dir: string }) {
    this.socketPath = join(opts.dir, "parasor.sock");
    this.lockPath = join(opts.dir, "parasor.lock");
  }

  onCommand(cmd: string, handler: CommandHandler): void {
    this.handlers.set(cmd, handler);
  }

  async start(): Promise<void> {
    /*
     * proper-lockfile enforces exclusion via an atomically-created
     * `parasor.lock.lock` directory next to this file (mkdir is atomic on
     * POSIX/Win) and considers the lock stale once the directory's mtime
     * is older than LOCK_STALE_MS. That replaces the previous hand-rolled
     * PID-file check which had a TOCTOU race (pid could be recycled
     * between readFileSync and kill(pid,0)) and required SIGKILL
     * survivors to hand-delete the file.
     *
     * The file itself is kept as a human-readable diagnostic: on ELOCKED
     * we read the existing PID to include in the error message.
     */
    if (!existsSync(this.lockPath)) {
      writeFileSync(this.lockPath, "", { mode: 0o600 });
    }

    try {
      this.lockRelease = await lockfile.lock(this.lockPath, {
        stale: LOCK_STALE_MS,
        retries: 0,
        realpath: false,
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ELOCKED") {
        const holderPid = this.readHolderPid();
        const socketExists = existsSync(this.socketPath);
        const socketLive = socketExists
          ? await this.probeSocket(this.socketPath)
          : false;
        const pidAlive = holderPid ? isPidAlive(Number(holderPid)) : false;
        throw new Error(
          this.formatAlreadyRunningError({
            holderPid,
            socketLive,
            pidAlive,
          }),
        );
      }
      throw err;
    }

    writeFileSync(this.lockPath, `pid=${process.pid}`, { mode: 0o600 });

    if (existsSync(this.socketPath)) {
      const isLive = await this.probeSocket(this.socketPath);
      if (isLive) {
        await this.releaseLockSafely();
        throw new Error(
          "Another parasor listener is alive on the same socket.",
        );
      }
      try {
        unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }

    await new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));
      this.server.on("error", reject);
      this.server.listen(this.socketPath, () => {
        chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
    }

    try {
      unlinkSync(this.socketPath);
    } catch {
      /* ignore */
    }

    await this.releaseLockSafely();

    try {
      unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
  }

  private probeSocket(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const client = createConnection(path, () => {
        client.destroy();
        resolve(true);
      });
      client.on("error", () => resolve(false));
      client.setTimeout(250, () => {
        client.destroy();
        resolve(false);
      });
    });
  }

  private readHolderPid(): string | null {
    try {
      const content = readFileSync(this.lockPath, "utf-8").trim();
      const match = content.match(/^pid=(\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private formatAlreadyRunningError(info: {
    holderPid: string | null;
    socketLive: boolean;
    pidAlive: boolean;
  }): string {
    const who = info.holderPid ? ` (pid ${info.holderPid})` : "";
    const lockHint = `${this.lockPath}.lock`;

    if (info.socketLive) {
      return `parasor is already running${who}. Stop it first, or set PARASOR_CONFIG_DIR to a different directory to run a separate instance.`;
    }
    if (info.pidAlive && info.holderPid) {
      return `parasor socket file missing or unresponsive, but pid ${info.holderPid} is alive. Run \`parasor restart\` (or \`parasor service restart\` if installed as a service) to recover.`;
    }
    return `parasor lock held but no live holder. Wait a few seconds and retry, or remove ${lockHint}.`;
  }

  private async releaseLockSafely(): Promise<void> {
    if (!this.lockRelease) return;
    const release = this.lockRelease;
    this.lockRelease = null;
    try {
      await release();
    } catch {
      /* already released or lock broken -- nothing we can do */
    }
  }

  private handleConnection(socket: Socket): void {
    let data = "";

    socket.setTimeout(READ_TIMEOUT, () => {
      socket.destroy();
    });

    socket.on("data", (chunk) => {
      data += chunk.toString();

      if (data.length > MAX_REQUEST_SIZE) {
        this.respond(socket, { ok: false, error: "request-too-large" });
        return;
      }

      const newlineIdx = data.indexOf("\n");
      if (newlineIdx === -1) return;

      const line = data.slice(0, newlineIdx);
      void this.processRequest(socket, line);
    });
  }

  private async processRequest(socket: Socket, line: string): Promise<void> {
    let request: IpcRequest;
    try {
      request = JSON.parse(line) as IpcRequest;
    } catch {
      this.respond(socket, { ok: false, error: "invalid-json" });
      return;
    }

    const handler = this.handlers.get(request.cmd);
    if (!handler) {
      this.respond(socket, { ok: false, error: "unknown-command" });
      return;
    }

    try {
      const response = await handler(request.args ?? {});
      this.respond(socket, response);
    } catch (err) {
      this.respond(socket, { ok: false, error: String(err) });
    }
  }

  private respond(socket: Socket, response: IpcResponse): void {
    socket.end(`${JSON.stringify(response)}\n`);
  }
}
