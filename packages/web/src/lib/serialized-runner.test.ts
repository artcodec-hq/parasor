import { describe, expect, it } from "vitest";
import { createSerializedRunner } from "./serialized-runner.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSerializedRunner", () => {
  it("runs jobs strictly in submission order even when earlier ones resolve later", async () => {
    const run = createSerializedRunner();
    const a = deferred<string>();
    const b = deferred<string>();
    const aStarted = deferred<void>();
    const bStarted = deferred<void>();
    const log: string[] = [];

    const p1 = run(async () => {
      aStarted.resolve();
      log.push("a:start");
      const v = await a.promise;
      log.push(`a:end:${v}`);
      return v;
    });
    const p2 = run(async () => {
      bStarted.resolve();
      log.push("b:start");
      const v = await b.promise;
      log.push(`b:end:${v}`);
      return v;
    });

    // a starts as soon as its enqueueing chain settles.
    await aStarted.promise;
    expect(log).toEqual(["a:start"]);

    // Resolve b's body-completion source first to prove order is not driven by
    // body resolution order; b still must not start until a settles.
    b.resolve("B");
    const bRaceLost = await Promise.race([
      bStarted.promise.then(() => "started"),
      Promise.resolve("not-started"),
    ]);
    expect(bRaceLost).toBe("not-started");
    expect(log).toEqual(["a:start"]);

    a.resolve("A");
    await expect(p1).resolves.toBe("A");
    await expect(p2).resolves.toBe("B");
    expect(log).toEqual(["a:start", "a:end:A", "b:start", "b:end:B"]);
  });

  it("isolates rejection of one job from the next (queue keeps draining)", async () => {
    const run = createSerializedRunner();
    const log: string[] = [];

    const p1 = run(async () => {
      log.push("a:start");
      throw new Error("boom");
    });
    const p2 = run(async () => {
      log.push("b:start");
      return "ok";
    });

    await expect(p1).rejects.toThrow("boom");
    await expect(p2).resolves.toBe("ok");
    expect(log).toEqual(["a:start", "b:start"]);
  });

  it("matches serialized request ordering acceptance: last-issued client request wins on the server", async () => {
    const run = createSerializedRunner();
    const serverState: { ids: string[] | null } = { ids: null };
    const a = deferred<void>();
    const b = deferred<void>();
    const bStarted = deferred<void>();

    // Simulate "PUT_A queued, then PUT_B queued immediately, but PUT_B's
    // network roundtrip finishes first." Without serialization, the older
    // PUT_A would arrive last and overwrite the server.
    void run(async () => {
      await a.promise;
      serverState.ids = ["A"];
    });
    const last = run(async () => {
      bStarted.resolve();
      await b.promise;
      serverState.ids = ["B"];
    });

    // Resolve B first; with serialization, B's job() doesn't run until A finishes.
    b.resolve();
    const bRace = await Promise.race([
      bStarted.promise.then(() => "started"),
      Promise.resolve("not-started"),
    ]);
    expect(bRace).toBe("not-started");
    expect(serverState.ids).toBeNull();

    a.resolve();
    await last;
    expect(serverState.ids).toEqual(["B"]);
  });
});
