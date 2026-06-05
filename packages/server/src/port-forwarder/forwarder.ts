import net from "node:net";

export interface ForwardedPortSpec {
  port: number;
  bindsAll: boolean;
}

interface LiveForwarder {
  server: net.Server;
  /** The dev-server port this forwarder fronts. */
  devPort: number;
  /** OS-assigned listen port; `null` until the `"listening"` event fires. */
  reachablePort: number | null;
  /** Every still-open client + upstream socket for this forwarder. */
  sockets: Set<net.Socket>;
}

/**
 * Per-port raw TCP forwarder (Tier A .). For each detected
 * dev-server port that is *not* already bound to all interfaces, a
 * `net.Server` listens on `<bindHost>:0` (an OS-assigned free port) and pipes
 * every connection byte-for-byte to `localhost:<devPort>` (both loopback
 * families -- a `localhost` dev server often binds only `::1`). No HTTP parsing
 * -- HMR/WebSocket pass through transparently because it is L4. Using a free
 * listen port means binding `0.0.0.0` does not collide with the dev server's
 * own `localhost:<devPort>`.
 *
 * `bindHost === null` ⇒ the forwarder is inert: parasor is loopback-bound so
 * the viewer is on this machine and `localhost:<port>` already works. `sync`
 * is a no-op and `getReachablePort` always returns `null`.
 *
 * Forwarders are keyed by `projectId` -> `devPort` so a project going inactive
 * (next `sync` with `[]`) tears its forwarders down.
 */
export class PortForwarder {
  private readonly byProject = new Map<string, Map<number, LiveForwarder>>();
  private onChange: ((projectId: string) => void) | null = null;

  constructor(private readonly bindHost: string | null) {}

  isInert(): boolean {
    return this.bindHost === null;
  }

  /**
   * Register a callback invoked whenever a forwarder finishes binding (its
   * `reachablePort` becomes available) or its bind errors (it is torn down).
   * `PortForwarder`'s state changes out-of-band of `sync` here -- `listen` is
   * async -- so callers that mirror `getReachablePort` results (e.g. the
   * runtime's `ports-updated` broadcast) must re-read on this signal.
   */
  setOnChange(cb: (projectId: string) => void): void {
    this.onChange = cb;
  }

  sync(projectId: string, ports: ForwardedPortSpec[]): void {
    if (this.bindHost === null) return;
    const wanted = new Set(ports.filter((p) => !p.bindsAll).map((p) => p.port));
    const current = this.byProject.get(projectId) ?? new Map();

    for (const [devPort, forwarder] of current) {
      if (!wanted.has(devPort)) {
        this.teardownForwarder(forwarder);
        current.delete(devPort);
      }
    }
    for (const devPort of wanted) {
      if (current.has(devPort)) continue;
      const forwarder = this.createForwarder(projectId, devPort);
      if (forwarder) current.set(devPort, forwarder);
    }

    if (current.size === 0) this.byProject.delete(projectId);
    else this.byProject.set(projectId, current);
  }

  /**
   * The OS-assigned listen port for `devPort` in `projectId`, or `null` if no
   * forwarder exists, it has not finished binding, or its bind errored.
   */
  getReachablePort(projectId: string, devPort: number): number | null {
    if (this.bindHost === null) return null;
    const forwarder = this.byProject.get(projectId)?.get(devPort);
    if (!forwarder?.server.listening) return null;
    return forwarder.reachablePort;
  }

  stop(): void {
    for (const forwarders of this.byProject.values()) {
      for (const forwarder of forwarders.values()) {
        this.teardownForwarder(forwarder);
      }
    }
    this.byProject.clear();
  }

  private teardownForwarder(forwarder: LiveForwarder): void {
    forwarder.server.close();
    for (const socket of forwarder.sockets) socket.destroy();
    forwarder.sockets.clear();
  }

  private createForwarder(
    projectId: string,
    devPort: number,
  ): LiveForwarder | null {
    const bindHost = this.bindHost;
    if (bindHost === null) return null;
    const sockets = new Set<net.Socket>();
    const server = net.createServer((clientSocket) => {
      // `localhost`, not `127.0.0.1`: a dev server started on `localhost` often
      // binds only `::1` (Node's default resolution order on macOS), so an
      // IPv4-only upstream would `ECONNREFUSED`. Node ≥18 `autoSelectFamily`
      // tries both loopback families.
      const upstream = net.connect(devPort, "localhost");
      this.wirePair(sockets, clientSocket, upstream);
    });
    const forwarder: LiveForwarder = {
      server,
      devPort,
      reachablePort: null,
      sockets,
    };
    server.on("listening", () => {
      const addr = server.address();
      forwarder.reachablePort =
        addr && typeof addr === "object" ? addr.port : null;
      // The listen completed asynchronously, after the `sync` tick -- signal
      // upward so any mirrored reachability state is re-read and re-broadcast.
      this.onChange?.(projectId);
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      // Best effort: a preview forwarder must never crash the server. On any
      // listen error (EADDRINUSE is unlikely on a free port) drop this
      // forwarder; the dev server stays loopback-only and the port is
      // reported unreachable.
      if (err.code !== "EADDRINUSE") {
        console.warn(
          `[port-forwarder] failed to bind ${bindHost} for dev port ${devPort}: ${err.message}`,
        );
      }
      let removed = false;
      for (const [pid, forwarders] of this.byProject) {
        if (forwarders.get(devPort) === forwarder) {
          this.teardownForwarder(forwarder);
          forwarders.delete(devPort);
          if (forwarders.size === 0) this.byProject.delete(pid);
          removed = true;
        }
      }
      if (removed) this.onChange?.(projectId);
    });
    server.listen(0, bindHost);
    return forwarder;
  }

  private wirePair(
    sockets: Set<net.Socket>,
    clientSocket: net.Socket,
    upstream: net.Socket,
  ): void {
    sockets.add(clientSocket);
    sockets.add(upstream);
    const closePeer = (peer: net.Socket) => {
      peer.destroy();
    };
    clientSocket.on("error", () => closePeer(upstream));
    upstream.on("error", () => closePeer(clientSocket));
    clientSocket.on("close", () => {
      sockets.delete(clientSocket);
      closePeer(upstream);
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      closePeer(clientSocket);
    });
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  }
}
