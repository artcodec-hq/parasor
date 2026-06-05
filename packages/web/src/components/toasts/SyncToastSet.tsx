import {
  dismissSyncToast,
  type SyncToast,
  type SyncToastTone,
  useSyncToasts,
} from "../../lib/sync-toast.js";
import { PaButton, PaGlyph } from "../primitives/index.js";

const DOT_TONE: Record<SyncToastTone, string> = {
  info: "bg-accent",
  working: "bg-warning",
  ok: "bg-success",
  err: "bg-danger",
};

/**
 * Stacked sync-status toasts (push / pull / fetch progress + outcomes).
 * Bottom-right column on desktop, bottom-center on mobile. Each entry
 * is keyed by id so callers can transition `working -> ok/err` in place.
 */
export function SyncToastSet() {
  const toasts = useSyncToasts();
  if (toasts.length === 0) return null;
  return (
    <section
      aria-label="sync status"
      className="pointer-events-none fixed right-[max(env(safe-area-inset-right,0px),16px)] bottom-[max(env(safe-area-inset-bottom,0px),16px)] z-[55] flex w-[min(var(--spacing-surface-sm),calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </section>
  );
}

function ToastRow({ toast }: { toast: SyncToast }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-start gap-2.5 rounded-window border border-border bg-bg-secondary px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
    >
      <span
        aria-hidden
        className={`mt-[5px] h-2 w-2 flex-none rounded-tag ${DOT_TONE[toast.tone]} ${
          toast.tone === "working" ? "animate-pulse" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-[-0.005em] text-text-primary">
          {toast.title}
        </div>
        {toast.sub && (
          <div
            className={`mt-0.5 text-xs text-text-secondary ${
              toast.mono ? "cm-mono" : ""
            }`}
          >
            {toast.sub}
          </div>
        )}
        {toast.actions && toast.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {toast.actions.map((a) => (
              <PaButton
                key={`${a.kind ?? "ghost"}:${a.label}`}
                kind={a.kind === "primary" ? "submit" : "normal"}
                size="xs"
                onClick={a.onSelect}
              >
                {a.label}
              </PaButton>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissSyncToast(toast.id)}
        className="-m-1 p-1 text-text-secondary hover:text-text-primary"
      >
        <PaGlyph.close />
      </button>
    </div>
  );
}
