import { removeRuntimeFile } from "./runtime-port.js";
import { writeShutdownMarker } from "./shutdown-marker.js";

interface RuntimeLoops {
  stop(): void;
}

interface FlushableStateStore {
  flush(): Promise<void>;
  /**
   * daemon state ownership -- true ⇒ remote daemon mode (daemon owns session-domain
   * writes; server is a mirror). Used by the shutdown handler to
   * decide whether the post-shutdownAll flush is needed: remote =
   * skip (delegate dead post-detach + nothing to flush, daemon owns
   * sessions), in-process = required (must persist server-graceful
   * endReasons; failures must propagate so a stale state.json never
   * pairs with a graceful marker).
   */
  isSessionsReadOnly(): boolean;
}

interface DisposableProjectRuntime {
  dispose(): Promise<void>;
}

/**
 * Server SIGTERM handler dependency. Today the in-process PtyHost's
 * `shutdownAll()` kills every PTY and persists `server-graceful` end
 * reasons (see comment at the call site below).
 *
 * In daemon mode, `RemotePtyHost.shutdownAll()` MUST detach from the daemon
 * socket only -- not kill daemon-side PTYs. The intent is server graceful
 * shutdown WITHOUT taking the agent processes down. The dedicated
 * `parasor pty-host terminate-all` CLI does the destructive operation.
 */
interface DisposablePtyHost {
  shutdownAll(): Promise<void>;
}

interface StoppableIpcServer {
  stop(): Promise<void>;
}

interface ShutdownableService {
  shutdown(): void;
}

interface CreateShutdownHandlerDeps {
  appStateStore: FlushableStateStore;
  caffeinate?: ShutdownableService;
  configDir: string;
  ipcServer: StoppableIpcServer;
  processExit?: (code: number) => void;
  projectRuntime: DisposableProjectRuntime;
  ptyManager: DisposablePtyHost;
  removeRuntime?: (runtimeFile: string) => void;
  runtimeFile: string;
  runtimeLoops: RuntimeLoops;
  writeMarker?: (configDir: string) => void;
  /**
   * -- release the in-process AppState owner
   * (proper-lockfile + marker body) on graceful shutdown. Optional
   * because daemon mode (where the daemon owns the marker) and tests
   * pass `undefined`. Best-effort -- failures are swallowed.
   */
  releaseModeMarker?: () => Promise<void> | void;
}

export function createShutdownHandler({
  appStateStore,
  caffeinate,
  configDir,
  ipcServer,
  processExit = process.exit,
  projectRuntime,
  ptyManager,
  removeRuntime = removeRuntimeFile,
  runtimeFile,
  runtimeLoops,
  writeMarker = writeShutdownMarker,
  releaseModeMarker,
}: CreateShutdownHandlerDeps): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return () => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      runtimeLoops.stop();
      caffeinate?.shutdown();
      await projectRuntime.dispose();
      /*
       * -- flush server-owned domains (projects /
       * projectStates / serviceConfig) BEFORE shutdownAll detaches the
       * IPC delegate. In remote mode `appStateStore.flush()` ships the
       * latest snapshot through the live RemotePtyHost connection so
       * the daemon persists it before the socket goes away. Skipping
       * this step lets in-flight project / config writes evaporate on
       * SIGTERM. In in-process mode this is a no-op aside from draining
       * the debounce timer, harmless.
       */
      await appStateStore.flush();
      // Kill PTYs and mark each session as server-graceful (in-process
      // only -- RemotePtyHost.shutdownAll is detach-only because the
      // daemon owns session state). disposeAll() (which deletes
      // sessions outright) is NOT used here -- we want the sessions to
      // come back with scrollback on next start.
      await ptyManager.shutdownAll();
      /*
       * -- the post-shutdownAll flush is
       * REQUIRED in in-process mode (must persist server-graceful
       * endReasons before the marker; a swallowed failure pairs a
       * stale state.json with a graceful marker, mis-classifying
       * sessions as cleanly-ended on next boot). In remote mode the
       * IPC delegate is dead post-detach AND the daemon already owns
       * session-domain persistence -- so we skip the flush entirely
       * rather than catching a guaranteed-fail call.
       */
      if (!appStateStore.isSessionsReadOnly()) {
        await appStateStore.flush();
      }
      writeMarker(configDir);
      await ipcServer.stop();
      removeRuntime(runtimeFile);
      if (releaseModeMarker) {
        try {
          await releaseModeMarker();
        } catch {
          /* best-effort */
        }
      }
      processExit(0);
    })();

    return inFlight;
  };
}

export function registerShutdownSignals(
  shutdown: () => Promise<void>,
  register: typeof process.on = process.on.bind(process),
): void {
  register("SIGTERM", shutdown);
  register("SIGINT", shutdown);
  // Terminal close / parent shell exit. Without this, SIGHUP terminates
  // node before `releaseModeMarker()` runs and leaks
  // `appstate.mode.lock/` for up to the proper-lockfile stale window.
  register("SIGHUP", shutdown);
}
