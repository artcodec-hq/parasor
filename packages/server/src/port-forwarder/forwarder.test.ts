import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PortForwarder } from "./forwarder.js";

/*
 * The forwarder listens on `<bindHost>:0` (an OS-assigned free port) and
 * forwards to `127.0.0.1:<devPort>`. Because the listen port is free, the
 * test can bind the forwarder on `127.0.0.1` itself with no collision against
 * the echo server's `127.0.0.1:<devPort>` -- there is no longer a same-port
 * conflict to engineer around. (`resolveForwarderBindHost` would reject
 * `127.0.0.1` as loopback; that gate is covered in `reachable-host.test.ts`.
 * `PortForwarder` binds whatever host it is handed.)
 */
const BIND_HOST = "127.0.0.1";
const SETTLE_MS = 60;

function startEchoServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.pipe(socket);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        resolve({ port: addr.port, close: () => server.close() });
      } else {
        reject(new Error("no address"));
      }
    });
  });
}

function roundTrip(
  host: string,
  port: number,
  payload: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => {
      socket.write(payload);
    });
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
      if (received.length >= payload.length) {
        socket.end();
        resolve(received);
      }
    });
    socket.on("error", reject);
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
  });
}

function tcpConnects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Open a long-lived connection through the forwarder; returns the socket. */
function openConnection(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    socket.on("connect", () => resolve(socket));
    socket.on("error", reject);
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
  });
}

describe("PortForwarder", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("forwards bytes end-to-end through a started forwarder", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const forwarder = new PortForwarder(BIND_HOST);
    cleanups.push(() => forwarder.stop());

    forwarder.sync("proj", [{ port: echo.port, bindsAll: false }]);
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const listenPort = forwarder.getReachablePort("proj", echo.port);
    expect(listenPort).not.toBeNull();
    expect(listenPort).not.toBe(echo.port);
    const reply = await roundTrip(BIND_HOST, listenPort as number, "ping-123");
    expect(reply).toBe("ping-123");
  });

  it("closes the listener and live sockets when the port is removed in a later sync", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const forwarder = new PortForwarder(BIND_HOST);
    cleanups.push(() => forwarder.stop());

    forwarder.sync("proj", [{ port: echo.port, bindsAll: false }]);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const listenPort = forwarder.getReachablePort("proj", echo.port) as number;
    expect(await tcpConnects(BIND_HOST, listenPort)).toBe(true);

    // An established connection must be torn down too, not just the listener.
    const live = await openConnection(BIND_HOST, listenPort);
    const liveClosed = new Promise<void>((resolve) =>
      live.on("close", () => resolve()),
    );

    forwarder.sync("proj", []);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await liveClosed;
    expect(forwarder.getReachablePort("proj", echo.port)).toBeNull();
    expect(await tcpConnects(BIND_HOST, listenPort)).toBe(false);
  });

  it("does not start a forwarder for bindsAll ports", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const forwarder = new PortForwarder(BIND_HOST);
    cleanups.push(() => forwarder.stop());

    forwarder.sync("proj", [{ port: echo.port, bindsAll: true }]);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(forwarder.getReachablePort("proj", echo.port)).toBeNull();
  });

  it("getReachablePort reflects forwarder state per project/port", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const forwarder = new PortForwarder(BIND_HOST);
    cleanups.push(() => forwarder.stop());

    expect(forwarder.getReachablePort("proj", echo.port)).toBeNull();
    forwarder.sync("proj", [{ port: echo.port, bindsAll: false }]);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(forwarder.getReachablePort("proj", echo.port)).not.toBeNull();
    expect(forwarder.getReachablePort("proj", 65000)).toBeNull();
    expect(forwarder.getReachablePort("other-proj", echo.port)).toBeNull();
  });

  it("fires the change listener once the async bind completes", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const forwarder = new PortForwarder(BIND_HOST);
    cleanups.push(() => forwarder.stop());

    const changes: string[] = [];
    forwarder.setOnChange((projectId) => changes.push(projectId));
    forwarder.sync("proj", [{ port: echo.port, bindsAll: false }]);
    // The `listen` is async -- no notification yet on the same tick.
    expect(changes).toEqual([]);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(changes).toEqual(["proj"]);
    expect(forwarder.getReachablePort("proj", echo.port)).not.toBeNull();
  });

  it("is inert when constructed with a null bind host", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const forwarder = new PortForwarder(null);
    cleanups.push(() => forwarder.stop());

    expect(forwarder.isInert()).toBe(true);
    forwarder.sync("proj", [{ port: echo.port, bindsAll: false }]);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    expect(forwarder.getReachablePort("proj", echo.port)).toBeNull();
  });
});
