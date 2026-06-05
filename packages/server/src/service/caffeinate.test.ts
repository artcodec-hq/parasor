import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CaffeinateController } from "./caffeinate.js";

function makeFakeProc() {
  const emitter = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
  };
  emitter.kill = vi.fn();
  return emitter as unknown as ChildProcess & {
    kill: ReturnType<typeof vi.fn>;
  };
}

describe("CaffeinateController", () => {
  it("spawns caffeinate -i -w <ppid> when enabled and a client is attached on darwin", () => {
    const procs: (ChildProcess & { kill: ReturnType<typeof vi.fn> })[] = [];
    const spawner = vi.fn((_cmd: string, _args: string[]) => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });

    const c = new CaffeinateController({
      platform: "darwin",
      spawner,
      parentPid: 12345,
    });
    c.setEnabled(true);
    c.setClientCount(1);

    expect(spawner).toHaveBeenCalledTimes(1);
    expect(spawner).toHaveBeenCalledWith("caffeinate", ["-i", "-w", "12345"]);
    expect(c.isRunning()).toBe(true);
  });

  it("defaults parentPid to process.pid when not supplied", () => {
    const spawner = vi.fn(() => makeFakeProc());
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(1);

    expect(spawner).toHaveBeenCalledWith("caffeinate", [
      "-i",
      "-w",
      String(process.pid),
    ]);
  });

  it("does not spawn on non-darwin", () => {
    const spawner = vi.fn();
    const c = new CaffeinateController({ platform: "linux", spawner });
    c.setEnabled(true);
    c.setClientCount(5);
    expect(spawner).not.toHaveBeenCalled();
    expect(c.isRunning()).toBe(false);
  });

  it("does not spawn when client count is zero", () => {
    const spawner = vi.fn(() => makeFakeProc());
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(0);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("kills caffeinate when last client disconnects", () => {
    const procs: (ChildProcess & { kill: ReturnType<typeof vi.fn> })[] = [];
    const spawner = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(2);
    c.setClientCount(0);

    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(c.isRunning()).toBe(false);
  });

  it("kills caffeinate when disabled", () => {
    const procs: (ChildProcess & { kill: ReturnType<typeof vi.fn> })[] = [];
    const spawner = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(1);
    c.setEnabled(false);

    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(c.isRunning()).toBe(false);
  });

  it("re-spawns after external exit if still required", () => {
    const procs: (ChildProcess & {
      kill: ReturnType<typeof vi.fn>;
      emit: (e: string) => boolean;
    })[] = [];
    const spawner = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p as unknown as (typeof procs)[number]);
      return p;
    });
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(1);
    expect(procs).toHaveLength(1);

    // Simulate external kill
    procs[0].emit("exit");
    expect(c.isRunning()).toBe(false);

    // No auto-respawn without a new trigger -- reconcile only runs on setters
    expect(procs).toHaveLength(1);

    // Trigger reconcile via setter update
    c.setClientCount(2);
    expect(procs).toHaveLength(2);
    expect(c.isRunning()).toBe(true);
  });

  it("shutdown() terminates the running proc", () => {
    const procs: (ChildProcess & { kill: ReturnType<typeof vi.fn> })[] = [];
    const spawner = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(1);
    c.shutdown();
    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(c.isRunning()).toBe(false);
  });

  it("is idempotent when the same state is reapplied", () => {
    const spawner = vi.fn(() => makeFakeProc());
    const c = new CaffeinateController({ platform: "darwin", spawner });
    c.setEnabled(true);
    c.setClientCount(1);
    c.setEnabled(true);
    c.setClientCount(1);
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});
