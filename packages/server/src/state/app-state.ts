import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  normalizeIdeCommands,
  normalizePaneCommands,
  normalizeProjectSidebarState,
  normalizeSessionLaunchPreset,
  normalizeWorktreeLocalFileAllowlist,
  normalizeWorktreeMetadataMap,
  type PortDetectionMode,
  type Project,
  type ProjectState,
  type ServiceConfig,
  type Session,
} from "@parasor/shared";

const EMPTY_STATE: AppState = {
  version: 1,
  projects: [],
  projectStates: {},
  sessions: [],
  sessionRecords: [],
  ideCommands: [],
  paneCommands: [],
  serviceConfig: {
    preventIdleSleep: false,
    portDetection: "all-interfaces",
    dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
    dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  },
};

function normalizePortDetection(value: unknown): PortDetectionMode {
  // Legacy "all" mode (every loopback port, retired in local notify-mode cleanup) folds back to
  // "all-interfaces" -- closer to the user's original intent than silently
  // disabling notifications for someone who had explicitly opted in.
  if (value === "all-interfaces" || value === "off") return value;
  return "all-interfaces";
}

/**
 * Accept either missing fields or non-positive / non-finite junk. The
 * hard cap also bounds the soft cap to guard a hand-edited state.json
 * that set `dropSizeMaxBytes > dropSizeHardMaxBytes`.
 */
function normalizeDropCap(
  value: unknown,
  fallback: number,
  ceiling: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, ceiling);
}

/**
 * Backfill fields added after v1 shipped. Existing state.json files
 * predate these fields and would otherwise surface `undefined` to
 * consumers that treat them as required.
 */
function migrate(raw: Partial<AppState>): AppState {
  const serviceConfig: Partial<ServiceConfig> = raw.serviceConfig ?? {};
  const hardMax = normalizeDropCap(
    serviceConfig.dropSizeHardMaxBytes,
    DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
    Number.POSITIVE_INFINITY,
  );
  const softMax = normalizeDropCap(
    serviceConfig.dropSizeMaxBytes,
    DEFAULT_DROP_SIZE_MAX_BYTES,
    hardMax,
  );
  return {
    ...structuredClone(EMPTY_STATE),
    ...raw,
    projects: Array.isArray(raw.projects)
      ? raw.projects.map((project) => {
          const worktreeLocalFileAllowlist =
            normalizeWorktreeLocalFileAllowlist(
              project.worktreeLocalFileAllowlist,
            );
          return {
            ...project,
            ...(worktreeLocalFileAllowlist.length > 0 && {
              worktreeLocalFileAllowlist,
            }),
          };
        })
      : [],
    projectStates: normalizeProjectStates(raw.projectStates),
    sessions: normalizeSessions(raw.sessions),
    sessionRecords: Array.isArray(raw.sessionRecords) ? raw.sessionRecords : [],
    ideCommands: normalizeIdeCommands(raw.ideCommands),
    paneCommands: normalizePaneCommands(raw.paneCommands),
    serviceConfig: {
      preventIdleSleep: serviceConfig.preventIdleSleep ?? false,
      portDetection: normalizePortDetection(serviceConfig.portDetection),
      dropSizeMaxBytes: softMax,
      dropSizeHardMaxBytes: hardMax,
    },
  };
}

function normalizeSessions(value: unknown): Session[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((session): session is Session => {
      return (
        typeof session === "object" &&
        session !== null &&
        !Array.isArray(session) &&
        typeof (session as Session).id === "string"
      );
    })
    .map((session) => {
      const raw = session as Session & { launchPreset?: unknown };
      const launchPreset = normalizeSessionLaunchPreset(raw.launchPreset);
      const next: Session = { ...raw };
      if (launchPreset) {
        next.launchPreset = launchPreset;
      } else {
        delete next.launchPreset;
      }
      return next;
    });
}

function normalizeProjectStates(value: unknown): Record<string, ProjectState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ProjectState> = {};
  for (const [id, state] of Object.entries(value)) {
    if (!state || typeof state !== "object" || Array.isArray(state)) continue;
    const raw = state as Partial<ProjectState>;
    out[id] = {
      ...raw,
      projectId: typeof raw.projectId === "string" ? raw.projectId : id,
      layout: raw.layout ?? null,
      worktrees: Array.isArray(raw.worktrees) ? raw.worktrees : [],
      openFiles: Array.isArray(raw.openFiles) ? raw.openFiles : [],
      lastFocusedPaneId: raw.lastFocusedPaneId ?? null,
      focusedPaneId: raw.focusedPaneId ?? null,
      sidebar: normalizeProjectSidebarState(raw.sidebar),
      worktreeMetadata: normalizeWorktreeMetadataMap(raw.worktreeMetadata),
      lastAccessedAt:
        typeof raw.lastAccessedAt === "number" ? raw.lastAccessedAt : 0,
    };
  }
  return out;
}

export interface AppStateStoreOpts {
  /** Directory containing state.json. Defaults to ~/.config/parasor */
  dir?: string;
  /** Debounce delay in ms. Defaults to 300 */
  debounceMs?: number;
  /**
   * -- invoked when a debounced write fails
   * (delegate persist reject / writeFileSync throw). Mutator callers
   * are sync `void`-returning, so without this hook a transient
   * IPC NACK or disk EIO would silently swallow project / projectStates
   * / serviceConfig changes. Default = `console.error`. Pass `null` to
   * silence (tests) but DO NOT silence in production: the operator
   * needs the signal to know state.json is stale.
   */
  onPersistError?: ((err: unknown) => void) | null;
}

/*
 * Persistence indirection for the  / daemon state ownership single-writer invariant.
 * In remote daemon mode the server-side AppStateStore installs an IPC
 * delegate that ships its owned domains (projects / projectStates /
 * serviceConfig) to the daemon, which is the sole writer of state.json.
 * In in-process mode the delegate stays null and write() falls back to
 * the direct file path. Daemon-side stores never set a delegate.
 */
export interface AppStatePersistenceDelegate {
  /**
   * Persist the *server-owned* domains. The delegate is responsible for
   * resolving when persistence has actually committed (e.g. IPC ACK).
   * Throws/rejects -> caller logs and (for `flush()`) propagates so the
   * shutdown path can decide to skip the daemon-graceful marker.
   */
  persist(state: AppState): Promise<void>;
}

/*
 * -- narrow each domain mutator callback to a *view* of
 * AppState that only exposes the slice the caller is allowed to write,
 * plus any cross-domain reads it legitimately needs as `readonly`.
 * Passing the full `AppState` to every callback let an unrelated bug
 * (e.g. `state.sessions = state.sessions.filter(...)` inside
 * `mutateProjects`) silently succeed in in-process mode and silently
 * desync the mirror in remote mode. The view types make those misuses
 * compile errors.
 */
export type ProjectsMutateView = Pick<AppState, "projects" | "projectStates">;

export type ProjectStatesMutateView = Pick<AppState, "projectStates"> &
  Readonly<{
    projects: ReadonlyArray<Readonly<Project>>;
    sessions: ReadonlyArray<Readonly<Session>>;
  }>;

export type ServiceConfigMutateView = Pick<AppState, "serviceConfig">;

export type PaneCommandsMutateView = Pick<AppState, "paneCommands">;
export type IdeCommandsMutateView = Pick<AppState, "ideCommands">;

export type SessionsMutateView = Pick<AppState, "sessions" | "sessionRecords"> &
  Readonly<{ projects: ReadonlyArray<Readonly<Project>> }>;

export class AppStateReadOnlyError extends Error {
  constructor() {
    super(
      "AppStateStore session domain is read-only in remote daemon mode (daemon owns sessions/sessionRecords); use internalMutate() for daemon-IPC reconciliation, or mutateProjects()/mutateServiceConfig()/mutatePaneCommands()/mutateIdeCommands() for server-owned domains",
    );
    this.name = "AppStateReadOnlyError";
  }
}

export class AppStateStore {
  private state: AppState;
  private readonly dir: string;
  private readonly filePath: string;
  private readonly tmpPath: string;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /**
   * Daemon-mode mirror guard.
   * When true, only the **session domain** (`sessions`, `sessionRecords`)
   * is read-only -- the daemon owns those writes. Project / projectStates
   * / serviceConfig stay writable in both modes (the daemon never touches
   * them; their only writer is the server). The daemon-IPC reconciler
   * applies session-domain broadcasts via `internalMutate()` to bypass
   * this guard. Default false (in-process mode owns all writes).
   */
  private sessionsReadOnly = false;
  /**
   * daemon state ownership -- when set, write() routes the in-memory state through the
   * delegate instead of writing state.json directly. The remote-mode
   * server installs an IPC delegate so the daemon (sole file writer)
   * persists the server-owned domains. Mirror updates (internalMutate)
   * skip the delegate because they reflect domain the writer already
   * persisted.
   */
  private persistenceDelegate: AppStatePersistenceDelegate | null = null;
  /**
   * Tracks the most recent debounced-write promise. `flush()` awaits
   * it BEFORE issuing its own write so a shutdown-time flush surfaces
   * any in-flight failure (codex MED daemon state ownership/round 2). The promise resolves
   * whether the underlying write succeeded or rejected -- failures are
   * routed through `onPersistError` and then silenced here so awaiting
   * never throws on a shutdown path.
   */
  private lastWrite: Promise<void> = Promise.resolve();
  private readonly onPersistError: (err: unknown) => void;

  constructor(opts: AppStateStoreOpts = {}) {
    const dir = opts.dir ?? join(homedir(), ".config", "parasor");
    this.debounceMs = opts.debounceMs ?? 300;
    this.filePath = join(dir, "state.json");
    this.tmpPath = join(dir, "state.json.tmp");
    this.onPersistError =
      opts.onPersistError === undefined
        ? (err) =>
            console.error(
              "AppStateStore: debounced persist failed (state.json may be stale):",
              err,
            )
        : (opts.onPersistError ?? (() => undefined));

    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.state = this.load();
  }

  /**
   * Directory containing `state.json`. Used by the mode-marker subsystem
   * so the cross-mode mutex collides on the
   * same directory the store persists into, regardless of overrides.
   */
  getDir(): string {
    return this.dir;
  }

  private load(): AppState {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return migrate(JSON.parse(raw) as Partial<AppState>);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }
      // Corrupted -- rename and start fresh
      const timestamp = Date.now();
      try {
        renameSync(this.filePath, `${this.filePath}.corrupted-${timestamp}`);
      } catch {
        // ignore rename failure (file may not exist)
      }
      return structuredClone(EMPTY_STATE);
    }
  }

  get(): Readonly<AppState> {
    return this.state;
  }

  /**
   * Server-owned domain: project records (`projects` array). Always
   * writable, even in remote daemon mode -- the daemon never touches
   * project records, so the server is unconditionally authoritative.
   *
   * The callback may also touch `projectStates` since both fields move
   * together (project create/delete must keep the per-project state map
   * in lock-step). Use `mutateProjectStates` for pure projectStates
   * writes (panes, layout, focus) without project-record changes.
   */
  mutateProjects(fn: (state: ProjectsMutateView) => void): void {
    if (this.destroyed) return;
    fn(this.state);
    this.scheduleFlush();
  }

  /**
   * Server-owned domain: per-project UI state (`projectStates`). Always
   * writable. Pane layout, focus, file-tree state, etc. -- none of which
   * the daemon knows about. `projects` and `sessions` are exposed
   * read-only so reconciliation logic can compute orphan sets without
   * being able to write into either domain.
   */
  mutateProjectStates(fn: (state: ProjectStatesMutateView) => void): void {
    if (this.destroyed) return;
    fn(this.state);
    this.scheduleFlush();
  }

  /**
   * Server-owned domain: `serviceConfig`. Always writable. Daemon does
   * not consume serviceConfig; only the server reads it.
   */
  mutateServiceConfig(fn: (state: ServiceConfigMutateView) => void): void {
    if (this.destroyed) return;
    fn(this.state);
    this.scheduleFlush();
  }

  /**
   * Server-owned domain: terminal launcher commands. Always writable; the
   * daemon only owns PTY sessions/sessionRecords.
   */
  mutatePaneCommands(fn: (state: PaneCommandsMutateView) => void): void {
    if (this.destroyed) return;
    fn(this.state);
    this.scheduleFlush();
  }

  mutateIdeCommands(fn: (state: IdeCommandsMutateView) => void): void {
    if (this.destroyed) return;
    fn(this.state);
    this.scheduleFlush();
  }

  /**
   * Daemon-owned domain: `sessions` + `sessionRecords`. In remote mode
   * the server is a mirror -- server-side writes throw to surface the
   * ownership violation. The daemon-IPC reconciler uses `internalMutate`
   * to apply broadcasts without tripping this guard. `projects` is
   * exposed read-only for project-membership filters used during
   * startup reconciliation.
   */
  mutateSessions(fn: (state: SessionsMutateView) => void): void {
    if (this.destroyed) return;
    if (this.sessionsReadOnly) {
      throw new AppStateReadOnlyError();
    }
    fn(this.state);
    this.scheduleFlush();
  }

  /**
   * Bypass the session-domain guard. Reserved for the daemon-IPC
   * reconciler on the server side: SESSION_UPDATE / SESSION_LIST
   * broadcasts apply here without tripping `mutateSessions`. In
   * delegate mode the mutation is mirror-only -- the daemon already
   * persisted these domains before broadcasting, so the server
   * skips the IPC round-trip. Without a delegate (in-process / daemon
   * itself), the call schedules a normal file flush so the local
   * state.json stays coherent for UI reload.
   */
  internalMutate(fn: (state: AppState) => void): void {
    if (this.destroyed) return;
    fn(this.state);
    if (!this.persistenceDelegate) {
      this.scheduleFlush();
    }
  }

  /**
   * Toggle the  session-domain guard (narrowed by daemon state ownership). Idempotent.
   * Called once at factory-time after the PtyHost mode is decided
   * (in-process -> false, remote -> true) -- runtime flipping is not
   * supported (by design).
   */
  setSessionsReadOnly(readOnly: boolean): void {
    this.sessionsReadOnly = readOnly;
  }

  isSessionsReadOnly(): boolean {
    return this.sessionsReadOnly;
  }

  /**
   * daemon state ownership -- install/uninstall the IPC persistence delegate. In remote
   * mode the server installs the delegate after RemotePtyHost.connect
   * succeeds. Idempotent; pass null to fall back to direct file writes
   * (e.g. when host factory recreates an in-process host). Setting the
   * delegate does not flush -- callers do that explicitly if the next
   * snapshot needs to land on disk before further work.
   */
  setPersistenceDelegate(delegate: AppStatePersistenceDelegate | null): void {
    this.persistenceDelegate = delegate;
  }

  /**
   * Force a flush *now* and await the underlying persistence (file
   * write or IPC ACK). Used by shutdown paths that must observe IO
   * errors before deciding whether to write the daemon-graceful
   * marker. Synchronous in spirit (cancels the debounce timer); the
   * Promise reflects the persist step.
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.destroyed) return;
    /*
     * -- first drain any debounce-scheduled
     * write that already fired, so the shutdown path observes its
     * outcome (errors are surfaced through onPersistError; the
     * Promise itself never rejects). Then perform a fresh synchronous-
     * in-spirit write so the in-memory snapshot reaches disk / the
     * IPC peer.
     */
    await this.lastWrite;
    await this.write();
  }

  /** Cancel pending timer and ignore future mutate calls (for test teardown). */
  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.destroyed = true;
  }

  private scheduleFlush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      // Track the chain so flush() can await the latest in-flight
      // write. -- route failures through
      // onPersistError so a debounced delegate.persist() reject (IPC
      // NACK / disk EIO) does not silently lose project / projectStates
      // / serviceConfig changes. The catch returns void so awaiting
      // lastWrite never rejects on shutdown paths.
      this.lastWrite = this.write().catch((err) => {
        this.onPersistError(err);
      });
    }, this.debounceMs);
  }

  private async write(): Promise<void> {
    if (this.persistenceDelegate) {
      await this.persistenceDelegate.persist(this.state);
      return;
    }
    writeFileSync(this.tmpPath, JSON.stringify(this.state), "utf-8");
    renameSync(this.tmpPath, this.filePath);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
