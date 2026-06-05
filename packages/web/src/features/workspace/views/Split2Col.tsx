import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-column split with a draggable divider and localStorage-backed ratio
 * persistence. On mobile the layout collapses to stacked navigation: the
 * `primary` view is shown by default, and once the caller flips
 * `secondaryActive` we render the `secondary` full-bleed. Back navigation
 * is delegated to the surrounding chrome (SessionPaneHeader) -- no inner
 * back row is rendered on mobile.
 */

const MIN_COL_PCT = 15;
const MAX_COL_PCT = 85;

function ratioStorageKey(storageKey: string): string {
  return `parasor:pane-ratio:${storageKey}`;
}

function clampRatio(a: number): number {
  if (Number.isNaN(a)) return MIN_COL_PCT;
  return Math.min(MAX_COL_PCT, Math.max(MIN_COL_PCT, a));
}

function loadRatio(
  storageKey: string,
  fallback: [number, number],
): [number, number] {
  try {
    const raw = localStorage.getItem(ratioStorageKey(storageKey));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return fallback;
    const [a, b] = parsed;
    if (typeof a !== "number" || typeof b !== "number") return fallback;
    const pct = clampRatio((a / (a + b)) * 100);
    return [pct, 100 - pct];
  } catch {
    return fallback;
  }
}

function saveRatio(storageKey: string, ratio: [number, number]): void {
  try {
    localStorage.setItem(ratioStorageKey(storageKey), JSON.stringify(ratio));
  } catch {
    /* quota or disabled storage -- non-fatal */
  }
}

interface Split2ColProps {
  storageKey: string;
  defaultRatio: [number, number];
  primary: React.ReactNode;
  secondary: React.ReactNode;
  isMobile: boolean;
  /** Mobile stacked nav: when true, render secondary full-bleed. */
  secondaryActive?: boolean;
}

export function Split2Col({
  storageKey,
  defaultRatio,
  primary,
  secondary,
  isMobile,
  secondaryActive = false,
}: Split2ColProps) {
  const [ratio, setRatio] = useState<[number, number]>(() =>
    loadRatio(storageKey, defaultRatio),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    saveRatio(storageKey, ratio);
  }, [storageKey, ratio]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const a = clampRatio(pct);
    setRatio([a, 100 - a]);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onSeparatorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      const step = e.shiftKey ? 5 : 1;
      setRatio(([a]) => {
        const next = clampRatio(a + delta * step);
        return [next, 100 - next];
      });
    },
    [],
  );

  if (isMobile) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {secondaryActive ? secondary : primary}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="cm-worktree-split flex h-full w-full flex-row overflow-hidden"
    >
      <div
        className="cm-split-left min-w-0 overflow-hidden bg-bg-secondary"
        style={{ width: `${ratio[0]}%` }}
      >
        {primary}
      </div>
      <hr
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio[0])}
        aria-valuemin={MIN_COL_PCT}
        aria-valuemax={MAX_COL_PCT}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onSeparatorKeyDown}
        className="cm-split-resizer relative z-[2] w-px shrink-0 cursor-col-resize bg-border before:absolute before:inset-y-0 before:-inset-x-3 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div
        className="cm-split-right min-w-0 flex-1 overflow-hidden"
        style={{ width: `${ratio[1]}%` }}
      >
        {secondary}
      </div>
    </div>
  );
}
