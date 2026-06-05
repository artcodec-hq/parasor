/**
 * Minimal shape of the `ws` package WebSocket we rely on. Declared locally so
 * the server package does not need a direct dependency on `ws` (it arrives
 * transitively through @hono/node-ws).
 */
export interface KeepaliveSocket {
  readyState: number;
  readonly OPEN: number;
  ping(): void;
  terminate(): void;
  on(event: "pong", listener: () => void): void;
  off(event: "pong", listener: () => void): void;
}

export interface KeepaliveOptions {
  pingIntervalMs: number;
  pongTimeoutMs: number;
  onTimeout?: () => void;
}

/**
 * Attach ping/pong keepalive to a ws WebSocket. Mobile carriers, corporate
 * proxies, and Tailscale can silently drop idle TCP connections; without a
 * keepalive the client thinks the socket is healthy while the server sees
 * nothing. The interval ping forces a half-open state to surface, and the
 * pong deadline tears the connection down so the client reconnects.
 */
export function attachKeepalive(
  raw: KeepaliveSocket,
  options: KeepaliveOptions,
): () => void {
  const { pingIntervalMs, pongTimeoutMs, onTimeout } = options;
  if (pingIntervalMs <= 0) return () => {};

  let disposed = false;
  let pongDeadline: ReturnType<typeof setTimeout> | null = null;

  const clearDeadline = () => {
    if (pongDeadline !== null) {
      clearTimeout(pongDeadline);
      pongDeadline = null;
    }
  };

  const onPong = () => {
    clearDeadline();
  };

  raw.on("pong", onPong);

  const pingTimer = setInterval(() => {
    if (disposed) return;
    if (raw.readyState !== raw.OPEN) return;
    if (pongDeadline !== null) return;
    try {
      raw.ping();
    } catch {
      return;
    }
    if (pongTimeoutMs <= 0) return;
    pongDeadline = setTimeout(() => {
      pongDeadline = null;
      if (disposed) return;
      onTimeout?.();
      try {
        raw.terminate();
      } catch {
        // already closed; nothing to do
      }
    }, pongTimeoutMs);
    pongDeadline.unref?.();
  }, pingIntervalMs);
  pingTimer.unref?.();

  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(pingTimer);
    clearDeadline();
    raw.off("pong", onPong);
  };
}
