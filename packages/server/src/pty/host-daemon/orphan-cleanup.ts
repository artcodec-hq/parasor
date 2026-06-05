/*
 * - daemon startup orphan reconciliation.
 *
 * On startup the daemon reads `appState.sessionRecords` and decides what
 * to do with each record whose `state === "running"` (we ignore already-
 * terminal "exited"/"lost"/"orphaned" records -- they only need cleanup
 * via `pty-host doctor`, not on every boot):
 *
 *   - alive + recorded `daemonPid` matches *this* daemon: keep as
 *     "running" (rare; happens after a fast restart that didn't change
 *     the PID -- possible under exec-replace).
 *   - alive + recorded `daemonPid` belongs to a different generation:
 *     transition to "orphaned". The PTY survived the previous daemon
 *     so it is still consuming a slot, but we no longer own its master
 *     fd; only `pty-host doctor` can reap it.
 *   - dead (kill(pid,0) -> ESRCH/ENOENT): transition to "lost". The PID
 *     vanished without a recorded exit (SIGKILL, parent crash, OOM).
 *   - record has no PID (create-stub that never spawned): transition
 *     to "lost" -- the previous daemon never observed `node-pty.spawn`
 *     completing, so the underlying child cannot exist.
 *
 * The decision is *local to the record*: we never call `ps -ef | grep`
 * to rediscover untracked PTYs. Records are the source of truth; an
 * untracked alive PID matching one of our argv signatures is out of
 * scope here (handled by `pty-host doctor` re-verification).
 *
 * Side effect: returns a list of `SessionRecord` snapshots reflecting
 * the post-reconciliation state. Callers persist them via
 * `AppStateStore.internalMutate` so the read-only mirror guard is
 * bypassed (the daemon owns the writer side).
 */

import type { SessionRecord } from "@parasor/shared";

export type OrphanReconcileTransition =
  | { type: "kept"; id: string }
  | { type: "orphaned"; id: string; previousDaemonPid: number }
  | { type: "lost"; id: string; reason: "no-pid" | "dead-pid" };

export interface OrphanReconcileResult {
  /** Snapshots after reconciliation, in input order. */
  records: SessionRecord[];
  /** Per-id transition summary (helpful for logging / tests). */
  transitions: OrphanReconcileTransition[];
}

export interface ReconcileOpts {
  currentDaemonPid: number;
  /**
   * ISO8601 timestamp of *this* daemon's start. Combined with
   * `currentDaemonPid` to form the writer-generation tuple -- a record
   * with a matching pid but a stale `daemonStartedAt` is treated as
   * orphaned, defending against PID recycling between daemon restarts
   * (reviewed for correctness). Required for correctness; an undefined value
   * would silently degrade to PID-only matching.
   */
  currentDaemonStartedAt: string;
  /** Liveness probe; defaults to `process.kill(pid, 0)`. Test seam. */
  isPidAlive?: (pid: number) => boolean;
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Pure function -- no side effects. Caller is responsible for persisting
 * the resulting array via `AppStateStore.internalMutate`.
 *
 * Already-terminal records (state in {exited,lost,orphaned}) are passed
 * through unchanged. Only `state === "running"` records are evaluated.
 */
export function reconcileSessionRecords(
  input: readonly SessionRecord[],
  opts: ReconcileOpts,
): OrphanReconcileResult {
  const isAlive = opts.isPidAlive ?? defaultIsPidAlive;
  const out: SessionRecord[] = [];
  const transitions: OrphanReconcileTransition[] = [];

  for (const rec of input) {
    if (rec.state !== "running") {
      out.push(rec);
      continue;
    }

    if (rec.pid === null || rec.pid === undefined) {
      out.push({ ...rec, state: "lost" });
      transitions.push({ type: "lost", id: rec.id, reason: "no-pid" });
      continue;
    }

    if (!isAlive(rec.pid)) {
      out.push({ ...rec, state: "lost" });
      transitions.push({ type: "lost", id: rec.id, reason: "dead-pid" });
      continue;
    }

    if (
      rec.daemonPid === opts.currentDaemonPid &&
      rec.daemonStartedAt === opts.currentDaemonStartedAt
    ) {
      out.push(rec);
      transitions.push({ type: "kept", id: rec.id });
      continue;
    }

    out.push({ ...rec, state: "orphaned" });
    transitions.push({
      type: "orphaned",
      id: rec.id,
      previousDaemonPid: rec.daemonPid,
    });
  }

  return { records: out, transitions };
}
