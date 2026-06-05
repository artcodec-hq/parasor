/*
 * daemon protocol mismatch recovery -- in-memory store for server-lifetime notices surfaced to the web
 * UI. Currently records `daemon-auto-restarted` events from the
 * createPtyHost recovery path so the web banner can explain why the
 * session list is empty after a daemon-protocol upgrade.
 *
 * Lifecycle: instance lives on the running server only; notices are not
 * persisted across server restarts. Web dismisses per-kind via
 * `DELETE /api/notices/:kind`. Re-occurrence (a second auto-restart in
 * the same lifetime) overwrites -- at most one entry per kind.
 */

import type { ServerNotice, ServerNoticeKind } from "@parasor/shared";

export class ServerNoticesStore {
  private byKind = new Map<ServerNoticeKind, ServerNotice>();

  recordDaemonAutoRestarted(detail: {
    serverProtocolVersion?: string;
    daemonProtocolVersion?: string;
  }): void {
    this.byKind.set("daemon-auto-restarted", {
      kind: "daemon-auto-restarted",
      occurredAt: new Date().toISOString(),
      serverProtocolVersion: detail.serverProtocolVersion,
      daemonProtocolVersion: detail.daemonProtocolVersion,
    });
  }

  list(): ServerNotice[] {
    return [...this.byKind.values()];
  }

  has(kind: ServerNoticeKind): boolean {
    return this.byKind.has(kind);
  }

  dismiss(kind: ServerNoticeKind): boolean {
    return this.byKind.delete(kind);
  }
}
