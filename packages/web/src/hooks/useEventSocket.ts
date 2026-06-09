import type {
  HydrationPayload,
  Project,
  ProjectSidebarState,
  WsEventEnvelope,
  WsEventMessage,
} from "@parasor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureAuthenticated } from "../lib/auth-fetch.js";
import { MIN_STABLE_MS, nextReconnectDelay } from "../lib/reconnect-backoff.js";
import {
  scheduleClientStartupDiagnosticCapture,
  traceTerminalEvent,
} from "../lib/terminal-trace.js";
import {
  type AppStore,
  applyEvent,
  applySnapshot,
  EMPTY_STORE,
  loadCachedStore,
  persistCachedStore,
} from "./event-reducers.js";

type HydrationPhase =
  | { state: "awaiting-snapshot"; buffer: WsEventEnvelope[] }
  | { state: "live"; lastAppliedSeq: number };

const MAX_BUFFER = 1000;
const CACHE_PERSIST_DEBOUNCE_MS = 500;
const SNAPSHOT_TIMEOUT_MS = 10_000;
/*
 * Browser JS cannot issue WS-protocol pings, so we run an app-layer
 * heartbeat to detect silent-dead TCP paths (NAT idle timeout, mobile
 * background freeze) where ws.close never fires. Mirrors the server-
 * side keepalive in `packages/server/src/index.ts` so a dead path is
 * detected within ~30s. Pong-timeout closes the socket, dropping into
 * the existing close->reconnect->OfflineBanner flow.
 */
const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;

async function readWebSocketText(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return null;
}

export function useEventSocket() {
  const [store, setStore] = useState<AppStore>(
    () => loadCachedStore() ?? EMPTY_STORE,
  );
  const [eventSocketConnected, setEventSocketConnected] = useState(false);
  const phaseRef = useRef<HydrationPhase>({
    state: "awaiting-snapshot",
    buffer: [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const reconnect = (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const active = wsRef.current;
      wsRef.current = null;
      phaseRef.current = { state: "awaiting-snapshot", buffer: [] };
      setEventSocketConnected(false);
      setStore((prev) => ({ ...prev, connected: false }));
      active?.close();

      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        void connect();
      }, delayMs);
    };
    const scheduleReconnect = (immediate: boolean) => {
      if (immediate) {
        reconnect(0);
        return;
      }
      attemptRef.current += 1;
      reconnect(nextReconnectDelay(attemptRef.current));
    };

    const connect = async () => {
      const connectStartedAt = performance.now();
      /*
       * WebSocket upgrades that fail on auth surface as a plain 401 HTTP
       * response that the browser never exposes to JS, so without this
       * preflight the client would burn reconnect attempts against a
       * backend that will never accept the socket. If the session is
       * gone, ensureAuthenticated already redirected to the expired
       * flow -- just bail.
       */
      const authStartedAt = performance.now();
      const authed = await ensureAuthenticated();
      const authDurationMs = performance.now() - authStartedAt;
      traceTerminalEvent("event-socket-auth-complete", {
        attempt: attemptRef.current,
        durationMs: authDurationMs,
        status: authed ? "ok" : "unauthenticated",
      });
      if (authed && authDurationMs >= 1000) {
        scheduleClientStartupDiagnosticCapture("event-socket-auth-slow", {
          type: "event-socket-auth-complete",
          attempt: attemptRef.current,
          durationMs: authDurationMs,
          status: "ok",
        });
      }
      if (!authed || !mountedRef.current) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws/events`);
      wsRef.current = ws;
      phaseRef.current = { state: "awaiting-snapshot", buffer: [] };

      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let pongDeadline: ReturnType<typeof setTimeout> | null = null;
      let snapshotDeadline: ReturnType<typeof setTimeout> | null = null;
      let established = false;
      // Wall-clock ms of the snapshot that established this socket; 0 until
      // then. The close handler uses it to tell a stable drop from a flap.
      let establishedAt = 0;
      let openedAt = 0;
      const clearPongDeadline = () => {
        if (pongDeadline !== null) {
          clearTimeout(pongDeadline);
          pongDeadline = null;
        }
      };
      const clearSnapshotDeadline = () => {
        if (snapshotDeadline !== null) {
          clearTimeout(snapshotDeadline);
          snapshotDeadline = null;
        }
      };
      const sendPing = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (pongDeadline !== null) return;
        try {
          ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        } catch {
          return;
        }
        pongDeadline = setTimeout(() => {
          pongDeadline = null;
          // Funnel into the existing close->reconnect path. The browser
          // may already consider the socket healthy; calling close()
          // forces the close listener to fire and `connected=false`
          // -> OfflineBanner grace timer to start.
          try {
            ws.close();
          } catch {
            // already closed
          }
        }, PONG_TIMEOUT_MS);
      };
      const onVisibility = () => {
        if (document.visibilityState !== "visible") return;
        sendPing();
      };
      const onFocus = () => sendPing();
      const onOnline = () => sendPing();
      const onPageShow = (event: PageTransitionEvent) => {
        // BFCache restore: any heartbeat the prior view started is now
        // dead; ping immediately so a half-open socket gets reaped at
        // the same cadence as a regular visibility return.
        if (event.persisted) sendPing();
      };
      const stopHeartbeat = () => {
        if (pingTimer !== null) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        clearPongDeadline();
        clearSnapshotDeadline();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("pageshow", onPageShow);
      };

      ws.addEventListener("open", () => {
        if (!mountedRef.current || wsRef.current !== ws) return;
        openedAt = performance.now();
        const durationMs = openedAt - connectStartedAt;
        traceTerminalEvent("event-socket-open", {
          attempt: attemptRef.current,
          durationMs,
        });
        if (durationMs >= 5000) {
          scheduleClientStartupDiagnosticCapture("event-socket-open-slow", {
            type: "event-socket-open",
            attempt: attemptRef.current,
            durationMs,
          });
        }
        attemptRef.current = 0;
        setEventSocketConnected(true);
        snapshotDeadline = setTimeout(() => {
          snapshotDeadline = null;
          scheduleClientStartupDiagnosticCapture(
            "event-socket-snapshot-timeout",
            {
              type: "event-socket-snapshot-timeout",
              attempt: attemptRef.current,
              timeoutMs: SNAPSHOT_TIMEOUT_MS,
              durationMs: performance.now() - connectStartedAt,
            },
          );
          try {
            ws.close();
          } catch {
            // already closed
          }
        }, SNAPSHOT_TIMEOUT_MS);
        pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onFocus);
        window.addEventListener("online", onOnline);
        window.addEventListener("pageshow", onPageShow);
      });

      const handleMessageText = (text: string) => {
        if (!mountedRef.current || wsRef.current !== ws) return;
        let raw: WsEventMessage | WsEventEnvelope;
        try {
          raw = JSON.parse(text) as WsEventMessage | WsEventEnvelope;
        } catch {
          return;
        }

        // Pong arrives unwrapped -- non-state heartbeat reply.
        if ("type" in raw && (raw as WsEventMessage).type === "pong") {
          clearPongDeadline();
          return;
        }

        // Snapshot arrives unwrapped
        if (
          "type" in raw &&
          (raw as WsEventMessage).type === "app-state-snapshot"
        ) {
          clearSnapshotDeadline();
          const snapshot = raw as {
            type: "app-state-snapshot";
            payload: HydrationPayload;
          };
          const snapshotDurationMs =
            openedAt > 0 ? performance.now() - openedAt : undefined;
          traceTerminalEvent("event-socket-snapshot", {
            attempt: attemptRef.current,
            ...(snapshotDurationMs !== undefined
              ? { durationMs: snapshotDurationMs }
              : {}),
            status: "ok",
          });
          if (snapshotDurationMs !== undefined && snapshotDurationMs >= 5000) {
            scheduleClientStartupDiagnosticCapture(
              "event-socket-snapshot-slow",
              {
                type: "event-socket-snapshot",
                attempt: attemptRef.current,
                durationMs: snapshotDurationMs,
                status: "ok",
              },
            );
          }
          const buffered =
            phaseRef.current.state === "awaiting-snapshot"
              ? phaseRef.current.buffer
              : [];

          let newStore = applySnapshot(snapshot.payload);
          const snapshotSeq = snapshot.payload.seq;
          let lastSeq = snapshotSeq;

          for (const envelope of buffered) {
            if (envelope.seq <= snapshotSeq) continue;
            newStore = applyEvent(newStore, envelope.message);
            lastSeq = envelope.seq;
          }

          established = true;
          establishedAt = Date.now();
          phaseRef.current = { state: "live", lastAppliedSeq: lastSeq };
          setStore(newStore);
          return;
        }

        // All other messages are wrapped in WsEventEnvelope
        const envelope = raw as WsEventEnvelope;
        const phase = phaseRef.current;

        if (phase.state === "awaiting-snapshot") {
          if (phase.buffer.length >= MAX_BUFFER) {
            scheduleReconnect(false);
            return;
          }
          phaseRef.current = {
            state: "awaiting-snapshot",
            buffer: [...phase.buffer, envelope],
          };
          return;
        }

        if (envelope.seq <= phase.lastAppliedSeq) return;

        if (envelope.seq > phase.lastAppliedSeq + 1) {
          scheduleReconnect(false);
          return;
        }

        phaseRef.current = { state: "live", lastAppliedSeq: envelope.seq };
        setStore((prev) => applyEvent(prev, envelope.message));
      };

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          handleMessageText(event.data);
          return;
        }
        void readWebSocketText(event.data).then((text) => {
          if (text === null) return;
          handleMessageText(text);
        });
      });

      ws.addEventListener("close", () => {
        stopHeartbeat();
        if (!mountedRef.current || wsRef.current !== ws) return;
        setEventSocketConnected(false);
        setStore((prev) => ({ ...prev, connected: false }));
        // Instant reconnect only for a connection that was stable a moment;
        // a sub-MIN_STABLE_MS flap takes the backoff branch.
        const stableEnough =
          established && Date.now() - establishedAt >= MIN_STABLE_MS;
        scheduleReconnect(stableEnough);
      });

      ws.addEventListener("error", () => {
        // close event will fire and handle reconnect
      });
    };

    void connect();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const cacheableStore = useMemo(
    () => ({
      ...EMPTY_STORE,
      projects: store.projects,
      projectStates: store.projectStates,
      sessions: store.sessions,
      agentStates: store.agentStates,
      gitStates: store.gitStates,
      paneCommands: store.paneCommands,
      ideCommands: store.ideCommands,
      hydrated: store.hydrated,
    }),
    [
      store.projects,
      store.projectStates,
      store.sessions,
      store.agentStates,
      store.gitStates,
      store.paneCommands,
      store.ideCommands,
      store.hydrated,
    ],
  );

  // Persist the cacheable subset (projects + projectStates + sessions +
  // agentStates + gitStates + launcher commands) to localStorage so the next
  // reload can paint the full sidebar two-line rows, pane layout, and command
  // launchers before the WebSocket snapshot arrives.
  useEffect(() => {
    if (!cacheableStore.hydrated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistCachedStore(cacheableStore);
    }, CACHE_PERSIST_DEBOUNCE_MS);
  }, [cacheableStore]);

  const markRead = useCallback((notificationId: string) => {
    setStore((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n,
      ),
    }));
  }, []);

  const clearPendingUrl = useCallback(() => {
    setStore((prev) => ({ ...prev, pendingOpenUrl: null }));
  }, []);

  // Optimistic local seed for newly-created project. The server's WS
  // broadcast may arrive after the HTTP response; without this seed the
  // pane model has no projectPath and the empty state flashes until WS
  // catches up. The reducer is idempotent on `project-created`, so the
  // duplicate broadcast is a no-op.
  const seedProject = useCallback((project: Project) => {
    setStore((prev) => applyEvent(prev, { type: "project-created", project }));
  }, []);

  const seedPaneCommands = useCallback((commands: AppStore["paneCommands"]) => {
    setStore((prev) => ({ ...prev, paneCommands: commands }));
  }, []);

  const seedIdeCommands = useCallback((commands: AppStore["ideCommands"]) => {
    setStore((prev) => ({ ...prev, ideCommands: commands }));
  }, []);

  const seedSidebarState = useCallback(
    (projectId: string, sidebar: ProjectSidebarState) => {
      setStore((prev) =>
        applyEvent(prev, {
          type: "sidebar-state-changed",
          projectId,
          sidebar,
        }),
      );
    },
    [],
  );

  const unreadCount = useMemo(
    () => store.notifications.filter((n) => !n.read).length,
    [store.notifications],
  );

  return {
    ...store,
    eventSocketConnected,
    unreadCount,
    markRead,
    clearPendingUrl,
    seedProject,
    seedPaneCommands,
    seedIdeCommands,
    seedSidebarState,
  };
}
