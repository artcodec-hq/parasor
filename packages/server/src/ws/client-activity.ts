import type { WSContext } from "hono/ws";

/**
 * Per-connection last-reported active project. Lifecycle increment/decrement
 * is applied by the caller from prev → next; this map only remembers the
 * last id so disconnect can drop the previous focus.
 */
export class ClientActivityTracker {
  private readonly byClient = new Map<WSContext, string | null>();

  setActiveProject(ws: WSContext, projectId: string | null): string | null {
    const prev = this.byClient.get(ws) ?? null;
    this.byClient.set(ws, projectId);
    return prev;
  }

  removeClient(ws: WSContext): string | null {
    const prev = this.byClient.get(ws) ?? null;
    this.byClient.delete(ws);
    return prev;
  }
}
