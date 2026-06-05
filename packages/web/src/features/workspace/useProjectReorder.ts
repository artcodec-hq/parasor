import { useCallback, useRef, useState } from "react";
import { AuthExpiredError, authFetch } from "../../lib/auth-fetch.js";
import { createSerializedRunner } from "../../lib/serialized-runner.js";

export interface ProjectReorderControl {
  /** Monotonic tick incremented when a reorder fails. Consumers wire this
   * into the sidebar's `reorderResetSignal` so it can roll back its
   * optimistic UI state. */
  reorderResetSignal: number;
  /** Number of in-flight reorder requests. The sidebar uses this to
   * disable further drag interactions while a flush is pending. */
  pendingProjectReorderCount: number;
  /** Persist the new project order (sends `PUT /api/projects/order`).
   * Multiple concurrent calls are serialized through a runner so the
   * server-side order can never get out of sync with the latest local
   * intent. Auth-expired errors are silently swallowed (the auth-fetch
   * helper triggers re-auth flows elsewhere); all other failures bump
   * `reorderResetSignal` and surface an error toast. */
  reorder: (ids: string[]) => Promise<void>;
}

interface UseProjectReorderInput {
  /** Invoked with a user-facing message when the reorder fails for any
   * reason other than `AuthExpiredError`. The hook stays independent of
   * the toast surface. */
  onError: (message: string) => void;
}

/**
 * Owns the project-reorder retry / serialization machinery: in-flight
 * counter, reset signal for the sidebar to roll back optimistic state,
 * and a single `createSerializedRunner` so concurrent drag-drops on the
 * same client never race. Matches the inline implementation that
 * previously lived in `App.tsx` (`handleReorderProjects`,
 * `runReorderRef`, `reorderResetSignal`, `pendingProjectReorderCount`).
 */
export function useProjectReorder({
  onError,
}: UseProjectReorderInput): ProjectReorderControl {
  const [reorderResetSignal, setReorderResetSignal] = useState(0);
  const [pendingProjectReorderCount, setPendingProjectReorderCount] =
    useState(0);
  const runReorderRef = useRef(createSerializedRunner());

  const reorder = useCallback(
    async (ids: string[]) => {
      setPendingProjectReorderCount((n) => n + 1);
      try {
        await runReorderRef.current(async () => {
          let failed = false;
          try {
            const res = await authFetch("/api/projects/order", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids }),
            });
            if (!res.ok) failed = true;
          } catch (error) {
            if (error instanceof AuthExpiredError) return;
            failed = true;
          }
          if (failed) {
            setReorderResetSignal((tick) => tick + 1);
            onError(
              "Failed to reorder projects -- reverted to previous order.",
            );
          }
        });
      } finally {
        setPendingProjectReorderCount((n) => Math.max(0, n - 1));
      }
    },
    [onError],
  );

  return {
    reorderResetSignal,
    pendingProjectReorderCount,
    reorder,
  };
}
