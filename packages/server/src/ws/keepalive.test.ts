import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachKeepalive, type KeepaliveSocket } from "./keepalive.js";

class FakeWebSocket extends EventEmitter {
  readyState = 1;
  readonly OPEN = 1;
  ping = vi.fn();
  terminate = vi.fn(() => {
    this.readyState = 3;
  });
}

function asWs(fake: FakeWebSocket): KeepaliveSocket {
  return fake as unknown as KeepaliveSocket;
}

describe("attachKeepalive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends ping on each interval tick while socket is open", () => {
    const fake = new FakeWebSocket();
    attachKeepalive(asWs(fake), { pingIntervalMs: 1000, pongTimeoutMs: 500 });

    vi.advanceTimersByTime(999);
    expect(fake.ping).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    expect(fake.ping).toHaveBeenCalledTimes(1);

    // Second tick should also fire once the prior pong resets the deadline.
    fake.emit("pong");
    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(2);
  });

  it("skips ping if socket is not OPEN", () => {
    const fake = new FakeWebSocket();
    fake.readyState = 0; // CONNECTING
    attachKeepalive(asWs(fake), { pingIntervalMs: 1000, pongTimeoutMs: 500 });

    vi.advanceTimersByTime(5000);
    expect(fake.ping).not.toHaveBeenCalled();
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it("terminates socket when pong does not arrive before deadline", () => {
    const fake = new FakeWebSocket();
    const onTimeout = vi.fn();
    attachKeepalive(asWs(fake), {
      pingIntervalMs: 1000,
      pongTimeoutMs: 500,
      onTimeout,
    });

    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not terminate when pong arrives before deadline", () => {
    const fake = new FakeWebSocket();
    const onTimeout = vi.fn();
    attachKeepalive(asWs(fake), {
      pingIntervalMs: 1000,
      pongTimeoutMs: 500,
      onTimeout,
    });

    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    fake.emit("pong");

    vi.advanceTimersByTime(500);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it("does not queue overlapping pings while one is outstanding", () => {
    const fake = new FakeWebSocket();
    attachKeepalive(asWs(fake), { pingIntervalMs: 1000, pongTimeoutMs: 5000 });

    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(1);

    // Next interval tick arrives before pong; should not re-ping.
    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(1);

    fake.emit("pong");
    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(2);
  });

  it("is disabled when pingIntervalMs is zero", () => {
    const fake = new FakeWebSocket();
    const dispose = attachKeepalive(asWs(fake), {
      pingIntervalMs: 0,
      pongTimeoutMs: 500,
    });

    vi.advanceTimersByTime(10_000);
    expect(fake.ping).not.toHaveBeenCalled();
    expect(fake.listenerCount("pong")).toBe(0);

    expect(() => {
      dispose();
    }).not.toThrow();
  });

  it("does not terminate when pongTimeoutMs is zero", () => {
    const fake = new FakeWebSocket();
    const onTimeout = vi.fn();
    attachKeepalive(asWs(fake), {
      pingIntervalMs: 1000,
      pongTimeoutMs: 0,
      onTimeout,
    });

    vi.advanceTimersByTime(10_000);
    expect(fake.ping).toHaveBeenCalledTimes(10);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it("dispose clears timers and removes pong listener", () => {
    const fake = new FakeWebSocket();
    const dispose = attachKeepalive(asWs(fake), {
      pingIntervalMs: 1000,
      pongTimeoutMs: 500,
    });

    expect(fake.listenerCount("pong")).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(1);

    dispose();
    expect(fake.listenerCount("pong")).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it("dispose is idempotent", () => {
    const fake = new FakeWebSocket();
    const dispose = attachKeepalive(asWs(fake), {
      pingIntervalMs: 1000,
      pongTimeoutMs: 500,
    });

    dispose();
    expect(() => {
      dispose();
    }).not.toThrow();
  });

  it("swallows ping() errors so the interval keeps running", () => {
    const fake = new FakeWebSocket();
    fake.ping.mockImplementationOnce(() => {
      throw new Error("send buffer full");
    });
    attachKeepalive(asWs(fake), { pingIntervalMs: 1000, pongTimeoutMs: 500 });

    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(1);

    // Because the first ping threw, no pong deadline was armed. Next tick
    // should therefore ping again.
    vi.advanceTimersByTime(1000);
    expect(fake.ping).toHaveBeenCalledTimes(2);
  });
});
