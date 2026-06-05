import { useCopyToast } from "../../lib/copy-toast.js";

/**
 * Renders the global copy-toast subscribed to `useCopyToast`. One-line, fixed
 * bottom-center, fades out automatically (durationMs configured at the call
 * site).
 */
export function CopyToast() {
  const toast = useCopyToast();
  if (!toast) return null;
  return (
    <div
      key={toast.seq}
      role="status"
      aria-live="polite"
      className="cm-mono pointer-events-none fixed bottom-[max(env(safe-area-inset-bottom,0px),16px)] left-1/2 z-[60] -translate-x-1/2 rounded-window border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
    >
      {toast.message}
    </div>
  );
}
