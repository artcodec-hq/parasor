import { useEffect, useState } from "react";

/**
 * Transient toast message that auto-clears after {@link autoDismissMs} ms.
 * Returns the current message (`null` = hidden) and a setter; passing `null`
 * to the setter clears immediately and cancels the pending timeout.
 *
 * Behavior-preserving extraction of the inline `errorToast` state and its
 * timeout effect from `App.tsx`. The timer is bound to the message identity
 * -- a fresh `setMessage(next)` while one is already showing restarts the
 * 5s window, matching the original effect's `[errorToast]` re-fire.
 */
export function useErrorToast(
  autoDismissMs = 5000,
): readonly [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const handle = window.setTimeout(() => setMessage(null), autoDismissMs);
    return () => window.clearTimeout(handle);
  }, [message, autoDismissMs]);

  return [message, setMessage] as const;
}
