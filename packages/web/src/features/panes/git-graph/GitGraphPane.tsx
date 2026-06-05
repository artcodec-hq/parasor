import type { GitCommit, GitRef, SwimlaneSnapshot } from "@parasor/shared";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ActionItem,
  FloatingActionMenu,
  PaGlyph,
  PaneFooter,
  PaneIconButton,
} from "../../../components/primitives/index.js";
import {
  createBranch,
  fetchGitLog,
  GitOperationError,
  switchBranch,
} from "../../../lib/git-api.js";

export type GitGraphSelection =
  | { kind: "working-tree" }
  | { kind: "commit"; commit: GitCommit };

export interface GitGraphActions {
  onPull?: () => void;
  onPush?: () => void;
}

interface GitGraphPaneProps {
  projectId: string;
  worktreePath: string;
  refreshSeq?: number | string;
  selection: GitGraphSelection | null;
  onSelect: (next: GitGraphSelection) => void;
  actions?: GitGraphActions;
  ahead?: number;
  behind?: number;
  isMobile?: boolean;
  currentBranch?: string | null;
}

const LANE_VISIBLE_CAP = 5;
const LANE_WIDTH = 16;
const LANE_X_OFFSET = 6;
const DOT_RADIUS = 4;
const STROKE_WIDTH = 2;
const ROW_HEIGHT_DESKTOP = 22;
const ROW_HEIGHT_MOBILE = 26;
const PAGE_SIZE = 200;
const REMOTE_PREF_KEY_PREFIX = "gitGraph:includeRemotes:";

function svgWidthFor(maxLane: number): number {
  // Width sized to actually-used lanes, capped at the overflow cap so an
  // unexpectedly deep history doesn't push the subject off-screen.
  const visible = Math.min(Math.max(maxLane, 0), LANE_VISIBLE_CAP - 1);
  return LANE_X_OFFSET + visible * LANE_WIDTH + LANE_X_OFFSET;
}

function laneX(lane: number): number {
  const clamped = Math.min(Math.max(lane, 0), LANE_VISIBLE_CAP - 1);
  return LANE_X_OFFSET + clamped * LANE_WIDTH;
}

function branchColor(colorId: number): string {
  return `var(--theme-graph-branch-${(colorId % 5) + 1})`;
}

// Mirrors VSCode SCM Graph: the current local ref lane uses
// scmGraph.historyItemRefColor; foreground1..5 are fallback lane rotations.
const CURRENT_REF_COLOR = "var(--theme-graph-ref-base)";
const WORKING_TREE_COLOR = CURRENT_REF_COLOR;

function isHeadCommit(commit: GitCommit): boolean {
  return commit.refs.some((r) => r.type === "head");
}

function buildCurrentBranchShas(commits: readonly GitCommit[]): Set<string> {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const head = commits.find(isHeadCommit);
  const out = new Set<string>();
  let cursor = head;
  while (cursor && !out.has(cursor.sha)) {
    out.add(cursor.sha);
    const nextSha = cursor.parents[0];
    cursor = nextSha ? bySha.get(nextSha) : undefined;
  }
  return out;
}

interface CurrentLaneMark {
  dot: boolean;
  input: ReadonlySet<number>;
  output: ReadonlySet<number>;
}

const EMPTY_CURRENT_MARK: CurrentLaneMark = {
  dot: false,
  input: new Set<number>(),
  output: new Set<number>(),
};

function buildCurrentLaneMarks(
  commits: readonly GitCommit[],
): Map<string, CurrentLaneMark> {
  const currentBranchShas = buildCurrentBranchShas(commits);
  const marks = new Map<
    string,
    { dot: boolean; input: Set<number>; output: Set<number> }
  >();
  let active: { snapshot: SwimlaneSnapshot; index: number } | null = null;

  const markFor = (sha: string) => {
    let mark = marks.get(sha);
    if (!mark) {
      mark = { dot: false, input: new Set(), output: new Set() };
      marks.set(sha, mark);
    }
    return mark;
  };
  const findActiveInput = (commit: GitCommit): number => {
    const current = active;
    if (!current) return -1;
    const preferred = commit.inputSwimlanes[current.index];
    if (preferred && snapshotsMatch(preferred, current.snapshot)) {
      return current.index;
    }
    return commit.inputSwimlanes.findIndex(
      (s) => s !== null && snapshotsMatch(s, current.snapshot),
    );
  };
  const findContinuationOutput = (commit: GitCommit): number => {
    const firstParent = commit.parents[0];
    if (!firstParent || !currentBranchShas.has(firstParent)) return -1;
    const preferred = commit.outputSwimlanes[commit.lane];
    if (
      preferred &&
      preferred.colorId === commit.colorId &&
      preferred.expectingSha === firstParent
    ) {
      return commit.lane;
    }
    return commit.outputSwimlanes.findIndex(
      (s) =>
        s !== null &&
        s.colorId === commit.colorId &&
        s.expectingSha === firstParent,
    );
  };

  for (const commit of commits) {
    const mark = markFor(commit.sha);
    const activeInput = findActiveInput(commit);
    if (activeInput !== -1) mark.input.add(activeInput);

    if (currentBranchShas.has(commit.sha)) {
      mark.dot = true;
      const outputIndex = findContinuationOutput(commit);
      if (outputIndex !== -1) {
        mark.output.add(outputIndex);
        const snapshot = commit.outputSwimlanes[outputIndex];
        active = snapshot ? { snapshot, index: outputIndex } : null;
      } else {
        active = null;
      }
      continue;
    }

    if (activeInput === -1) continue;
    const input = commit.inputSwimlanes[activeInput];
    const outputIndex = input
      ? commit.outputSwimlanes.findIndex(
          (s, i) => i === activeInput && s !== null && snapshotsMatch(s, input),
        )
      : -1;
    const fallbackOutputIndex =
      outputIndex !== -1 && input
        ? outputIndex
        : input
          ? commit.outputSwimlanes.findIndex(
              (s) => s !== null && snapshotsMatch(s, input),
            )
          : -1;
    if (fallbackOutputIndex !== -1) {
      mark.output.add(fallbackOutputIndex);
      const snapshot = commit.outputSwimlanes[fallbackOutputIndex];
      active = snapshot ? { snapshot, index: fallbackOutputIndex } : null;
    }
  }

  return marks;
}

function commitGraphColor(commit: GitCommit, mark: CurrentLaneMark): string {
  return mark.dot ? CURRENT_REF_COLOR : branchColor(commit.colorId);
}

/**
 * Bezier connector between two points. Vertical when the lane doesn't move,
 * a smooth cubic when it does. The control points pin the curve to a
 * mid-y inflection so adjacent half-row connectors meet at right angles
 * across the dot row.
 */
function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const cy = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
}

/**
 * Build a single SVG path from (fromX,0) -> (dotX,mid) -> (toX,rowHeight) as one
 * continuous subpath. Each half is either a vertical segment or a cubic that
 * eases through the row mid, identical to two `connectorPath` calls but
 * concatenated WITHOUT the second `M` so the SVG parser doesn't see a partial
 * implicit-continuation (which the spec drops at the first parse error,
 * silently truncating the bottom half -- that's what was visually breaking
 * lanes whose primary lane shifts column due to compaction).
 */
function stitchedThroughDot(
  fromX: number,
  dotX: number,
  toX: number,
  rowHeight: number,
): string {
  // All three columns equal -> emit one full-row vertical so the path renders
  // as a single `V` (cleaner DOM, easier to assert in tests).
  if (fromX === dotX && dotX === toX) {
    return `M${fromX} 0V${rowHeight}`;
  }
  const mid = rowHeight / 2;
  let d = `M${fromX} 0`;
  if (fromX === dotX) {
    d += `V${mid}`;
  } else {
    const cy = mid / 2;
    d += `C${fromX} ${cy} ${dotX} ${cy} ${dotX} ${mid}`;
  }
  if (dotX === toX) {
    d += `V${rowHeight}`;
  } else {
    const cy = (mid + rowHeight) / 2;
    d += `C${dotX} ${cy} ${toX} ${cy} ${toX} ${rowHeight}`;
  }
  return d;
}

function snapshotsMatch(a: SwimlaneSnapshot, b: SwimlaneSnapshot): boolean {
  return a.colorId === b.colorId && a.expectingSha === b.expectingSha;
}

interface ConnectorPath {
  d: string;
  color: string;
  dimmed?: boolean;
}

/**
 * Build the SVG path data for connectors traversing this row.
 *
 * Three cases:
 *   1. input lane that expects this commit (= a "parent slot" lane meeting its
 *      child) -> curve from top edge to the dot center.
 *   2. input lane passing through (= same snapshot exists in output, possibly
 *      at a different column due to compaction) -> curve from top to bottom.
 *   3. output lane that's NEW relative to input (= the commit's first parent
 *      slot continuing down, or additional parents for merges) -> curve from
 *      dot center to bottom edge.
 *
 * For case 1 + 3 on the SAME lane (= the commit's own lane continuing down
 * to its first parent), we emit ONE full-row path so the line looks
 * continuous instead of stitching at the dot center where rounding artifacts
 * can leave a visible seam.
 */
function buildConnectors(
  commit: GitCommit,
  rowHeight: number,
  currentMark: CurrentLaneMark,
): ConnectorPath[] {
  const { inputSwimlanes, outputSwimlanes, lane: commitLane, sha } = commit;
  const dotX = laneX(commitLane);
  const mid = rowHeight / 2;
  const out: ConnectorPath[] = [];

  // Each output index can only continue ONE input lane. Track claims so two
  // input lanes with identical snapshots (same colorId AND expectingSha -- a
  // legitimate state when two branches both wait for the same ancestor and
  // BRANCH_COLOR_COUNT rotation gives them the same colorId) don't both
  // findIndex onto the same output, leaving a sibling output un-drawn.
  const claimedOutputIdx = new Set<number>();

  const claimFirstUnclaimedMatch = (
    s: SwimlaneSnapshot,
    preferredJ?: number,
  ): number => {
    // Prefer the same-index output if available -- keeps the lane visually
    // straight when no compaction shift is needed.
    if (
      preferredJ !== undefined &&
      preferredJ >= 0 &&
      preferredJ < outputSwimlanes.length &&
      !claimedOutputIdx.has(preferredJ) &&
      outputSwimlanes[preferredJ] !== null &&
      snapshotsMatch(outputSwimlanes[preferredJ] as SwimlaneSnapshot, s)
    ) {
      claimedOutputIdx.add(preferredJ);
      return preferredJ;
    }
    for (let j = 0; j < outputSwimlanes.length; j++) {
      if (claimedOutputIdx.has(j)) continue;
      const t = outputSwimlanes[j];
      if (t !== null && snapshotsMatch(t, s)) {
        claimedOutputIdx.add(j);
        return j;
      }
    }
    return -1;
  };

  // The primary matched lane is the FIRST input lane whose expectingSha equals
  // this commit (mirrors parseGitLog's `lane = matchedLanes[0]`). Identifying
  // by index -- not by colorId match -- is required because BRANCH_COLOR_COUNT
  // rotation can give two unrelated lanes the same colorId.
  const primaryMatchedIdx = inputSwimlanes.findIndex(
    (s) => s !== null && s.expectingSha === sha,
  );

  // The commit's continuing lane in output. parseGitLog writes
  //   next[matchedLanes[0]] = { colorId, expectingSha: firstParent }
  // and matchedLanes[0] is the LEFTMOST matched index, so no merge sink and no
  // pre-existing null sits to its left. Compaction therefore can't shift the
  // primary's slot -- its compacted index equals `primaryMatchedIdx`. Using
  // findIndex would pick a different output when an unrelated input lane
  // happens to share the same snapshot (color rotation + shared ancestor),
  // routing the primary on a long detour across the whole row.
  let continuingOutIdx = -1;
  if (primaryMatchedIdx !== -1) {
    const t = outputSwimlanes[primaryMatchedIdx] ?? null;
    const target = commit.parents[0] ?? null;
    if (
      t !== null &&
      t.colorId === commit.colorId &&
      t.expectingSha === target
    ) {
      continuingOutIdx = primaryMatchedIdx;
      claimedOutputIdx.add(primaryMatchedIdx);
    }
    // else: primary's slot got nullified (root commit, out-of-window first
    // parent, etc.) -- no continuation, top-half-only path.
  }

  inputSwimlanes.forEach((s, i) => {
    if (!s) return;
    const fromOffscreen = i >= LANE_VISIBLE_CAP;
    const fromX = laneX(i);
    if (s.expectingSha === sha) {
      // Case 1: this lane meets the commit. The primary matched lane (= leftmost
      // by index) continues below to the commit's first parent. Other matched
      // lanes are merge sinks that terminate at the dot (top-half only).
      const isPrimary = i === primaryMatchedIdx;
      if (isPrimary && continuingOutIdx !== -1) {
        const toX = laneX(continuingOutIdx);
        const dimmed = fromOffscreen && continuingOutIdx >= LANE_VISIBLE_CAP;
        out.push({
          d: stitchedThroughDot(fromX, dotX, toX, rowHeight),
          color:
            currentMark.input.has(i) || currentMark.output.has(continuingOutIdx)
              ? CURRENT_REF_COLOR
              : branchColor(s.colorId),
          dimmed,
        });
      } else {
        // Sink (or primary with no continuing output, e.g. root) -- top half only.
        const dimmed = fromOffscreen && commitLane >= LANE_VISIBLE_CAP;
        out.push({
          d: connectorPath(fromX, 0, dotX, mid),
          color: currentMark.input.has(i)
            ? CURRENT_REF_COLOR
            : branchColor(s.colorId),
          dimmed,
        });
      }
      return;
    }
    // Case 2: passing-through lane. Greedy unique claim -- prefer same index
    // first so unrelated lanes keep their column when no shift is needed.
    const j = claimFirstUnclaimedMatch(s, i);
    if (j === -1) return;
    const toX = laneX(j);
    const dimmed = fromOffscreen && j >= LANE_VISIBLE_CAP;
    out.push({
      d: connectorPath(fromX, 0, toX, rowHeight),
      color:
        currentMark.input.has(i) || currentMark.output.has(j)
          ? CURRENT_REF_COLOR
          : branchColor(s.colorId),
      dimmed,
    });
  });

  // Case 3: output lanes no input claimed -- brand-new slots opened by this
  // row (additional parents on a merge, or a fresh branch tip with no
  // pre-existing waiter). The claimed-set check is the ONLY correct gate
  // here; an "any input snapshotsMatch" check would falsely shadow new lanes
  // that happen to share a snapshot with an unrelated active input.
  outputSwimlanes.forEach((t, j) => {
    if (!t) return;
    if (claimedOutputIdx.has(j)) return;
    const toX = laneX(j);
    const dimmed = j >= LANE_VISIBLE_CAP && commitLane >= LANE_VISIBLE_CAP;
    out.push({
      d: connectorPath(dotX, mid, toX, rowHeight),
      color: currentMark.output.has(j)
        ? CURRENT_REF_COLOR
        : branchColor(t.colorId),
      dimmed,
    });
  });

  return out;
}

function loadRemotePref(worktreePath: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(
      REMOTE_PREF_KEY_PREFIX + worktreePath,
    );
    if (v === null) return true; // default ON, mirrors VSCode SCM Graph
    return v === "1";
  } catch {
    return true;
  }
}

function saveRemotePref(worktreePath: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      REMOTE_PREF_KEY_PREFIX + worktreePath,
      value ? "1" : "0",
    );
  } catch {
    // localStorage can throw under privacy mode / quota -- ignore.
  }
}

function maxLaneOfCommit(commit: GitCommit): number {
  // Lane positions are encoded by array index in inputSwimlanes / outputSwimlanes,
  // so the array length minus one is the upper bound for that row.
  let max = commit.lane;
  if (commit.inputSwimlanes.length - 1 > max)
    max = commit.inputSwimlanes.length - 1;
  if (commit.outputSwimlanes.length - 1 > max)
    max = commit.outputSwimlanes.length - 1;
  return max;
}

function sortRefsShortFirst(refs: readonly GitRef[]): GitRef[] {
  // Stable sort by label length so adjacent chips read shortest-first;
  // ties keep original order (head before its target branch on the same row).
  return [...refs].sort((a, b) => a.label.length - b.label.length);
}

export function GitGraphPane({
  projectId,
  worktreePath,
  refreshSeq,
  selection,
  onSelect,
  actions,
  ahead,
  behind,
  isMobile,
  currentBranch,
}: GitGraphPaneProps) {
  const rowHeight = isMobile ? ROW_HEIGHT_MOBILE : ROW_HEIGHT_DESKTOP;
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeRemotes, setIncludeRemotes] = useState<boolean>(() =>
    loadRemotePref(worktreePath),
  );
  const [endReached, setEndReached] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Generation token + AbortController prevent stale fetch responses (e.g.
  // worktree switched mid-flight, remote toggle during loadMore) from
  // overwriting the current pane state. Pure post-await guard would race the
  // server work; abort cancels the inflight fetch too.
  const requestGenRef = useRef(0);
  const reloadAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  // Synchronous lock -- IntersectionObserver can fire callbacks faster than
  // React commits the loadingMore=true state, so the state gate alone lets
  // duplicate loadMore() races through.
  const loadMoreLockRef = useRef(false);

  const reload = useCallback(async () => {
    reloadAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    reloadAbortRef.current = controller;
    const gen = ++requestGenRef.current;
    setError(null);
    setEndReached(false);
    try {
      const res = await fetchGitLog({
        projectId,
        worktreePath,
        limit: PAGE_SIZE,
        includeRemotes,
        signal: controller.signal,
      });
      if (gen !== requestGenRef.current) return;
      setCommits(res.commits);
      setHasUncommitted(res.hasUncommitted);
      if (res.commits.length < PAGE_SIZE) setEndReached(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (gen !== requestGenRef.current) return;
      const msg =
        err instanceof GitOperationError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
      setCommits([]);
      setEndReached(true);
    }
  }, [projectId, worktreePath, includeRemotes]);

  const loadMore = useCallback(async () => {
    if (loadMoreLockRef.current) return;
    if (loadingMore || endReached || !commits || commits.length === 0) return;
    loadMoreLockRef.current = true;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    const gen = requestGenRef.current;
    const skip = commits.length;
    setLoadingMore(true);
    try {
      const res = await fetchGitLog({
        projectId,
        worktreePath,
        limit: PAGE_SIZE,
        skip,
        includeRemotes,
        signal: controller.signal,
      });
      // Drop the result if a reload bumped the generation while we awaited --
      // appending pages from a different worktree/includeRemotes query would
      // splice unrelated commits into the visible history.
      if (gen !== requestGenRef.current) return;
      setCommits((prev) => {
        if (!prev) return res.commits;
        const seen = new Set(prev.map((c) => c.sha));
        const fresh = res.commits.filter((c) => !seen.has(c.sha));
        return [...prev, ...fresh];
      });
      if (res.commits.length < PAGE_SIZE) setEndReached(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (gen !== requestGenRef.current) return;
      const msg =
        err instanceof GitOperationError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
      setEndReached(true);
    } finally {
      loadMoreLockRef.current = false;
      setLoadingMore(false);
    }
  }, [
    projectId,
    worktreePath,
    includeRemotes,
    commits,
    loadingMore,
    endReached,
  ]);

  // Re-sync the per-worktree remote-branches preference whenever the pane is
  // pointed at a different worktree. Without this, a parent component that
  // swaps worktreePath in place keeps the previous worktree's preference and
  // would fetch with the wrong includeRemotes flag.
  useEffect(() => {
    setIncludeRemotes(loadRemotePref(worktreePath));
  }, [worktreePath]);

  useEffect(() => {
    void refreshSeq;
    void reload();
  }, [reload, refreshSeq]);

  // Cancel any inflight request when the pane unmounts so the response can't
  // call setState on a torn-down component.
  useEffect(() => {
    return () => {
      reloadAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, []);

  // IntersectionObserver triggers loadMore when the bottom sentinel scrolls
  // into the scroller's viewport. Tied to scroller via root prop so it works
  // even when the pane isn't full-page.
  const commitCount = commits?.length ?? 0;
  useEffect(() => {
    void commitCount;
    if (!sentinelRef.current || !scrollerRef.current) return;
    if (endReached) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scrollerRef.current, rootMargin: "200px 0px" },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [loadMore, endReached, commitCount]);

  const onToggleRemotes = useCallback(() => {
    setIncludeRemotes((prev) => {
      const next = !prev;
      saveRemotePref(worktreePath, next);
      return next;
    });
  }, [worktreePath]);

  useEffect(() => {
    void projectId;
    void worktreePath;
    setBranchError(null);
  }, [projectId, worktreePath]);

  const runBranchAction = useCallback(
    async (ref: GitRef) => {
      if (!isActionableBranchRef(ref)) return;
      if (ref.type === "local" && ref.label === currentBranch) return;
      if (
        hasUncommitted &&
        !window.confirm(
          "Switch branches with uncommitted changes? Git may refuse if files would be overwritten.",
        )
      ) {
        return;
      }

      setBranchBusy(true);
      setBranchError(null);
      try {
        if (ref.type === "local") {
          await switchBranch({
            projectId,
            worktreePath,
            branch: ref.label,
          });
        } else if (ref.type === "remote") {
          const branch = localBranchNameFromRemote(ref.label);
          try {
            await createBranch({
              projectId,
              worktreePath,
              branch,
              startPoint: ref.label,
            });
          } catch (error) {
            if (!isExistingBranchCreateConflict(error, branch)) throw error;
            await switchBranch({
              projectId,
              worktreePath,
              branch,
            });
          }
        }
        await reload();
      } catch (error) {
        const message =
          error instanceof GitOperationError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Branch operation failed";
        setBranchError(`${ref.label}: ${message}`);
      } finally {
        setBranchBusy(false);
      }
    },
    [currentBranch, hasUncommitted, projectId, reload, worktreePath],
  );

  const subtitle = useMemo(() => {
    if (commits === null) return "loading…";
    if (error) return "error";
    return `${commits.length} commit${commits.length === 1 ? "" : "s"}${
      endReached ? "" : "…"
    }${includeRemotes ? " · all branches" : " · HEAD"}`;
  }, [commits, error, endReached, includeRemotes]);
  const currentLaneMarks = useMemo(
    () => buildCurrentLaneMarks(commits ?? []),
    [commits],
  );
  const localBranches = useMemo(
    () => collectLocalBranches(commits ?? []),
    [commits],
  );

  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <div
        ref={scrollerRef}
        className="cm-scroll cm-mono min-h-0 flex-1 overflow-auto py-1 text-sm"
      >
        {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
        {branchError && (
          <BranchErrorBanner
            error={branchError}
            onDismiss={() => setBranchError(null)}
          />
        )}
        {hasUncommitted && (
          <WorkingTreeRow
            selected={selection?.kind === "working-tree"}
            onSelect={() => onSelect({ kind: "working-tree" })}
            rowHeight={rowHeight}
            headLane={commits?.[0]?.lane ?? null}
          />
        )}
        {(commits ?? []).map((c, i) => (
          <CommitRow
            key={c.sha}
            commit={c}
            selected={
              selection?.kind === "commit" && selection.commit.sha === c.sha
            }
            onSelect={() => onSelect({ kind: "commit", commit: c })}
            rowHeight={rowHeight}
            topConnectFromAbove={hasUncommitted && i === 0}
            currentMark={currentLaneMarks.get(c.sha) ?? EMPTY_CURRENT_MARK}
            currentBranch={currentBranch}
            localBranches={localBranches}
            branchBusy={branchBusy}
            onBranchRefSelect={runBranchAction}
          />
        ))}
        {commits?.length === 0 && !error && (
          <div className="px-3 py-3 text-xs text-text-secondary">
            No commits yet.
          </div>
        )}
        {!endReached && commits && commits.length > 0 && (
          <div
            ref={sentinelRef}
            className="px-3 py-2 text-center text-xs text-text-secondary/60"
            aria-live="polite"
            data-testid="git-graph-sentinel"
          >
            {loadingMore ? "loading more…" : ""}
          </div>
        )}
      </div>
      <PaneFooter
        status={subtitle}
        actions={
          <>
            {actions?.onPull && (
              <SyncButton
                onClick={actions.onPull}
                label="Pull"
                direction="behind"
                count={behind}
                glyph={<PaGlyph.pull />}
              />
            )}
            {actions?.onPush && (
              <SyncButton
                onClick={actions.onPush}
                label="Push"
                direction="ahead"
                count={ahead}
                glyph={<PaGlyph.push />}
              />
            )}
            <PaneIconButton
              onClick={onToggleRemotes}
              label={
                includeRemotes ? "Hide remote branches" : "Show remote branches"
              }
              pressed={includeRemotes}
              data-testid="git-graph-toggle-remotes"
              tone={includeRemotes ? "active" : "normal"}
            >
              {includeRemotes ? <PaGlyph.eye /> : <PaGlyph.eyeOff />}
            </PaneIconButton>
            <PaneIconButton onClick={() => void reload()} label="Refresh">
              <PaGlyph.refresh />
            </PaneIconButton>
          </>
        }
      />
    </div>
  );
}

function isExistingBranchCreateConflict(
  error: unknown,
  branch: string,
): boolean {
  if (!(error instanceof GitOperationError)) return false;
  if (error.status !== 409) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("already exists") && message.includes(branch.toLowerCase())
  );
}

function SyncButton({
  onClick,
  label,
  direction,
  glyph,
  count,
}: {
  onClick: () => void;
  label: string;
  direction: "ahead" | "behind";
  glyph: ReactNode;
  count?: number;
}) {
  const showBadge = typeof count === "number" && count > 0;
  const display = showBadge ? (count > 99 ? "99+" : String(count)) : null;
  const ariaLabel = showBadge
    ? `${label} (${count} ${count === 1 ? "commit" : "commits"} ${direction})`
    : label;
  return (
    <PaneIconButton onClick={onClick} label={ariaLabel} className="relative">
      {glyph}
      {display !== null && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-tag bg-accent px-1 text-[11px] leading-none font-bold text-white drop-shadow-sm"
        >
          {display}
        </span>
      )}
    </PaneIconButton>
  );
}

function WorkingTreeRow({
  selected,
  onSelect,
  rowHeight,
  headLane,
}: {
  selected: boolean;
  onSelect: () => void;
  rowHeight: number;
  headLane: number | null;
}) {
  const lane = headLane ?? 0;
  const dotX = laneX(lane);
  const svgWidth = svgWidthFor(lane);
  const mid = rowHeight / 2;
  // Synthetic uncommitted row: mirrors VSCode's outgoing-changes node, whose
  // swimlane is scmGraph.historyItemRefColor.
  const connectorColor = WORKING_TREE_COLOR;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-0 px-3 text-left ${
        selected ? "bg-row-selected-bg" : "hover:bg-row-hover-bg"
      }`}
      style={{ height: rowHeight, lineHeight: `${rowHeight}px` }}
      data-testid="git-graph-working-tree-row"
    >
      <svg
        aria-hidden
        width={svgWidth}
        height={rowHeight}
        className="flex-none"
        style={{ overflow: "visible" }}
        shapeRendering="geometricPrecision"
      >
        {connectorColor !== null && (
          <path
            d={`M${dotX} ${mid}V${rowHeight}`}
            stroke={connectorColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            fill="none"
          />
        )}
        <circle
          cx={dotX}
          cy={mid}
          r={DOT_RADIUS}
          fill="var(--color-bg-primary)"
          stroke={WORKING_TREE_COLOR}
          strokeWidth={1.5}
          strokeDasharray="1.4 1"
        />
      </svg>
      <span
        className="ml-2 min-w-0 flex-1 truncate text-text-primary"
        style={{ fontWeight: selected ? 600 : 500 }}
      >
        Working tree (uncommitted)
      </span>
    </button>
  );
}

function CommitRow({
  commit,
  selected,
  onSelect,
  rowHeight,
  topConnectFromAbove = false,
  currentMark,
  currentBranch,
  localBranches,
  branchBusy,
  onBranchRefSelect,
}: {
  commit: GitCommit;
  selected: boolean;
  onSelect: () => void;
  rowHeight: number;
  topConnectFromAbove?: boolean;
  currentMark: CurrentLaneMark;
  currentBranch?: string | null;
  localBranches: ReadonlySet<string>;
  branchBusy?: boolean;
  onBranchRefSelect?: (ref: GitRef) => void;
}) {
  const connectors = buildConnectors(commit, rowHeight, currentMark);
  const dotX = laneX(commit.lane);
  const dotColor = commitGraphColor(commit, currentMark);
  const dotDimmed = commit.lane >= LANE_VISIBLE_CAP;
  const isHead = isHeadCommit(commit);
  const sortedRefs = sortRefsShortFirst(commit.refs);
  // When a working-tree row sits above HEAD, draw a top-half line into the
  // HEAD dot so the working tree visibly feeds into the current branch lane.
  // HEAD's inputSwimlanes is empty (it's the newest commit), so this connector
  // is added explicitly rather than via buildConnectors.
  const topFromAbove = topConnectFromAbove
    ? { d: `M${dotX} 0V${rowHeight / 2}`, color: dotColor }
    : null;
  // Per-row width -- keeps the SVG narrow for linear-history rows so the
  // subject column starts as far left as possible (matches VSCode SCM Graph).
  const svgWidth = svgWidthFor(maxLaneOfCommit(commit));

  return (
    <div
      className={`flex w-full items-center gap-2 px-3 ${
        selected ? "bg-row-selected-bg" : "hover:bg-row-hover-bg"
      }`}
      style={{ height: rowHeight, lineHeight: `${rowHeight}px` }}
      data-testid="git-graph-commit-row"
      data-lane={commit.lane}
      data-color-id={commit.colorId}
      data-head={isHead ? "1" : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <svg
          aria-hidden
          width={svgWidth}
          height={rowHeight}
          className="flex-none"
          style={{ overflow: "visible" }}
          shapeRendering="geometricPrecision"
        >
          {topFromAbove !== null && (
            <path
              key={`${commit.sha}-top-from-above`}
              d={topFromAbove.d}
              stroke={topFromAbove.color}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              fill="none"
            />
          )}
          {connectors.map((p) => (
            <path
              key={`${commit.sha}:${p.d}:${p.color}:${p.dimmed ? "dim" : "full"}`}
              d={p.d}
              stroke={p.color}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              fill="none"
              opacity={p.dimmed ? 0.35 : 1}
            />
          ))}
          {isHead ? (
            <circle
              cx={dotX}
              cy={rowHeight / 2}
              r={DOT_RADIUS}
              fill="var(--color-bg-primary)"
              stroke={dotColor}
              strokeWidth={2}
              opacity={dotDimmed ? 0.55 : 1}
            />
          ) : (
            <circle
              cx={dotX}
              cy={rowHeight / 2}
              r={DOT_RADIUS}
              fill={dotColor}
              stroke="none"
              opacity={dotDimmed ? 0.55 : 1}
            />
          )}
        </svg>
        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontWeight: selected ? 600 : 400 }}
        >
          {commit.subject}
        </span>
      </button>
      {sortedRefs.length > 0 && (
        <span
          className="flex-none flex flex-row items-center gap-1 overflow-hidden"
          style={{ maxWidth: "60%" }}
        >
          {sortedRefs.map((r) => (
            <RefChip
              key={`${commit.sha}:${r.type}:${r.label}`}
              ref={r}
              laneColor={dotColor}
              current={isCurrentBranchRef(r, currentBranch, localBranches)}
              localBranches={localBranches}
              busy={branchBusy}
              onSelect={onBranchRefSelect}
            />
          ))}
        </span>
      )}
    </div>
  );
}

function localBranchNameFromRemote(label: string): string {
  const parts = label.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join("/") : label;
}

function collectLocalBranches(
  commits: readonly GitCommit[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const commit of commits) {
    for (const ref of commit.refs) {
      if (ref.type === "local") out.add(ref.label);
    }
  }
  return out;
}

function isCurrentBranchRef(
  ref: GitRef,
  currentBranch: string | null | undefined,
  localBranches: ReadonlySet<string>,
): boolean {
  if (!currentBranch) return false;
  if (ref.type === "local") return ref.label === currentBranch;
  if (ref.type !== "remote") return false;
  const localBranch = localBranchNameFromRemote(ref.label);
  return localBranches.has(localBranch) && localBranch === currentBranch;
}

function isActionableBranchRef(ref: GitRef): boolean {
  return ref.type === "local" || (ref.type === "remote" && !isRemoteHead(ref));
}

function isRemoteHead(ref: GitRef): boolean {
  return ref.type === "remote" && ref.label.endsWith("/HEAD");
}

function BranchErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-2 mb-1 rounded-control border border-danger/40 bg-bg-secondary px-2 py-1.5 text-xs text-text-primary">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-danger">{error}</div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss branch error"
          className="shrink-0 rounded-control px-2 py-1 text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function refStyle(ref: GitRef, laneColor: string): CSSProperties {
  if (ref.type === "head") {
    return {
      color: "var(--color-bg-primary)",
      background: laneColor,
      border: "none",
    };
  }
  // local / remote / tag share the swimlane color; remote uses dashed border
  // and tag uses dotted for type at-a-glance without diverging from the
  // commit's branch color.
  const borderStyle =
    ref.type === "remote" ? "dashed" : ref.type === "tag" ? "dotted" : "solid";
  return {
    color: laneColor,
    background: `color-mix(in oklab, ${laneColor} 14%, transparent)`,
    border: `1px ${borderStyle} color-mix(in oklab, ${laneColor} 45%, transparent)`,
  };
}

function RefChip({
  ref,
  laneColor,
  current = false,
  localBranches,
  busy = false,
  onSelect,
}: {
  ref: GitRef;
  laneColor: string;
  current?: boolean;
  localBranches: ReadonlySet<string>;
  busy?: boolean;
  onSelect?: (ref: GitRef) => void;
}) {
  const className =
    "cm-mono inline-block rounded-tag px-[5px] align-[1px] text-xs whitespace-nowrap";

  if (isActionableBranchRef(ref) && onSelect) {
    const menuItems = branchMenuItems(
      ref,
      current,
      localBranches,
      busy,
      onSelect,
    );
    return (
      <FloatingActionMenu
        items={menuItems}
        align="start"
        portal={true}
        renderTrigger={({ open, toggle, triggerRef, menuId }) => (
          <button
            ref={triggerRef}
            type="button"
            data-ref-type={ref.type}
            data-current-branch={current ? "1" : undefined}
            className={`${className} cursor-pointer hover:brightness-125`}
            style={refStyle(ref, laneColor)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={`Branch actions for ${ref.label}`}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            {ref.label}
          </button>
        )}
      />
    );
  }
  return (
    <span
      data-ref-type={ref.type}
      className={className}
      style={refStyle(ref, laneColor)}
    >
      {ref.label}
    </span>
  );
}

function branchMenuItems(
  ref: GitRef,
  current: boolean,
  localBranches: ReadonlySet<string>,
  busy: boolean,
  onSelect: (ref: GitRef) => void,
): ActionItem[] {
  if (ref.type === "local") {
    return [
      {
        id: "switch",
        label: current ? "Current branch" : "Switch",
        disabled: current || busy,
        onSelect: () => {
          onSelect(ref);
        },
      },
    ];
  }
  if (ref.type === "remote") {
    const localBranch = localBranchNameFromRemote(ref.label);
    if (localBranches.has(localBranch)) {
      return [
        {
          id: "switch",
          label: current ? "Current branch" : "Switch",
          disabled: current || busy,
          onSelect: () => {
            onSelect({ label: localBranch, type: "local" });
          },
        },
      ];
    }
    return [
      {
        id: "create-switch",
        label: "Create & switch",
        disabled: busy,
        onSelect: () => {
          onSelect(ref);
        },
      },
    ];
  }
  return [];
}
