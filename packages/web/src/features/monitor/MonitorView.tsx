import type {
  AgentLifecycle,
  AgentState,
  GitState,
  Project,
  Session,
} from "@parasor/shared";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AgentDot,
  type AgentDotState,
  PaGlyph,
  PaneIconButton,
} from "../../components/primitives/index.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { displayTitleForTerminal } from "../../lib/session-title.js";
import {
  type AttentionDismissals,
  isAttentionDismissed,
} from "../workspace/useAttentionDismissals.js";
import { PinToggleButton } from "../workspace/views/PinToggleButton.js";
import {
  collectPinnedTerminals,
  type PinnedTerminalEntry,
} from "./monitor-model.js";

const LazyTerminalPane = lazy(() =>
  import("../panes/terminal/TerminalPane.js").then(({ TerminalPane }) => ({
    default: TerminalPane,
  })),
);

interface MonitorViewProps {
  projects: Project[];
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  reviewPendingSessions: Set<string>;
  /**
   * Per-project per-worktree git poll snapshots, mirroring
   * `store.gitStates`. Threaded through so non-repo project roots render
   * `root` instead of `main` (parity with sidebar / pane header).
   */
  gitStates?: Record<string, Record<string, GitState | null>>;
  /**
   * Suppress the `attention` badge for sessions whose latest `waiting`
   * event was already viewed (focused pane match in the workspace view).
   * Shared with the sidebar so dismissal stays consistent across surfaces.
   */
  attentionDismissed?: AttentionDismissals;
  isMobile: boolean;
  onToggleDrawer?: () => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
}

const MIN_COL_PX = 320;
const MAX_COL_PX = 1200;
const DEFAULT_COL_PX = 420;
const COL_WIDTHS_KEY = "parasor:monitor-col-widths";

function clampColWidth(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_COL_PX;
  return Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Math.round(n)));
}

function loadColWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number") out[k] = clampColWidth(v);
    }
    return out;
  } catch {
    return {};
  }
}

function saveColWidths(widths: Record<string, number>): void {
  try {
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    /* quota or disabled storage -- non-fatal */
  }
}

/**
 * Cross-project read-only live tail for pinned terminals. Desktop =
 * horizontal-scroll fixed-width columns (Tweetdeck lanes); mobile =
 * single-column pager.
 */
export function MonitorView({
  projects,
  sessions,
  agentStates,
  reviewPendingSessions,
  gitStates,
  attentionDismissed,
  isMobile,
  onToggleDrawer,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: MonitorViewProps) {
  const pinned = useMemo(
    () => collectPinnedTerminals(projects, sessions, gitStates),
    [projects, sessions, gitStates],
  );

  const statuses = useMemo(() => {
    const dismissed = attentionDismissed ?? {};
    const map = new Map<string, AgentDotState>();
    for (const entry of pinned) {
      const state = agentStates[entry.session.id];
      const lifecycle = isAttentionDismissed(state, dismissed)
        ? undefined
        : state?.lifecycle;
      map.set(
        entry.session.id,
        lifecycleToStatus(
          lifecycle,
          reviewPendingSessions.has(entry.session.id),
        ),
      );
    }
    return map;
  }, [pinned, agentStates, reviewPendingSessions, attentionDismissed]);

  const rollup = useMemo(() => {
    let attention = 0;
    let working = 0;
    for (const status of statuses.values()) {
      if (status === "attention") attention += 1;
      else if (status === "working") working += 1;
    }
    return { attention, working };
  }, [statuses]);

  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const focusedIndex = useMemo(() => {
    if (!focusedSessionId) return 0;
    const i = pinned.findIndex((e) => e.session.id === focusedSessionId);
    return i < 0 ? 0 : i;
  }, [pinned, focusedSessionId]);

  const goToIndex = (i: number) => {
    const next = pinned[Math.max(0, Math.min(pinned.length - 1, i))];
    if (next) setFocusedSessionId(next.session.id);
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-bg-primary">
      <MonitorHeader
        attention={rollup.attention}
        working={rollup.working}
        isMobile={isMobile}
        onToggleDrawer={onToggleDrawer}
        entries={pinned}
        focusedIndex={focusedIndex}
        onGoToIndex={goToIndex}
      />
      {pinned.length === 0 ? (
        <MonitorEmpty />
      ) : isMobile ? (
        <MonitorPaged
          entries={pinned}
          statuses={statuses}
          focusedIndex={focusedIndex}
          onFocusSession={setFocusedSessionId}
          onRestartSession={onRestartSession}
          onOpenUrl={onOpenUrl}
          onTogglePin={onTogglePin}
        />
      ) : (
        <MonitorColumns
          entries={pinned}
          statuses={statuses}
          focusedSessionId={
            focusedSessionId ?? pinned[focusedIndex]?.session.id ?? null
          }
          focusedIndex={focusedIndex}
          onFocusSession={setFocusedSessionId}
          onRestartSession={onRestartSession}
          onOpenUrl={onOpenUrl}
          onTogglePin={onTogglePin}
        />
      )}
    </section>
  );
}

interface MonitorHeaderProps {
  attention: number;
  working: number;
  isMobile: boolean;
  onToggleDrawer?: () => void;
  entries: PinnedTerminalEntry[];
  focusedIndex: number;
  onGoToIndex: (index: number) => void;
}

function MonitorHeader({
  attention,
  working,
  isMobile,
  onToggleDrawer,
  entries,
  focusedIndex,
  onGoToIndex,
}: MonitorHeaderProps) {
  const count = entries.length;
  return (
    <header className="flex h-bar shrink-0 items-center gap-2.5 border-b border-border bg-pane-header-bg px-3">
      {isMobile && onToggleDrawer && (
        <PaneIconButton
          onClick={onToggleDrawer}
          label="Go to sessions"
          size="md"
        >
          <PaGlyph.menu />
        </PaneIconButton>
      )}
      <span className="text-sm font-semibold tracking-[-0.005em] text-text-primary">
        Monitor
      </span>
      <div className="cm-mono flex items-center gap-2 text-sm text-text-secondary">
        {attention > 0 && (
          <span className="inline-flex items-center gap-1">
            <AgentDot state="attention" />
            <span>{attention}</span>
          </span>
        )}
        {working > 0 && (
          <span className="inline-flex items-center gap-1">
            <AgentDot state="working" />
            <span>{working}</span>
          </span>
        )}
      </div>
      <span className="flex-1" />
      {count > 0 && (
        <MonitorPager
          entries={entries}
          focusedIndex={focusedIndex}
          onGoToIndex={onGoToIndex}
        />
      )}
    </header>
  );
}

interface MonitorPagerProps {
  entries: PinnedTerminalEntry[];
  focusedIndex: number;
  onGoToIndex: (index: number) => void;
}

function MonitorPager({
  entries,
  focusedIndex,
  onGoToIndex,
}: MonitorPagerProps) {
  const count = entries.length;
  const atStart = focusedIndex <= 0;
  const atEnd = focusedIndex >= count - 1;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <PaneIconButton
        onClick={() => onGoToIndex(focusedIndex - 1)}
        disabled={atStart}
        label="Previous pinned terminal"
      >
        <PaGlyph.back />
      </PaneIconButton>
      <div className="flex items-center gap-[5px]">
        {entries.map((e, i) => (
          <button
            key={e.session.id}
            type="button"
            onClick={() => onGoToIndex(i)}
            aria-label={`Go to pinned terminal ${i + 1}`}
            aria-current={i === focusedIndex ? "true" : undefined}
            className={`h-[5px] cursor-pointer rounded-control transition-all ${
              i === focusedIndex
                ? "w-3.5 bg-accent"
                : "w-[5px] bg-text-secondary/35 hover:bg-text-secondary/60"
            }`}
          />
        ))}
      </div>
      <PaneIconButton
        onClick={() => onGoToIndex(focusedIndex + 1)}
        disabled={atEnd}
        label="Next pinned terminal"
      >
        <span className="rotate-180 inline-flex">
          <PaGlyph.back />
        </span>
      </PaneIconButton>
    </div>
  );
}

interface ColumnsProps {
  entries: PinnedTerminalEntry[];
  statuses: Map<string, AgentDotState>;
  focusedSessionId: string | null;
  focusedIndex: number;
  onFocusSession: (sessionId: string | null) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
}

function MonitorColumns({
  entries,
  statuses,
  focusedSessionId,
  focusedIndex,
  onFocusSession,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: ColumnsProps) {
  const overflow = Math.max(0, entries.length - 3);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Pager / column-click -> focus moves -> ensure the focused column is in
  // view. `inline:'nearest'` keeps the column from re-centering when it
  // is already partially visible, matching the user's expectation that
  // pager nudges the viewport just enough to surface the next pane.
  useEffect(() => {
    void focusedSessionId;
    const el = columnRefs.current[focusedIndex];
    if (!el) return;
    el.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [focusedIndex, focusedSessionId]);

  const [widths, setWidths] = useState<Record<string, number>>(loadColWidths);

  // Debounce persistence: drag fires onResize per pointermove; commit once idle.
  useEffect(() => {
    const id = setTimeout(() => saveColWidths(widths), 200);
    return () => clearTimeout(id);
  }, [widths]);

  const setSessionWidth = useCallback((sessionId: string, w: number) => {
    setWidths((prev) => {
      const next = clampColWidth(w);
      if (prev[sessionId] === next) return prev;
      return { ...prev, [sessionId]: next };
    });
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div className="cm-scroll absolute inset-0 flex flex-row items-stretch justify-start overflow-x-auto overflow-y-hidden">
        {entries.map((entry, i) => {
          const width = widths[entry.session.id] ?? DEFAULT_COL_PX;
          return (
            <MonitorColumn
              key={entry.session.id}
              ref={(el) => {
                columnRefs.current[i] = el;
              }}
              entry={entry}
              status={statuses.get(entry.session.id) ?? "idle"}
              focused={focusedSessionId === entry.session.id}
              width={width}
              onFocus={() => onFocusSession(entry.session.id)}
              onResize={(w) => setSessionWidth(entry.session.id, w)}
              onRestartSession={onRestartSession}
              onOpenUrl={onOpenUrl}
              onTogglePin={onTogglePin}
            />
          );
        })}
      </div>
      {overflow > 0 && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 bottom-0 w-14"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--color-bg-primary))",
            }}
          />
          <div
            aria-hidden
            className="cm-mono pointer-events-none absolute top-2 right-2 rounded-tag border border-border bg-bg-tertiary px-2 py-px text-xs text-text-secondary"
          >
            {"->"} {overflow} more
          </div>
        </>
      )}
    </div>
  );
}

interface ColumnProps {
  entry: PinnedTerminalEntry;
  status: AgentDotState;
  focused: boolean;
  width: number;
  onFocus: () => void;
  onResize: (width: number) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
  ref?: React.Ref<HTMLDivElement>;
}

function MonitorColumn({
  ref,
  entry,
  status,
  focused,
  width,
  onFocus,
  onResize,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: ColumnProps) {
  const resizerLabel = `Resize column for ${displayTitleForTerminal(entry.session)}`;
  return (
    <>
      <div
        ref={ref}
        className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-bg-primary"
        style={{ width: `${width}px` }}
        onPointerDownCapture={onFocus}
        onFocusCapture={onFocus}
      >
        <MonitorColumnHeader
          entry={entry}
          status={status}
          onTogglePin={onTogglePin}
        />
        {/* touch-pan-y: xterm 6.1 attaches non-passive document touch listeners; iOS needs this to keep momentum scroll on the compositor. */}
        <div className="min-h-0 flex-1 touch-pan-y">
          <Suspense fallback={<div className="h-full bg-bg-terminal" />}>
            <LazyTerminalPane
              paneId={`monitor:${entry.session.id}`}
              sessionId={entry.session.id}
              session={entry.session}
              onRestartSession={onRestartSession}
              onOpenUrl={onOpenUrl}
            />
          </Suspense>
        </div>
        {/* Overlay so the focus ring paints on top of the xterm canvas. */}
        {focused && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 border-2 border-accent"
          />
        )}
      </div>
      <MonitorColumnResizer
        width={width}
        onResize={onResize}
        ariaLabel={resizerLabel}
      />
    </>
  );
}

interface ResizerProps {
  width: number;
  onResize: (width: number) => void;
  ariaLabel: string;
}

/**
 * Drag handle on the right edge of each Monitor column. Uses the same
 * className/handler shape as `Split2Col` so the visual + keyboard +
 * pointer-capture story stays identical across files / git / monitor.
 * `touch-action: none` keeps the gesture from competing with the parent
 * `overflow-x-auto` scroll on touch devices.
 */
function MonitorColumnResizer({ width, onResize, ariaLabel }: ResizerProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const stopDrag = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (!e) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // Drop the drag if the primary button was released outside the capture window.
      if (e.buttons === 0) {
        stopDrag(e);
        return;
      }
      const next = startWidthRef.current + (e.clientX - startXRef.current);
      onResize(next);
    },
    [onResize, stopDrag],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      const step = e.shiftKey ? 50 : 10;
      onResize(width + delta * step);
    },
    [onResize, width],
  );

  return (
    <hr
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_COL_PX}
      aria-valuemax={MAX_COL_PX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onKeyDown={onKeyDown}
      style={{ touchAction: "none" }}
      className="cm-split-resizer relative z-[2] w-px shrink-0 cursor-col-resize bg-border before:absolute before:inset-y-0 before:-inset-x-3 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    />
  );
}

interface FullWidthColumnProps {
  entry: PinnedTerminalEntry;
  status: AgentDotState;
  onFocus: () => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
}

/**
 * Mobile pager renders one pinned terminal at full width. Unlike the
 * desktop column, there is no focus overlay -- the visible page is the
 * focus by definition, and a 2px accent border at the screen edge would
 * read as visual noise.
 */
function MonitorColumnFullWidth({
  entry,
  status,
  onFocus,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: FullWidthColumnProps) {
  return (
    /*
     * `min-w-0 overflow-hidden`: TerminalPane's xterm sets an explicit
     * pixel width on `.xterm-screen` from the previous PTY's cols. When
     * that intrinsic width exceeds the page slot, flex `min-width:auto`
     * lets the column expand to ~cols×cellWidth, then fitAddon's 100ms
     * debounced ResizeObserver shrinks ~2 cols per fire -- a visible
     * step-resize that drags on for ~1.5s. Capping min-width here lets
     * the first fit() lock to the slot in one frame.
     */
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-primary"
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <MonitorColumnHeader
        entry={entry}
        status={status}
        onTogglePin={onTogglePin}
      />
      <div className="min-h-0 flex-1 touch-pan-y">
        <Suspense fallback={<div className="h-full bg-bg-terminal" />}>
          <LazyTerminalPane
            paneId={`monitor:${entry.session.id}`}
            sessionId={entry.session.id}
            session={entry.session}
            onRestartSession={onRestartSession}
            onOpenUrl={onOpenUrl}
          />
        </Suspense>
      </div>
    </div>
  );
}

interface ColumnHeaderProps {
  entry: PinnedTerminalEntry;
  status: AgentDotState;
  onTogglePin: (sessionId: string) => Promise<void> | void;
}

/**
 * Column chrome aligned with the standard PaneHeader (h-bar / pane-header
 * bg / icon size 16). Path crumb on the left, agent status dot + pin
 * toggle on the right. No attention chrome -- Monitor reflects whatever
 * the underlying terminal already shows. Clicking the pin removes the
 * session from Monitor.
 */
function MonitorColumnHeader({
  entry,
  status,
  onTogglePin,
}: ColumnHeaderProps) {
  return (
    <div className="flex h-bar shrink-0 items-center gap-2 border-b border-border bg-pane-header-bg px-3">
      <MonitorPath entry={entry} />
      {status !== "idle" && <AgentDot state={status} />}
      <PinToggleButton
        pinned={true}
        onToggle={() => void onTogglePin(entry.session.id)}
      />
    </div>
  );
}

function MonitorPath({ entry }: { entry: PinnedTerminalEntry }) {
  const projectName = entry.project?.name ?? "";
  const worktreeName = entry.worktreeName;
  const childLabel = displayTitleForTerminal(entry.session);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className="cm-mono min-w-0 flex-shrink truncate text-sm text-text-secondary/85"
        title={projectName}
      >
        {projectName}
      </span>
      <span aria-hidden className="text-text-secondary/40">
        /
      </span>
      <span
        className="cm-mono min-w-0 flex-shrink truncate text-sm text-text-secondary/85"
        title={worktreeName}
      >
        {worktreeName}
      </span>
      <span aria-hidden className="text-text-secondary/40">
        /
      </span>
      <span
        className="cm-mono min-w-0 flex-shrink truncate text-sm font-semibold text-text-primary"
        title={childLabel}
      >
        {childLabel}
      </span>
    </div>
  );
}

interface PagedProps {
  entries: PinnedTerminalEntry[];
  statuses: Map<string, AgentDotState>;
  focusedIndex: number;
  onFocusSession: (sessionId: string | null) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
}

/**
 * Mobile single-lane pager. Top pager bar keeps the dot indicator above
 * the soft keyboard; the lane below fills edge-to-edge.
 */
function MonitorPaged({
  entries,
  statuses,
  focusedIndex,
  onFocusSession,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: PagedProps) {
  const entry = entries[focusedIndex];
  if (!entry) return null;
  return (
    <div className="flex min-h-0 flex-1">
      <MonitorColumnFullWidth
        entry={entry}
        status={statuses.get(entry.session.id) ?? "idle"}
        onFocus={() => onFocusSession(entry.session.id)}
        onRestartSession={onRestartSession}
        onOpenUrl={onOpenUrl}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}

function MonitorEmpty() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-bg-primary p-8 text-center">
      <div className="max-w-md">
        <div className="mb-2 text-sm font-semibold text-text-primary">
          No pinned terminals yet
        </div>
        <p className="cm-mono text-sm leading-relaxed text-text-secondary">
          Tap the{" "}
          <span className="inline-flex translate-y-[2px] items-center text-accent">
            <PaGlyph.pin />
          </span>{" "}
          icon in a terminal header to surface it here. Monitor gives you a live
          tail of every pinned session across projects at once.
        </p>
      </div>
    </div>
  );
}

function lifecycleToStatus(
  lifecycle: AgentLifecycle | undefined,
  inReview: boolean,
): AgentDotState {
  if (inReview) return "review";
  if (lifecycle === "waiting") return "attention";
  if (lifecycle === "running") return "working";
  return "idle";
}
