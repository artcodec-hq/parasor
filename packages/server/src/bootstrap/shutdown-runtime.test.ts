import { describe, expect, it, vi } from "vitest";
import {
  createShutdownHandler,
  registerShutdownSignals,
} from "./shutdown-runtime.js";

describe("createShutdownHandler", () => {
  it("in-process mode flushes twice (pre-detach + post-shutdownAll endReasons)", async () => {
    const calls: string[] = [];
    const shutdown = createShutdownHandler({
      appStateStore: {
        async flush() {
          calls.push("flush");
        },
        isSessionsReadOnly() {
          return false;
        },
      },
      configDir: "/tmp/cfg",
      ipcServer: {
        async stop() {
          calls.push("ipc-stop");
        },
      },
      processExit(code) {
        calls.push(`exit:${code}`);
      },
      projectRuntime: {
        async dispose() {
          calls.push("runtime-dispose");
        },
      },
      ptyManager: {
        async shutdownAll() {
          calls.push("pty-shutdown");
        },
      },
      removeRuntime(runtimeFile) {
        calls.push(`remove:${runtimeFile}`);
      },
      runtimeFile: "/tmp/runtime.json",
      runtimeLoops: {
        stop() {
          calls.push("loops-stop");
        },
      },
      writeMarker(dir) {
        calls.push(`marker:${dir}`);
      },
    });

    await shutdown();

    expect(calls).toEqual([
      "loops-stop",
      "runtime-dispose",
      "flush",
      "pty-shutdown",
      "flush",
      "marker:/tmp/cfg",
      "ipc-stop",
      "remove:/tmp/runtime.json",
      "exit:0",
    ]);
  });

  it("remote mode skips post-shutdownAll flush (daemon state ownership -- daemon owns sessions, delegate dead post-detach)", async () => {
    const calls: string[] = [];
    const shutdown = createShutdownHandler({
      appStateStore: {
        async flush() {
          calls.push("flush");
        },
        isSessionsReadOnly() {
          return true;
        },
      },
      configDir: "/tmp/cfg",
      ipcServer: {
        async stop() {
          calls.push("ipc-stop");
        },
      },
      processExit(code) {
        calls.push(`exit:${code}`);
      },
      projectRuntime: {
        async dispose() {
          calls.push("runtime-dispose");
        },
      },
      ptyManager: {
        async shutdownAll() {
          calls.push("pty-shutdown");
        },
      },
      removeRuntime(runtimeFile) {
        calls.push(`remove:${runtimeFile}`);
      },
      runtimeFile: "/tmp/runtime.json",
      runtimeLoops: {
        stop() {
          calls.push("loops-stop");
        },
      },
      writeMarker(dir) {
        calls.push(`marker:${dir}`);
      },
    });

    await shutdown();

    // Only ONE flush -- pre-shutdownAll. Post-shutdownAll flush is
    // skipped because session-domain is daemon-owned in remote mode.
    expect(calls).toEqual([
      "loops-stop",
      "runtime-dispose",
      "flush",
      "pty-shutdown",
      "marker:/tmp/cfg",
      "ipc-stop",
      "remove:/tmp/runtime.json",
      "exit:0",
    ]);
  });

  it("in-process mode propagates post-shutdownAll flush failure (stale state.json must not pair with graceful marker)", async () => {
    let flushCallCount = 0;
    const calls: string[] = [];
    const shutdown = createShutdownHandler({
      appStateStore: {
        async flush() {
          flushCallCount += 1;
          calls.push(`flush:${flushCallCount}`);
          if (flushCallCount === 2) {
            throw new Error("disk-full");
          }
        },
        isSessionsReadOnly() {
          return false;
        },
      },
      configDir: "/tmp/cfg",
      ipcServer: {
        async stop() {
          calls.push("ipc-stop");
        },
      },
      processExit(code) {
        calls.push(`exit:${code}`);
      },
      projectRuntime: {
        async dispose() {
          calls.push("runtime-dispose");
        },
      },
      ptyManager: {
        async shutdownAll() {
          calls.push("pty-shutdown");
        },
      },
      removeRuntime(runtimeFile) {
        calls.push(`remove:${runtimeFile}`);
      },
      runtimeFile: "/tmp/runtime.json",
      runtimeLoops: {
        stop() {
          calls.push("loops-stop");
        },
      },
      writeMarker(dir) {
        calls.push(`marker:${dir}`);
      },
    });

    await expect(shutdown()).rejects.toThrow("disk-full");

    // marker / ipc-stop / removeRuntime / processExit must NOT have
    // run -- a stale state.json with a graceful marker would
    // mis-classify running sessions as ended on next boot.
    expect(calls).not.toContain("marker:/tmp/cfg");
    expect(calls).not.toContain("ipc-stop");
    expect(calls).not.toContain("exit:0");
  });

  it("is idempotent while shutdown is already in flight", async () => {
    const disposeControl: { resolve?: () => void } = {};
    const shutdown = createShutdownHandler({
      appStateStore: {
        flush: vi.fn(async () => undefined),
        isSessionsReadOnly: vi.fn(() => false),
      },
      configDir: "/tmp/cfg",
      ipcServer: { stop: vi.fn(async () => undefined) },
      processExit: vi.fn(),
      projectRuntime: {
        dispose: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              disposeControl.resolve = resolve;
            }),
        ),
      },
      ptyManager: { shutdownAll: vi.fn(async () => undefined) },
      removeRuntime: vi.fn(),
      runtimeFile: "/tmp/runtime.json",
      runtimeLoops: { stop: vi.fn() },
      writeMarker: vi.fn(),
    });

    const first = shutdown();
    const second = shutdown();

    expect(second).toBe(first);

    disposeControl.resolve?.();
    await first;
  });
});

describe("registerShutdownSignals", () => {
  it("registers SIGTERM, SIGINT, and SIGHUP handlers", () => {
    const register = vi.fn();
    const shutdown = vi.fn(async () => undefined);

    registerShutdownSignals(shutdown, register);

    expect(register).toHaveBeenNthCalledWith(1, "SIGTERM", shutdown);
    expect(register).toHaveBeenNthCalledWith(2, "SIGINT", shutdown);
    expect(register).toHaveBeenNthCalledWith(3, "SIGHUP", shutdown);
  });
});
