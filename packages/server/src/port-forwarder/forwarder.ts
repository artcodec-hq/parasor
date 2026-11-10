export interface ForwardedPortSpec {
  port: number;
  bindsAll: boolean;
}

export type ForwarderPortState =
  | { status: "none" }
  | { status: "pending" }
  | { status: "reachable"; reachablePort: number }
  | { status: "failed" };

/**
 * Automatic forwarding is suspended until remote previews have an isolated
 * authentication boundary. Keep the discovery contract without opening any
 * network listeners. Restoration: https://github.com/artcodec-hq/parasor/issues/127.
 */
export class PortForwarder {
  constructor(private readonly bindHost: string | null) {}

  // This means the viewer is local, not that remote forwarding is enabled.
  isInert(): boolean {
    return this.bindHost === null;
  }

  setOnChange(_cb: (projectId: string) => void): void {}

  sync(_projectId: string, _ports: ForwardedPortSpec[]): void {}

  getReachablePort(_projectId: string, _devPort: number): number | null {
    return null;
  }

  getForwarderState(_projectId: string, _devPort: number): ForwarderPortState {
    return { status: "none" };
  }

  stop(): void {}
}
