import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "parasor:shell-ratio:workspace";
const DEFAULT_NAV_PCT = 24;
const MIN_NAV_PX = 240;
const MAX_NAV_PX = 520;
const MAX_NAV_PCT = 45;

function clampPercent(pct: number, containerWidth?: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_NAV_PCT;
  let minPct = 12;
  let maxPct = MAX_NAV_PCT;
  if (containerWidth && containerWidth > 0) {
    minPct = Math.max(minPct, (MIN_NAV_PX / containerWidth) * 100);
    maxPct = Math.min(maxPct, (MAX_NAV_PX / containerWidth) * 100);
  }
  return Math.min(maxPct, Math.max(minPct, pct));
}

function loadRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NAV_PCT;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "number" ? clampPercent(parsed) : DEFAULT_NAV_PCT;
  } catch {
    return DEFAULT_NAV_PCT;
  }
}

function saveRatio(pct: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pct));
  } catch {
    /* localStorage can be unavailable under privacy mode. */
  }
}

interface AppShellSplitProps {
  navigation: React.ReactNode;
  main: React.ReactNode;
}

export function AppShellSplit({ navigation, main }: AppShellSplitProps) {
  const [navPct, setNavPct] = useState(loadRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    saveRatio(navPct);
  }, [navPct]);

  const setClampedNavPct = useCallback((next: number) => {
    const width = containerRef.current?.getBoundingClientRect().width;
    setNavPct(clampPercent(next, width));
  }, []);

  const navStyle = useMemo(
    () => ({
      width: `${navPct}%`,
      minWidth: `${MIN_NAV_PX}px`,
      maxWidth: `${MAX_NAV_PX}px`,
    }),
    [navPct],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLHRElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLHRElement>) => {
      if (!draggingRef.current) return;
      if (e.buttons === 0) {
        draggingRef.current = false;
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setClampedNavPct(((e.clientX - rect.left) / rect.width) * 100);
    },
    [setClampedNavPct],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLHRElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLHRElement>) => {
      if (
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "Home" &&
        e.key !== "End"
      ) {
        return;
      }
      e.preventDefault();
      if (e.key === "Home") {
        setClampedNavPct(0);
        return;
      }
      if (e.key === "End") {
        setClampedNavPct(100);
        return;
      }
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      const step = e.shiftKey ? 5 : 1;
      setClampedNavPct(navPct + delta * step);
    },
    [navPct, setClampedNavPct],
  );

  return (
    <div
      ref={containerRef}
      className="flex h-full min-w-0 flex-1 flex-row overflow-hidden"
    >
      <div className="min-w-0 overflow-hidden bg-bg-secondary" style={navStyle}>
        {navigation}
      </div>
      <hr
        aria-label="Resize navigation pane"
        aria-orientation="vertical"
        aria-valuenow={Math.round(navPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="cm-split-resizer relative z-[2] w-px shrink-0 cursor-col-resize bg-border before:absolute before:inset-y-0 before:-inset-x-3 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {main}
      </div>
    </div>
  );
}
