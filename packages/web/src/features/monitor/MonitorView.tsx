import type {
  AgentState,
  AgentStatusContext,
  GitState,
  Project,
  Session,
} from "@parasor/shared";
import { deriveAgentStatusContext } from "@parasor/shared";
import {
  lazy,
  type Ref,
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AgentDot,
  type AgentDotState,
  MonitorSwitchButton,
  PaGlyph,
  PaneIconButton,
} from "../../components/primitives/index.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { displayTitleForTerminal } from "../../lib/session-title.js";
import {
  type AttentionDismissals,
  isAttentionDismissed,
} from "../workspace/useAttentionDismissals.js";
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

const MIN_AGENT_COL_PX = 380;

interface MonitorVisibleRange {
  start: number;
  end: number;
}

export function computeMonitorColumnLayout(
  containerWidth: number,
  entryCount: number,
): { visibleColumns: number; columnWidth: number } {
  const safeEntryCount = Number.isFinite(entryCount)
    ? Math.max(0, Math.floor(entryCount))
    : 0;
  if (safeEntryCount === 0) {
    return { visibleColumns: 0, columnWidth: MIN_AGENT_COL_PX };
  }
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { visibleColumns: 1, columnWidth: MIN_AGENT_COL_PX };
  }
  const visibleColumns = Math.min(
    safeEntryCount,
    Math.max(1, Math.floor(containerWidth / MIN_AGENT_COL_PX)),
  );
  return {
    visibleColumns,
    columnWidth: Math.floor(containerWidth / visibleColumns),
  };
}

export function computeMonitorVisibleRange(
  scrollLeft: number,
  viewportWidth: number,
  columnWidth: number,
  entryCount: number,
): MonitorVisibleRange {
  const safeEntryCount = Number.isFinite(entryCount)
    ? Math.max(0, Math.floor(entryCount))
    : 0;
  if (safeEntryCount === 0) {
    return { start: 0, end: -1 };
  }
  if (
    !Number.isFinite(scrollLeft) ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(columnWidth) ||
    viewportWidth <= 0 ||
    columnWidth <= 0
  ) {
    return { start: 0, end: 0 };
  }
  const viewportStart = Math.max(0, scrollLeft);
  const viewportEnd = viewportStart + viewportWidth;
  const minVisibleWidth = columnWidth / 2;
  let start = -1;
  let end = -1;
  for (let index = 0; index < safeEntryCount; index += 1) {
    const columnStart = index * columnWidth;
    const columnEnd = columnStart + columnWidth;
    const visibleWidth =
      Math.min(columnEnd, viewportEnd) - Math.max(columnStart, viewportStart);
    if (visibleWidth >= minVisibleWidth) {
      if (start < 0) start = index;
      end = index;
    }
  }
  if (start < 0) {
    const fallback = Math.min(
      safeEntryCount - 1,
      Math.max(0, Math.floor(viewportStart / columnWidth)),
    );
    return { start: fallback, end: fallback };
  }
  return { start, end };
}

function useMeasuredElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      setWidth(Math.round(el.getBoundingClientRect().width));
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/**
 * Cross-project read-only live tail for pinned terminals. Desktop lays out
 * as many readable columns as fit the viewport; mobile = single-column pager.
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

  const statusContexts = useMemo(() => {
    const dismissed = attentionDismissed ?? {};
    const map = new Map<string, AgentStatusContext>();
    for (const entry of pinned) {
      const state = agentStates[entry.session.id];
      const context = deriveAgentStatusContext({
        session: entry.session,
        agentState: state,
      });
      map.set(
        entry.session.id,
        normalizeDismissedContext(context, state, dismissed),
      );
    }
    return map;
  }, [pinned, agentStates, attentionDismissed]);

  const statuses = useMemo(() => {
    const map = new Map<string, AgentDotState>();
    for (const entry of pinned) {
      map.set(
        entry.session.id,
        livenessToStatus(
          statusContexts.get(entry.session.id)?.state,
          reviewPendingSessions.has(entry.session.id),
        ),
      );
    }
    return map;
  }, [pinned, reviewPendingSessions, statusContexts]);

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
  const [visibleRange, setVisibleRange] = useState<MonitorVisibleRange>({
    start: 0,
    end: 0,
  });
  const headerVisibleRange = isMobile
    ? { start: focusedIndex, end: focusedIndex }
    : visibleRange;

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
        visibleRange={headerVisibleRange}
        onGoToIndex={goToIndex}
      />
      {pinned.length === 0 ? (
        <MonitorEmpty />
      ) : isMobile ? (
        <MonitorPaged
          entries={pinned}
          statuses={statuses}
          statusContexts={statusContexts}
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
          statusContexts={statusContexts}
          focusedSessionId={
            focusedSessionId ?? pinned[focusedIndex]?.session.id ?? null
          }
          focusedIndex={focusedIndex}
          onVisibleRangeChange={setVisibleRange}
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
  visibleRange: MonitorVisibleRange;
  onGoToIndex: (index: number) => void;
}

function MonitorHeader({
  attention,
  working,
  isMobile,
  onToggleDrawer,
  entries,
  focusedIndex,
  visibleRange,
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
          visibleRange={visibleRange}
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
  visibleRange,
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
          <MonitorPagerDot
            key={e.session.id}
            index={i}
            focused={i === focusedIndex}
            visible={i >= visibleRange.start && i <= visibleRange.end}
            onGoToIndex={onGoToIndex}
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

function MonitorPagerDot({
  index,
  focused,
  visible,
  onGoToIndex,
}: {
  index: number;
  focused: boolean;
  visible: boolean;
  onGoToIndex: (index: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onGoToIndex(index)}
      aria-label={`Go to pinned terminal ${index + 1}`}
      aria-current={focused ? "true" : undefined}
      className={`h-[5px] cursor-pointer rounded-control transition-all ${
        focused
          ? "w-3.5 bg-accent"
          : visible
            ? "w-[5px] bg-accent"
            : "w-[5px] bg-text-secondary/25 hover:bg-text-secondary/55"
      }`}
    />
  );
}

interface ColumnsProps {
  entries: PinnedTerminalEntry[];
  statuses: Map<string, AgentDotState>;
  statusContexts: Map<string, AgentStatusContext>;
  focusedSessionId: string | null;
  focusedIndex: number;
  onVisibleRangeChange: (range: MonitorVisibleRange) => void;
  onFocusSession: (sessionId: string | null) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
}

function MonitorColumns({
  entries,
  statuses,
  statusContexts,
  focusedSessionId,
  focusedIndex,
  onVisibleRangeChange,
  onFocusSession,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: ColumnsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerWidth = useMeasuredElementWidth(scrollRef);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { columnWidth } = computeMonitorColumnLayout(
    containerWidth,
    entries.length,
  );
  const [edgeState, setEdgeState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateViewportState = () => {
      const nextRange = computeMonitorVisibleRange(
        el.scrollLeft,
        el.clientWidth,
        columnWidth,
        entries.length,
      );
      onVisibleRangeChange(nextRange);

      const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      setEdgeState({
        canScrollLeft: el.scrollLeft > 1,
        canScrollRight: el.scrollLeft < maxScrollLeft - 1,
      });
    };

    updateViewportState();
    el.addEventListener("scroll", updateViewportState, { passive: true });
    return () => el.removeEventListener("scroll", updateViewportState);
  }, [columnWidth, entries.length, onVisibleRangeChange]);
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

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="cm-scroll absolute inset-0 flex flex-row items-stretch justify-start overflow-x-auto overflow-y-hidden"
      >
        {entries.map((entry, i) => {
          return (
            <MonitorColumn
              key={entry.session.id}
              ref={(el) => {
                columnRefs.current[i] = el;
              }}
              entry={entry}
              status={statuses.get(entry.session.id) ?? "idle"}
              statusContext={statusContexts.get(entry.session.id)}
              focused={focusedSessionId === entry.session.id}
              width={columnWidth}
              onFocus={() => onFocusSession(entry.session.id)}
              onRestartSession={onRestartSession}
              onOpenUrl={onOpenUrl}
              onTogglePin={onTogglePin}
            />
          );
        })}
      </div>
      {edgeState.canScrollLeft && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 left-0 w-10"
          style={{
            background:
              "linear-gradient(to right, var(--color-bg-primary), transparent)",
          }}
        />
      )}
      {edgeState.canScrollRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 bottom-0 w-10"
          style={{
            background:
              "linear-gradient(to left, var(--color-bg-primary), transparent)",
          }}
        />
      )}
    </div>
  );
}

interface ColumnProps {
  entry: PinnedTerminalEntry;
  status: AgentDotState;
  statusContext?: AgentStatusContext;
  focused: boolean;
  width: number;
  onFocus: () => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onTogglePin: (sessionId: string) => Promise<void> | void;
  ref?: Ref<HTMLDivElement>;
}

function MonitorColumn({
  ref,
  entry,
  status,
  statusContext,
  focused,
  width,
  onFocus,
  onRestartSession,
  onOpenUrl,
  onTogglePin,
}: ColumnProps) {
  return (
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
        statusContext={statusContext}
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
  );
}

interface FullWidthColumnProps {
  entry: PinnedTerminalEntry;
  status: AgentDotState;
  statusContext?: AgentStatusContext;
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
  statusContext,
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
        statusContext={statusContext}
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
  statusContext?: AgentStatusContext;
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
  statusContext,
  onTogglePin,
}: ColumnHeaderProps) {
  return (
    <div className="flex h-bar shrink-0 items-center gap-2 border-b border-border bg-pane-header-bg px-3">
      <MonitorPath entry={entry} />
      {status !== "idle" && (
        <AgentDot state={status} title={statusContext?.reason} />
      )}
      <MonitorSwitchButton
        pressed={true}
        className="bg-bg-secondary"
        onClick={() => void onTogglePin(entry.session.id)}
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
  statusContexts: Map<string, AgentStatusContext>;
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
  statusContexts,
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
        statusContext={statusContexts.get(entry.session.id)}
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

function livenessToStatus(
  liveness: AgentStatusContext["state"] | undefined,
  inReview: boolean,
): AgentDotState {
  if (inReview) return "review";
  if (liveness === "waiting_for_user") return "attention";
  if (liveness === "active") return "working";
  return "idle";
}

function normalizeDismissedContext(
  context: AgentStatusContext,
  agentState: AgentState | undefined,
  dismissed: AttentionDismissals,
): AgentStatusContext {
  if (
    context.state === "waiting_for_user" &&
    isAttentionDismissed(agentState, dismissed)
  ) {
    return {
      ...context,
      state: "idle",
      reason: "Waiting status already viewed",
    };
  }
  return context;
}
