import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IpcServer } from "./socket-server.js";

describe("IpcServer", () => {
  let dir: string;
  let server: IpcServer;

  beforeEach(() => {
    dir = join(tmpdir(), `parasor-ipc-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(async () => {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts and creates socket and lock files", async () => {
    server = new IpcServer({ dir });
    await server.start();

    expect(existsSync(join(dir, "parasor.sock"))).toBe(true);
    expect(existsSync(join(dir, "parasor.lock"))).toBe(true);

    const lockContent = readFileSync(join(dir, "parasor.lock"), "utf-8");
    expect(lockContent).toMatch(/^pid=\d+$/);
  });

  it("handles open command via socket", async () => {
    let capturedUrl = "";
    server = new IpcServer({ dir });
    server.onCommand("open", (args) => {
      capturedUrl = args.url as string;
      return { ok: true };
    });
    await server.start();

    const response = await sendIpcRequest(join(dir, "parasor.sock"), {
      cmd: "open",
      args: { url: "http://localhost:3000", projectId: "proj-1" },
    });

    expect(response).toEqual({ ok: true });
    expect(capturedUrl).toBe("http://localhost:3000");
  });

  it("returns error for unknown commands", async () => {
    server = new IpcServer({ dir });
    await server.start();

    const response = await sendIpcRequest(join(dir, "parasor.sock"), {
      cmd: "unknown",
      args: {},
    });

    expect(response).toEqual({ ok: false, error: "unknown-command" });
  });

  it("cleans up stale socket on start", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "parasor.sock"), "stale");

    server = new IpcServer({ dir });
    await server.start();
    expect(existsSync(join(dir, "parasor.sock"))).toBe(true);
  });

  it("cleans up socket and lock on stop", async () => {
    server = new IpcServer({ dir });
    await server.start();
    await server.stop();

    expect(existsSync(join(dir, "parasor.sock"))).toBe(false);
  });

  it("rejects a second instance in the same dir with PARASOR_CONFIG_DIR hint", async () => {
    server = new IpcServer({ dir });
    await server.start();

    const other = new IpcServer({ dir });
    await expect(other.start()).rejects.toThrow(/parasor is already running/);
    await expect(other.start()).rejects.toThrow(/PARASOR_CONFIG_DIR/);
  });

  it("surfaces the holder's pid in the already-running error", async () => {
    server = new IpcServer({ dir });
    await server.start();

    const other = new IpcServer({ dir });
    await expect(other.start()).rejects.toThrow(
      new RegExp(`pid ${process.pid}`),
    );
  });

  it("surfaces socket-missing diagnostic when lock held but socket file absent", async () => {
    server = new IpcServer({ dir });
    await server.start();

    // Simulate a stale scenario: socket file gone, holder pid still alive.
    unlinkSync(join(dir, "parasor.sock"));

    const other = new IpcServer({ dir });
    await expect(other.start()).rejects.toThrow(
      /socket file missing.*pid \d+.*parasor restart/s,
    );
  });
});

function sendIpcRequest(
  socketPath: string,
  request: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      client.write(`${JSON.stringify(request)}\n`);
    });

    let data = "";
    client.on("data", (chunk) => {
      data += chunk;
    });
    client.on("end", () => {
      try {
        resolve(JSON.parse(data.trim()));
      } catch (e) {
        reject(e);
      }
    });
    client.on("error", reject);
    client.setTimeout(2000, () => {
      client.destroy(new Error("timeout"));
    });
  });
}
