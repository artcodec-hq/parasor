import type { Session, SessionEndReason } from "@parasor/shared";

/**
 * Pure (I/O-free) local view-state mirror for {@link RemotePtyHost}. Owns the
 * mirrored `Session` map and the per-session monotonic generation latch
 * (PTY generation gate). Every transition is deterministic and socket-free: the IPC shell
 * decodes wire frames, resolves the handshake, fans bytes out to listeners and
 * persists scrollback -- then drives these methods. Holding the two maps here
 * keeps the shell to a single field and makes the reconciliation unit-testable
 * without a socket.
 */
export class SessionMirror {
  private readonly sessions = new Map<string, Session>();
  /**
   * PTY generation gate: highest generation observed per session. Seeded from
   * authoritative `Session` snapshots and advanced by DATA frames; only ever
   * moves forward so a late stale-generation chunk cannot rewind the latch.
   */
  private readonly latestGeneration = new Map<string, number>();

  // --- generation latch (PTY generation gate) ---

  /**
   * Monotonic seed from an authoritative `Session` snapshot. Takes the max so
   * a generation already observed via DATA is never overwritten by a stale
   * snapshot. SESSION_LIST / SESSION_UPDATE land before the first DATA frame
   * for a freshly-spawned (or just-auto-resumed) session, so seeding here is
   * what lets `attachClient` report a non-zero `serverState.generation`; without
   * it the latch stays 0 until the first OUTPUT byte and the client echoes
   * `{generation: 0}` on every INPUT, defeating the PTY generation gate auto-resume input gate.
   */
  seedGeneration(session: Session): void {
    const prev = this.latestGeneration.get(session.id) ?? 0;
    if (session.generation > prev) {
      this.latestGeneration.set(session.id, session.generation);
    }
  }

  /**
   * Record a DATA-frame generation under the monotonic gate and report whether
   * the chunk is stale (strictly older than the highest generation observed so
   * far). The shell uses the verdict to decide client fan-out / scrollback
   * persistence (PTY generation gate) while the latch advance stays here.
   */
  recordDataGeneration(
    sessionId: string,
    generation: number,
  ): { stale: boolean } {
    const prev = this.latestGeneration.get(sessionId) ?? 0;
    if (generation > prev) {
      this.latestGeneration.set(sessionId, generation);
    }
    return { stale: generation < prev };
  }

  /** Highest generation observed for a session (0 if never seen). */
  generationOf(sessionId: string): number {
    return this.latestGeneration.get(sessionId) ?? 0;
  }

  // --- reconciliation ---

  /**
   * Insert/update an authoritative session snapshot and seed its generation.
   * Used for SESSION_UPDATE broadcasts and CREATE/RESTART ACKs.
   */
  upsert(session: Session): void {
    this.sessions.set(session.id, session);
    this.seedGeneration(session);
  }

  /**
   * Replace a stored session object without touching the generation latch.
   * Used for local optimistic patches (setTitle/setPinned) whose generation is
   * unchanged from the already-mirrored value.
   */
  replace(session: Session): void {
    this.sessions.set(session.id, session);
  }

  /** SESSION_LIST: replace the entire mirror and seed each generation. */
  applyList(sessions: readonly Session[]): void {
    this.sessions.clear();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
      this.seedGeneration(session);
    }
  }

  /**
   * SESSION_EXIT: stamp an existing session `ended` with its end reason. No-op
   * for unknown ids -- the shell still fires its `onSessionExit` callback
   * regardless.
   */
  applyExit(sessionId: string, endReason: SessionEndReason): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessions.set(sessionId, {
        ...existing,
        state: "ended",
        endReason,
      });
    }
  }

  /** DISPOSE: drop one session from the mirror and the generation latch. */
  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.latestGeneration.delete(sessionId);
  }

  /** DISPOSE_ALL: clear all mirror and generation state. */
  clear(): void {
    this.sessions.clear();
    this.latestGeneration.clear();
  }

  // --- read accessors (mirror-served sync queries) ---

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  listByProject(projectId: string): Session[] {
    return this.list().filter((s) => s.projectId === projectId);
  }
}
