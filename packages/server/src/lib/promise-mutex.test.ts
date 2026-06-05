import { describe, expect, it } from "vitest";
import { PromiseMutex } from "./promise-mutex.js";

describe("PromiseMutex", () => {
  it("acquires immediately when uncontested", async () => {
    const mutex = new PromiseMutex();
    const release = await mutex.acquire();
    expect(typeof release).toBe("function");
    release();
  });

  it("serializes concurrent acquires", async () => {
    const mutex = new PromiseMutex();
    const order: number[] = [];

    const r1 = await mutex.acquire();
    // r1 holds the lock

    const p2 = mutex.acquire().then((release) => {
      order.push(2);
      release();
    });

    const p3 = mutex.acquire().then((release) => {
      order.push(3);
      release();
    });

    order.push(1);
    r1(); // release lock, p2 should proceed next

    await p2;
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("allows re-acquire after release", async () => {
    const mutex = new PromiseMutex();

    const r1 = await mutex.acquire();
    r1();

    const r2 = await mutex.acquire();
    r2();
    // no deadlock = pass
  });

  it("protects a shared counter", async () => {
    const mutex = new PromiseMutex();
    let counter = 0;

    async function increment() {
      const release = await mutex.acquire();
      const val = counter;
      await new Promise((r) => setTimeout(r, 1));
      counter = val + 1;
      release();
    }

    await Promise.all([increment(), increment(), increment()]);
    expect(counter).toBe(3);
  });
});
