import type {
  SessionCommand,
  SessionEndReason,
  TerminalLastSeen,
  WsTerminalClientMessage,
} from "@parasor/shared";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  HistoryLoadingIcon,
} from "../../../components/icons/index.js";
import { MobileKeyBar } from "../../../components/mobile/MobileKeyBar.js";
import {
  DEFAULT_RECONNECTING_OVERLAY_DELAY_MS,
  ReconnectingOverlay,
} from "../../../components/overlays/ReconnectingOverlay.js";
import { SessionErrorState } from "../../../components/overlays/SessionErrorState.js";
import { useTerminalSocket } from "../../../hooks/useTerminalSocket.js";
import { useVirtualKeyboard } from "../../../hooks/useVirtualKeyboard.js";
import { authFetch } from "../../../lib/auth-fetch.js";
import { extractImageFiles } from "../../../lib/clipboard-images.js";
import { openHttpUrlInNewTab } from "../../../lib/open-external-url.js";
import type { OpenUrlOptions } from "../../../lib/open-url-options.js";
import { isAutoResumable } from "../../../lib/session-resume.js";
import { useSettings } from "../../../lib/settings-context.js";
import { registerActiveTerminal } from "../../../lib/terminal-registry.js";
import {
  getTerminalReplayCache,
  setTerminalReplayCache,
  type TerminalReplayCacheEntry,
} from "../../../lib/terminal-replay-cache.js";
import {
  isTerminalTraceEnabled,
  registerTerminalBottomRowsSnapshotProvider,
  scheduleTerminalInputDiagnosticCapture,
  startTerminalMainThreadTrace,
  traceTerminalEvent,
  traceTerminalEventLazy,
} from "../../../lib/terminal-trace.js";
import { shouldOpenInEmbeddedBrowser } from "../../../lib/url-routing.js";
import {
  type OverlayPoint,
  type TerminalSelectionAction,
  type TerminalSelectionHandle,
  TerminalSelectionOverlay,
} from "./TerminalSelectionOverlay.js";
import { applyCtrlModifier } from "./terminal-ctrl-modifier.js";
import {
  isIosWebKit,
  isTouchDevice,
  resolveTerminalWebglEnabled,
} from "./terminal-environment.js";
import { createTerminalFileLinkProvider } from "./terminal-file-links.js";
import { useTerminalOutputPipeline } from "./terminal-output-pipeline.js";
import {
  attachWebglRendererAndFontAtlas,
  type TerminalRendererFontEvent,
} from "./terminal-renderer-fonts.js";
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchor,
} from "./terminal-scroll-anchor.js";
import {
  attachTerminalTapGestures,
  attachTerminalTouchSelection,
} from "./terminal-touch-gestures.js";
import {
  applyBoundarySelection,
  getSelectionPointFromHandleDrag,
  getTerminalSelectionRange,
  type TerminalSelectionRange,
} from "./terminal-touch-selection.js";
import {
  type TerminalRendererTrace,
  terminalBottomRowsTrace,
  terminalBufferTrace,
} from "./terminal-trace-snapshot.js";
import { useTerminalViewportLifecycle } from "./terminal-viewport-lifecycle.js";
import { useTerminalUploadInteractions } from "./useTerminalUploadInteractions.js";
import "@xterm/xterm/css/xterm.css";

const FOREGROUND_RECONNECTING_OVERLAY_DELAY_MS = 2500;
const FOREGROUND_RECONNECTING_GRACE_MS = 3000;

const INITIAL_HISTORY_LOAD_BYTES = 256 * 1024;
const MIN_NEXT_HISTORY_LOAD_BYTES = 512 * 1024;
const MAX_HISTORY_LOAD_BYTES = 4 * 1024 * 1024;
// After a viewport change shifts the buffer (keyboard open/close settling, or
// any applied resize) the viewport can momentarily land near the top, which
// would otherwise trip the scroll-to-top "load older history" path. Suppress
// that load for one window -- a single duration for every trigger so the
// coverage is symmetric whether or not the resize changed dimensions.
const HISTORY_LOAD_SUPPRESS_MS = 750;
const IME_DUPLICATE_SUPPRESS_MS = 120;
const TOOLBAR_SYNTHETIC_MOUSE_SUPPRESS_MS = 700;
const TERMINAL_INPUT_DIAGNOSTIC_DELAYS_MS = [80, 250] as const;
const TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY =
  "parasor:terminal-internal-clipboard";
const TERMINAL_UNICODE_VERSION = "11";

type SelectionOverlayState = {
  range: TerminalSelectionRange;
  toolbarAnchor: { clientX: number; clientY: number } | null;
  draggingHandle: TerminalSelectionHandle | null;
};

function isPrintableImeData(data: string): boolean {
  if (data.length === 0) return false;
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function writeTerminalInternalClipboard(text: string): boolean {
  try {
    window.localStorage.setItem(TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

function readTerminalInternalClipboard(): string | null {
  try {
    const text = window.localStorage.getItem(
      TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY,
    );
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function hasTerminalPasteCandidate(): boolean {
  return (
    readTerminalInternalClipboard() !== null || !!navigator.clipboard?.readText
  );
}

function createInitialRendererTrace(input: {
  requestedWebgl: boolean;
  isTouch: boolean;
  isIos: boolean;
  fontFamily: string;
  fontSize: number;
}): TerminalRendererTrace {
  return {
    requestedWebgl: input.requestedWebgl,
    effectiveRenderer: "dom",
    webglStatus: input.requestedWebgl ? "pending" : "disabled",
    contextLossCount: 0,
    fontLoadingDoneCount: 0,
    atlasRebuildCount: 0,
    iosFontPrefetchStatus: input.isIos ? "pending" : "not-ios",
    unicodeVersion: TERMINAL_UNICODE_VERSION,
    isTouch: input.isTouch,
    isIos: input.isIos,
    fontFamily: input.fontFamily,
    fontSize: input.fontSize,
  };
}

function getErrorName(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof err.name === "string" &&
    err.name.length > 0
  ) {
    return err.name;
  }
  return "unknown";
}

function pointToOverlayPosition(
  rangePoint: { col: number; row: number },
  term: XTerm,
  screenElement: Element,
  rootElement: HTMLElement,
): OverlayPoint | null {
  const screenRect = screenElement.getBoundingClientRect();
  const rootRect = rootElement.getBoundingClientRect();
  if (screenRect.width <= 0 || screenRect.height <= 0) return null;
  const cellWidth = screenRect.width / term.cols;
  const cellHeight = screenRect.height / term.rows;
  const viewportRow = rangePoint.row - term.buffer.active.viewportY;
  if (viewportRow < 0 || viewportRow >= term.rows) return null;
  const localLeft =
    screenRect.left - rootRect.left + rangePoint.col * cellWidth;
  const localTop =
    screenRect.top - rootRect.top + (viewportRow + 1) * cellHeight;
  return {
    left: clampNumber(localLeft, 0, rootRect.width),
    top: clampNumber(localTop, 0, rootRect.height),
  };
}

function getXtermScreenElement(
  term: XTerm,
  fallbackContainer: HTMLElement | null,
): Element | null {
  return (
    term.element?.querySelector(".xterm-screen") ??
    fallbackContainer?.querySelector(".xterm-screen") ??
    null
  );
}

function toolbarPositionFromAnchor(
  anchor: { clientX: number; clientY: number },
  rootElement: HTMLElement,
  toolbarWidth = 132,
): OverlayPoint {
  const rootRect = rootElement.getBoundingClientRect();
  const toolbarHeight = 40;
  const gap = 12;
  const padding = 8;
  const localX = anchor.clientX - rootRect.left;
  const localY = anchor.clientY - rootRect.top;
  const above = localY - toolbarHeight - gap;
  const below = localY + gap;

  return {
    left: clampNumber(
      localX - toolbarWidth / 2,
      padding,
      rootRect.width - toolbarWidth - padding,
    ),
    top: clampNumber(
      above >= padding ? above : below,
      padding,
      rootRect.height - toolbarHeight - padding,
    ),
  };
}

/**
 * Imperative handle exposed to parent components so mobile custom
 * keyboards, voice input, palette commands, etc. can inject bytes into
 * the PTY without reaching into xterm internals. Parent code holds a
 * ref and calls `paneRef.current.sendInput("\x1b")` for Esc, etc.
 * This is the input surface the editor pane will share once it lands.
 */
export interface PaneInputHandle {
  sendInput(data: string): void;
  focus(): void;
}

interface TerminalProps {
  sessionId: string;
  paneId?: string;
  /**
   * The project this terminal belongs to. Required for OS file-drop upload
   * -- the upload endpoint is `POST /api/projects/:id/drops`. Optional so
   * component tests can render a Terminal without wiring the whole session.
   */
  projectId?: string;
  sessionState?: "running" | "ended";
  sessionTitle?: string;
  sessionCommand?: SessionCommand;
  sessionEndReason?: SessionEndReason;
  onRestart?: () => void;
  onCloseSession?: () => void;
  onOpenUrl?: (url: string, options?: OpenUrlOptions) => void;
  worktreePath?: string;
  onOpenFilePath?: (filePath: string) => void;
}

export const Terminal = forwardRef<PaneInputHandle, TerminalProps>(
  function Terminal(
    {
      sessionId,
      paneId,
      projectId,
      sessionState = "running",
      sessionTitle,
      sessionCommand,
      sessionEndReason,
      onRestart,
      onCloseSession,
      onOpenUrl,
      worktreePath,
      onOpenFilePath,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const inputDiagnosticTimersRef = useRef<Set<number>>(new Set());
    const sendRef = useRef<((msg: WsTerminalClientMessage) => void) | null>(
      null,
    );
    const { contentFontSize, activeTheme, resolvedFontStack } = useSettings();
    const rendererTraceRef = useRef<TerminalRendererTrace | null>(null);
    const openUrlRef = useRef(onOpenUrl);
    const openFilePathRef = useRef(onOpenFilePath);
    const projectIdRef = useRef(projectId);
    const worktreePathRef = useRef(worktreePath);
    const [isReplayRestoring, setIsReplayRestoring] = useState(false);
    const replayRestoringRef = useRef(false);
    const pendingFullReplayViewportRef = useRef<ScrollAnchor | null>(null);
    const [historyLoadStatus, setHistoryLoadStatus] = useState<{
      sessionId: string;
      status: "hidden" | "ready" | "loading";
    }>({ sessionId, status: "hidden" });
    const visibleHistoryLoadStatus =
      historyLoadStatus.sessionId === sessionId
        ? historyLoadStatus.status
        : "hidden";
    const cachedReplayRef = useRef<{
      sessionId: string;
      entry: TerminalReplayCacheEntry | null;
    } | null>(null);
    const historyLoadRef = useRef({
      loading: false,
      maxBytes: INITIAL_HISTORY_LOAD_BYTES,
      exhausted: false,
      lastRequestedAt: 0,
    });
    const historyTopLoadArmedRef = useRef(false);
    const encoderRef = useRef<TextEncoder | null>(null);
    if (!encoderRef.current) encoderRef.current = new TextEncoder();
    if (cachedReplayRef.current?.sessionId !== sessionId) {
      cachedReplayRef.current = {
        sessionId,
        entry: getTerminalReplayCache(sessionId),
      };
      historyLoadRef.current = {
        loading: false,
        maxBytes: INITIAL_HISTORY_LOAD_BYTES,
        exhausted: false,
        lastRequestedAt: 0,
      };
      historyTopLoadArmedRef.current = false;
    }
    const pendingFullReplayCursorRef = useRef<TerminalLastSeen | null>(null);
    const scheduleInputDiagnostics = useCallback(
      (term: XTerm, dataLength: number, status: string) => {
        const buildEvent = (delayMs: number) => ({
          type: "terminal-input-diagnostic",
          sessionId,
          dataLength,
          status,
          cols: term.cols,
          rows: term.rows,
          cursorX: term.buffer.active.cursorX,
          cursorY: term.buffer.active.cursorY,
          viewportY: term.buffer.active.viewportY,
          baseY: term.buffer.active.baseY,
          delayMs,
        });

        scheduleTerminalInputDiagnosticCapture(
          "terminal-input-sent",
          buildEvent(0),
        );
        for (const delayMs of TERMINAL_INPUT_DIAGNOSTIC_DELAYS_MS) {
          const timer = window.setTimeout(() => {
            inputDiagnosticTimersRef.current.delete(timer);
            scheduleTerminalInputDiagnosticCapture(
              `terminal-input-after-${delayMs}ms`,
              buildEvent(delayMs),
            );
          }, delayMs);
          inputDiagnosticTimersRef.current.add(timer);
        }
      },
      [sessionId],
    );
    const handleReplayWriteComplete = useCallback(
      (data: string, term: XTerm) => {
        setIsReplayRestoring(false);
        replayRestoringRef.current = false;
        const lastSeen = pendingFullReplayCursorRef.current;
        pendingFullReplayCursorRef.current = null;
        const anchor = pendingFullReplayViewportRef.current;
        pendingFullReplayViewportRef.current = null;
        if (!anchor) {
          term.scrollToBottom();
          traceTerminalEvent("xterm-replay-scroll-restore", {
            sessionId,
            viewportY: term.buffer.active.viewportY,
            baseY: term.buffer.active.baseY,
            reason: "was-at-bottom",
          });
        } else {
          const restore = restoreScrollAnchor(term, anchor);
          traceTerminalEvent("xterm-replay-scroll-restore", {
            sessionId,
            viewportY: term.buffer.active.viewportY,
            baseY: term.buffer.active.baseY,
            previousViewportY: anchor.viewportY,
            previousBaseY: anchor.baseY,
            targetViewportY: restore.targetViewportY,
            reason: restore.reason,
          });
        }
        const byteLength =
          encoderRef.current?.encode(data).byteLength ?? data.length;
        historyLoadRef.current = {
          loading: false,
          maxBytes: Math.max(INITIAL_HISTORY_LOAD_BYTES, byteLength),
          exhausted: false,
          lastRequestedAt: 0,
        };
        setHistoryLoadStatus({
          sessionId,
          status: byteLength >= INITIAL_HISTORY_LOAD_BYTES ? "ready" : "hidden",
        });
        historyTopLoadArmedRef.current = false;
        if (!lastSeen) return;
        setTerminalReplayCache(sessionId, { data, lastSeen });
        cachedReplayRef.current = {
          sessionId,
          entry: getTerminalReplayCache(sessionId),
        };
        traceTerminalEvent("xterm-replay-cache-store", {
          sessionId,
          dataLength: data.length,
          generation: lastSeen.generation,
        });
      },
      [sessionId],
    );

    // An ended session that is safe to resume stays wired to the WS -- the
    // server will silently re-spawn on init and the pane keeps rendering
    // as a live terminal. An ended session that is NOT safe to resume
    // drops out to the error pane and never opens a WS.
    const showError =
      sessionState === "ended" &&
      !isAutoResumable(sessionCommand, sessionEndReason);

    useEffect(() => {
      openUrlRef.current = onOpenUrl;
    }, [onOpenUrl]);

    useEffect(() => {
      openFilePathRef.current = onOpenFilePath;
    }, [onOpenFilePath]);

    useEffect(() => {
      projectIdRef.current = projectId;
    }, [projectId]);

    useEffect(() => {
      worktreePathRef.current = worktreePath;
    }, [worktreePath]);

    const {
      firstDataTimerRef,
      hasReceivedDataRef,
      onData,
      onFullReplay,
      refreshVisibleRows,
      restoreExpandedReplay,
      restoreCachedReplay,
      resetOutputPipeline,
    } = useTerminalOutputPipeline({
      sessionId,
      xtermRef,
      sendRef,
      onReplayWriteComplete: handleReplayWriteComplete,
    });

    const handleFullReplay = useCallback(
      (lastSeen: TerminalLastSeen | null) => {
        setIsReplayRestoring(true);
        replayRestoringRef.current = true;
        const term = xtermRef.current;
        pendingFullReplayViewportRef.current = term
          ? captureScrollAnchor(term)
          : null;
        historyTopLoadArmedRef.current = false;
        pendingFullReplayCursorRef.current = lastSeen;
        onFullReplay();
      },
      [onFullReplay],
    );

    const loadOlderHistory = useCallback(async () => {
      const term = xtermRef.current;
      const encoder = encoderRef.current;
      if (!term || !encoder) return;
      if (replayRestoringRef.current) {
        traceTerminalEvent("terminal-history-load-suppressed", {
          sessionId,
          viewportY: term.buffer.active.viewportY,
          baseY: term.buffer.active.baseY,
          reason: "replay-restoring",
        });
        return;
      }
      const state = historyLoadRef.current;
      if (state.loading || state.exhausted) return;
      const now = performance.now();
      if (now - state.lastRequestedAt < 500) return;
      const nextMaxBytes = Math.min(
        Math.max(state.maxBytes * 2, MIN_NEXT_HISTORY_LOAD_BYTES),
        MAX_HISTORY_LOAD_BYTES,
      );
      if (nextMaxBytes <= state.maxBytes) {
        state.exhausted = true;
        setHistoryLoadStatus({ sessionId, status: "hidden" });
        return;
      }
      state.loading = true;
      state.lastRequestedAt = now;
      const replayAnchor = captureScrollAnchor(term);
      setHistoryLoadStatus({ sessionId, status: "loading" });
      traceTerminalEvent("terminal-history-load-start", {
        sessionId,
        maxBytes: nextMaxBytes,
        cols: term.cols,
        rows: term.rows,
      });
      try {
        const params = new URLSearchParams({
          cols: String(term.cols),
          rows: String(term.rows),
          maxBytes: String(nextMaxBytes),
        });
        const res = await authFetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/scrollback-snapshot?${params}`,
        );
        if (!res.ok) {
          traceTerminalEvent("terminal-history-load-failed", {
            sessionId,
            status: String(res.status),
            maxBytes: nextMaxBytes,
          });
          setHistoryLoadStatus({ sessionId, status: "ready" });
          return;
        }
        const data = (await res.json()) as {
          text?: unknown;
          replayBytes?: unknown;
          maxBytes?: unknown;
          hasMore?: unknown;
        };
        if (typeof data.text !== "string") return;
        const replayBytes =
          typeof data.replayBytes === "number"
            ? data.replayBytes
            : encoder.encode(data.text).byteLength;
        state.maxBytes =
          typeof data.maxBytes === "number" ? data.maxBytes : nextMaxBytes;
        state.exhausted =
          data.hasMore === false || state.maxBytes >= MAX_HISTORY_LOAD_BYTES;
        setHistoryLoadStatus({
          sessionId,
          status: state.exhausted ? "hidden" : "ready",
        });
        if (data.text.length === 0) return;
        restoreExpandedReplay(term, data.text, replayAnchor);
        const lastSeen = cachedReplayRef.current?.entry?.lastSeen ?? null;
        if (lastSeen) {
          setTerminalReplayCache(sessionId, { data: data.text, lastSeen });
          cachedReplayRef.current = {
            sessionId,
            entry: getTerminalReplayCache(sessionId),
          };
        }
        traceTerminalEvent("terminal-history-load-complete", {
          sessionId,
          dataLength: data.text.length,
          byteLength: replayBytes,
          maxBytes: state.maxBytes,
        });
      } catch (err) {
        setHistoryLoadStatus({ sessionId, status: "ready" });
        traceTerminalEvent("terminal-history-load-failed", {
          sessionId,
          status: err instanceof Error ? err.name : "unknown",
          maxBytes: nextMaxBytes,
        });
      } finally {
        state.loading = false;
      }
    }, [restoreExpandedReplay, sessionId]);

    const {
      send,
      sendInit,
      status: socketStatus,
      endedReason: socketEndedReason,
    } = useTerminalSocket({
      sessionId: showError ? null : sessionId,
      initialLastSeen: cachedReplayRef.current?.entry?.lastSeen ?? null,
      onData,
      onFullReplay: handleFullReplay,
    });
    sendRef.current = send;

    // A WS that the server closed with 1008 (Session not found /
    // unavailable / init expected) parks as `socketStatus === "ended"`.
    // Treating that as a terminal state here -- alongside the AppStore
    // sessionState path -- disables xterm input and flips the pane to
    // SessionErrorState immediately, without waiting for the session
    // event stream to also arrive. Without this, silent keystroke loss
    // happens whenever the event-store update is delayed or missing.
    const socketEnded = socketStatus === "ended";
    const isEnded = showError || socketEnded;

    useImperativeHandle(
      ref,
      () => ({
        sendInput: (data: string) => send({ type: "input", data }),
        focus: () => xtermRef.current?.focus(),
      }),
      [send],
    );

    const { height: kbHeight, settling: keyboardSettling } =
      useVirtualKeyboard();
    const keyboardSettlingRef = useRef(keyboardSettling);
    keyboardSettlingRef.current = keyboardSettling;
    const keyboardHistoryLoadSuppressUntilRef = useRef(0);
    const armHistoryLoadSuppression = useCallback(
      (reason: string) => {
        keyboardHistoryLoadSuppressUntilRef.current =
          performance.now() + HISTORY_LOAD_SUPPRESS_MS;
        traceTerminalEvent("terminal-history-load-suppress-window", {
          sessionId,
          reason,
          timeoutMs: HISTORY_LOAD_SUPPRESS_MS,
        });
      },
      [sessionId],
    );
    // Arm the window when the keyboard finishes settling (the deferred resize
    // flushes right after and shifts the viewport) rather than when settling
    // starts: during settling, `keyboardSettlingRef` already gates the load,
    // and anchoring to the settle edge gives the same coverage whether or not
    // the flush changes dimensions.
    const wasKeyboardSettlingRef = useRef(keyboardSettling);
    useEffect(() => {
      const wasSettling = wasKeyboardSettlingRef.current;
      wasKeyboardSettlingRef.current = keyboardSettling;
      if (wasSettling && !keyboardSettling) {
        armHistoryLoadSuppression("keyboard-settled");
      }
    }, [keyboardSettling, armHistoryLoadSuppression]);
    const suppressHistoryLoadAfterResize = useCallback(
      () => armHistoryLoadSuppression("resize-applied"),
      [armHistoryLoadSuppression],
    );
    const [isTouch] = useState<boolean>(() => isTouchDevice());
    const [isIos] = useState<boolean>(() =>
      isIosWebKit(navigator.userAgent, navigator.maxTouchPoints),
    );
    const [webglEnabled] = useState<boolean>(() =>
      resolveTerminalWebglEnabled(isTouch),
    );
    const [lastForegroundAtMs, setLastForegroundAtMs] = useState(0);
    const showKeyBar = isTouch && !isEnded;
    const [hasSelection, setHasSelection] = useState(false);
    const [selectionOverlay, setSelectionOverlay] =
      useState<SelectionOverlayState | null>(null);
    const selectionOverlayRef = useRef<SelectionOverlayState | null>(null);
    selectionOverlayRef.current = selectionOverlay;
    const [inputToolbarAnchor, setInputToolbarAnchor] = useState<{
      clientX: number;
      clientY: number;
    } | null>(null);
    const toolbarSyntheticMouseSuppressUntilRef = useRef(0);
    const [showScrollDown, setShowScrollDown] = useState(false);

    // Only accept drops once the PTY is attached. Before init-ack, send()
    // would queue silently, which makes the drop look accepted but nothing
    // reaches the pty until attach completes -- confusing state.
    // "reconnecting" is handled the same way: user should wait out
    // ReconnectingOverlay.
    const dropEnabled = !isEnded && socketStatus === "attached";
    const sendTerminalInput = useCallback(
      (data: string) => send({ type: "input", data }),
      [send],
    );
    const focusTerm = useCallback(() => xtermRef.current?.focus(), []);
    const {
      uploadState,
      isDragOver,
      dragOverlayLabel,
      runUpload,
      dropEnabledRef,
      runUploadRef,
      dragHandlers,
    } = useTerminalUploadInteractions({
      projectId,
      sessionId,
      dropEnabled,
      sendInput: sendTerminalInput,
      focusTerminal: focusTerm,
    });

    // Register this terminal as the "active insertion target" while the
    // xterm textarea has focus -- picked up by FileContextMenu's mobile
    // fallback path to route "Insert path" to the terminal the user last
    // interacted with.
    useEffect(() => {
      if (isEnded) return;
      const container = containerRef.current;
      if (!container) return;
      let unregister: (() => void) | null = null;
      const register = () => {
        unregister?.();
        unregister = registerActiveTerminal((data) =>
          send({ type: "input", data }),
        );
      };
      const onFocusIn = () => register();
      container.addEventListener("focusin", onFocusIn);
      if (container.contains(document.activeElement)) register();
      return () => {
        container.removeEventListener("focusin", onFocusIn);
        unregister?.();
      };
    }, [send, isEnded]);

    const commitSelectionOverlay = useCallback(
      (input: { clientX: number; clientY: number; showToolbar: boolean }) => {
        const term = xtermRef.current;
        const text = term?.getSelection() ?? "";
        const range = term ? getTerminalSelectionRange(term) : null;
        if (!text) {
          setSelectionOverlay(null);
          return;
        }
        if (!range) return;

        setHasSelection(true);
        setInputToolbarAnchor(null);
        setSelectionOverlay({
          range,
          toolbarAnchor: input.showToolbar
            ? { clientX: input.clientX, clientY: input.clientY }
            : null,
          draggingHandle: null,
        });

        traceTerminalEvent("terminal-selection-overlay-commit", {
          sessionId,
          dataLength: text.length,
          visible: input.showToolbar,
        });
      },
      [sessionId],
    );

    const handleToolbarActionEvent = useCallback(
      (input: {
        action: TerminalSelectionAction;
        eventType: string;
        deduped: boolean;
      }) => {
        if (!input.deduped) {
          toolbarSyntheticMouseSuppressUntilRef.current =
            performance.now() + TOOLBAR_SYNTHETIC_MOUSE_SUPPRESS_MS;
        }
        traceTerminalEvent("terminal-toolbar-action", {
          sessionId,
          surface: input.action,
          status: input.eventType,
          skipped: input.deduped,
        });
      },
      [sessionId],
    );

    const handleCopySelection = useCallback(async () => {
      const term = xtermRef.current;
      if (!term) return;
      const text = term.getSelection();
      if (!text) {
        traceTerminalEvent("terminal-toolbar-copy-skipped", {
          sessionId,
          reason: "empty-selection",
        });
        return;
      }

      traceTerminalEvent("terminal-toolbar-copy-attempt", {
        sessionId,
        dataLength: text.length,
      });

      const internalWritten = writeTerminalInternalClipboard(text);
      if (internalWritten) {
        traceTerminalEvent("terminal-toolbar-copy", {
          sessionId,
          status: "internal",
          dataLength: text.length,
        });
      } else {
        traceTerminalEvent("terminal-toolbar-copy-failed", {
          sessionId,
          status: "internal",
          reason: "local-storage-unavailable",
        });
      }

      const writeText = navigator.clipboard?.writeText;
      let nativeWritten = false;
      if (!writeText) {
        traceTerminalEvent("terminal-toolbar-copy-failed", {
          sessionId,
          status: "native",
          reason: "clipboard-api-unavailable",
        });
      } else {
        try {
          await writeText.call(navigator.clipboard, text);
          nativeWritten = true;
          traceTerminalEvent("terminal-toolbar-copy", {
            sessionId,
            status: "native",
            dataLength: text.length,
          });
        } catch (err) {
          traceTerminalEvent("terminal-toolbar-copy-failed", {
            sessionId,
            status: "native",
            reason: getErrorName(err),
          });
        }
      }

      if (!internalWritten && !nativeWritten) return;
      traceTerminalEvent("terminal-toolbar-copy-complete", {
        sessionId,
        dataLength: text.length,
      });
      term.clearSelection();
      setHasSelection(false);
      setSelectionOverlay(null);
      setInputToolbarAnchor(null);
    }, [sessionId]);

    const handlePasteFromTerminalToolbar = useCallback(async () => {
      const term = xtermRef.current;
      const readText = navigator.clipboard?.readText;
      const pasteText = (text: string, source: "native" | "internal") => {
        send({ type: "input", data: text });
        traceTerminalEvent("terminal-toolbar-paste", {
          sessionId,
          status: source,
          dataLength: text.length,
        });
        term?.clearSelection();
        setHasSelection(false);
        setSelectionOverlay(null);
        setInputToolbarAnchor(null);
      };

      try {
        if (readText) {
          const text = await readText.call(navigator.clipboard);
          if (text) {
            pasteText(text, "native");
            return;
          }
          traceTerminalEvent("terminal-toolbar-paste-skipped", {
            sessionId,
            status: "native",
            reason: "empty-clipboard",
          });
        } else {
          traceTerminalEvent("terminal-toolbar-paste-failed", {
            sessionId,
            status: "native",
            reason: "clipboard-api-unavailable",
          });
        }
      } catch (err) {
        traceTerminalEvent("terminal-toolbar-paste-failed", {
          sessionId,
          status: "native",
          reason: getErrorName(err),
        });
      }

      const internalText = readTerminalInternalClipboard();
      if (internalText) {
        pasteText(internalText, "internal");
        return;
      }

      traceTerminalEvent("terminal-toolbar-paste-failed", {
        sessionId,
        status: "internal",
        reason: "internal-clipboard-empty",
      });
    }, [send, sessionId]);

    const applySelectionHandleDrag = useCallback(
      (
        event: Pick<PointerEvent, "clientX" | "clientY">,
        showToolbar: boolean,
      ) => {
        const term = xtermRef.current;
        const screenElement = term
          ? getXtermScreenElement(term, containerRef.current)
          : null;
        const overlay = selectionOverlayRef.current;
        if (!term || !screenElement || !overlay?.draggingHandle) return;
        const focus = getSelectionPointFromHandleDrag(
          term,
          screenElement,
          event,
        );
        if (!focus) return;
        const fixed =
          overlay.draggingHandle === "start"
            ? overlay.range.end
            : overlay.range.start;
        const nextRange = applyBoundarySelection(term, fixed, focus);
        setHasSelection(true);
        setSelectionOverlay({
          range: nextRange,
          toolbarAnchor: showToolbar
            ? { clientX: event.clientX, clientY: event.clientY }
            : null,
          draggingHandle: showToolbar ? null : overlay.draggingHandle,
        });
      },
      [],
    );

    const handleSelectionHandlePointerDown = useCallback(
      (
        handle: TerminalSelectionHandle,
        event: ReactPointerEvent<HTMLButtonElement>,
      ) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setInputToolbarAnchor(null);
        setSelectionOverlay((prev) =>
          prev
            ? { ...prev, draggingHandle: handle, toolbarAnchor: null }
            : prev,
        );
      },
      [],
    );

    useEffect(() => {
      if (!selectionOverlay?.draggingHandle) return;
      const handlePointerMove = (event: PointerEvent) => {
        event.preventDefault();
        applySelectionHandleDrag(event, false);
      };
      const handlePointerUp = (event: PointerEvent) => {
        event.preventDefault();
        applySelectionHandleDrag(event, true);
      };
      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handlePointerUp, { passive: false });
      window.addEventListener("pointercancel", handlePointerUp, {
        passive: false,
      });
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }, [selectionOverlay?.draggingHandle, applySelectionHandleDrag]);

    // One-shot Ctrl modifier owned here so it can gate BOTH the key bar
    // path and the soft-keyboard path (xterm.onData). Ref mirrors state so
    // the capture inside term.onData (registered once on mount) always sees
    // the latest flag without re-binding.
    const [ctrlActive, setCtrlActive] = useState(false);
    const ctrlStickyRef = useRef(false);
    const imeDuplicateGateRef = useRef({
      composing: false,
      serial: 0,
      activeSerial: 0,
      suppressUntil: 0,
      lastSentText: "",
      lastSentAt: 0,
      lastSentSerial: -1,
    });
    const setCtrl = useCallback((v: boolean) => {
      ctrlStickyRef.current = v;
      setCtrlActive(v);
    }, []);
    const toggleCtrl = useCallback(
      () => setCtrl(!ctrlStickyRef.current),
      [setCtrl],
    );

    // Auto-clear a dangling Ctrl sticky on the open->close transition of the
    // on-screen keyboard. Without this, a user who pre-armed Ctrl and then
    // dismissed the keyboard would hit the next typing session already in
    // Ctrl mode and silently send a control code on their first keystroke.
    const keyboardOpen = kbHeight > 0;
    useEffect(() => {
      if (!keyboardOpen && ctrlStickyRef.current) setCtrl(false);
    }, [keyboardOpen, setCtrl]);

    const handleKeyboardToggle = useCallback(() => {
      const term = xtermRef.current;
      if (!term) return;
      // Prefer the textarea's own focus state over visualViewport: iOS
      // Safari inside PWAs / iframes sometimes skips the resize event, which
      // leaves `keyboardOpen` falsely at `false` and sends the toggle down
      // the focus branch (so tapping ⌨ while the keyboard is up does
      // nothing). `document.activeElement` is synchronously correct and
      // survives those viewport quirks.
      const textarea = term.textarea;
      const isFocused = !!textarea && document.activeElement === textarea;
      if (isFocused || keyboardOpen) {
        textarea?.blur();
      } else {
        term.focus();
      }
    }, [keyboardOpen]);

    const terminalConfigRef = useRef({
      fontFamily: resolvedFontStack,
      fontSize: contentFontSize,
      theme: activeTheme.terminal,
    });
    terminalConfigRef.current = {
      fontFamily: resolvedFontStack,
      fontSize: contentFontSize,
      theme: activeTheme.terminal,
    };
    if (rendererTraceRef.current) {
      rendererTraceRef.current.fontFamily = resolvedFontStack;
      rendererTraceRef.current.fontSize = contentFontSize;
    }
    const { attachViewportLifecycle, applyTerminalConfig } =
      useTerminalViewportLifecycle({
        sessionId,
        isEnded,
        terminalConfig: terminalConfigRef.current,
        xtermRef,
        fitRef,
        refreshVisibleRows,
        keyboardSettling,
        isTouch,
        firstDataTimerRef,
        hasReceivedDataRef,
        onResizeApplied: suppressHistoryLoadAfterResize,
        send,
        sendInit,
        setLastForegroundAtMs,
      });

    useEffect(() => {
      void sessionId;
      const container = containerRef.current;
      if (!container) return;
      const initialConfig = terminalConfigRef.current;
      rendererTraceRef.current = createInitialRendererTrace({
        requestedWebgl: webglEnabled,
        isTouch,
        isIos,
        fontFamily: initialConfig.fontFamily,
        fontSize: initialConfig.fontSize,
      });
      traceTerminalEvent("terminal-mount", { sessionId });
      const stopMainThreadTrace = startTerminalMainThreadTrace(sessionId);

      // Open a terminal link / tapped-URL: a loopback dev-server URL goes
      // through `App.openUrl`, which rewrites it to a host:port the viewer
      // device can actually reach before opening a new tab; every other URL
      // opens directly in a new tab. Shared by the web-links addon (mouse
      // hover -> click) and the touch tap-to-open hit-test below.
      const openUrlFromTerminal = (uri: string) => {
        const openUrl = openUrlRef.current;
        if (openUrl && shouldOpenInEmbeddedBrowser(uri)) {
          const terminalProjectId = projectIdRef.current;
          if (terminalProjectId) {
            openUrl(uri, { projectId: terminalProjectId });
          } else {
            openUrl(uri);
          }
        } else {
          openHttpUrlInNewTab(uri);
        }
      };
      const openFilePathFromTerminal = (filePath: string) => {
        openFilePathRef.current?.(filePath);
      };

      const term = new XTerm({
        fontFamily: initialConfig.fontFamily,
        fontSize: initialConfig.fontSize,
        disableStdin: isEnded,
        theme: initialConfig.theme,
        allowProposedApi: true,
        cursorStyle: "block",
        cursorBlink: !isEnded,
        // xterm's default is 1000. Keep a generous window so a multi-screen
        // build log stays scrollable, but avoid 50k-line buffers per pane --
        // they balloon heap on long-running tabs with multiple terminals.
        scrollback: 10000,
      });
      const bottomRowsSnapshotProvider = (rowCount?: number) =>
        xtermRef.current === term
          ? terminalBottomRowsTrace(
              term,
              rowCount,
              rendererTraceRef.current ?? undefined,
            )
          : null;
      let unregisterBottomRowsSnapshot =
        registerTerminalBottomRowsSnapshotProvider(bottomRowsSnapshotProvider, {
          sessionId,
          paneId,
        });
      const markBottomRowsSnapshotActive = () => {
        unregisterBottomRowsSnapshot();
        unregisterBottomRowsSnapshot =
          registerTerminalBottomRowsSnapshotProvider(
            bottomRowsSnapshotProvider,
            { sessionId, paneId },
          );
      };

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      /*
       * Unicode 11 wcwidth addon. The stock xterm wcwidth table predates
       * Unicode 11's widening of many East Asian / emoji codepoints to
       * wide (2-cell). Without this, mixed CJK/emoji lines drift a cell
       * per occurrence and box-drawing/TUIs misalign on CJK locales.
       */
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = TERMINAL_UNICODE_VERSION;
      term.loadAddon(
        new WebLinksAddon((_event, uri) => openUrlFromTerminal(uri)),
      );
      const fileLinkProviderDisposable = term.registerLinkProvider(
        createTerminalFileLinkProvider(
          (bufferLineNumber) =>
            term.buffer.active.getLine(bufferLineNumber - 1),
          () => worktreePathRef.current,
          openFilePathFromTerminal,
        ),
      );
      term.open(container);
      container.addEventListener("focusin", markBottomRowsSnapshotActive);
      traceTerminalEvent("xterm-open", { sessionId });
      const maybeTerm = term as XTerm & {
        onRender?: XTerm["onRender"];
        onCursorMove?: XTerm["onCursorMove"];
      };
      const renderDisposable =
        typeof maybeTerm.onRender === "function"
          ? maybeTerm.onRender(({ start, end }) => {
              traceTerminalEventLazy("xterm-render", () => ({
                sessionId,
                renderStart: start,
                renderEnd: end,
                ...terminalBufferTrace(term),
              }));
            })
          : { dispose: () => {} };
      const SYNCHRONIZED_CURSOR_REFRESH_MAX_WAIT_MS = 1200;
      let synchronizedCursorRefreshFrame: number | null = null;
      let synchronizedCursorRefreshStartedAt = 0;
      const cancelSynchronizedCursorRefresh = () => {
        if (synchronizedCursorRefreshFrame === null) return;
        cancelAnimationFrame(synchronizedCursorRefreshFrame);
        synchronizedCursorRefreshFrame = null;
      };
      const runSynchronizedCursorRefresh = () => {
        synchronizedCursorRefreshFrame = null;
        if (xtermRef.current !== term) return;
        if (
          term.modes.synchronizedOutputMode &&
          performance.now() - synchronizedCursorRefreshStartedAt <
            SYNCHRONIZED_CURSOR_REFRESH_MAX_WAIT_MS
        ) {
          synchronizedCursorRefreshFrame = requestAnimationFrame(
            runSynchronizedCursorRefresh,
          );
          return;
        }
        refreshVisibleRows(term);
      };
      const scheduleSynchronizedCursorRefresh = () => {
        if (synchronizedCursorRefreshFrame !== null) return;
        synchronizedCursorRefreshStartedAt = performance.now();
        synchronizedCursorRefreshFrame = requestAnimationFrame(
          runSynchronizedCursorRefresh,
        );
      };
      const cursorMoveDisposable =
        typeof maybeTerm.onCursorMove === "function"
          ? maybeTerm.onCursorMove(() => {
              traceTerminalEventLazy("xterm-cursor-move", () => ({
                sessionId,
                ...terminalBufferTrace(term),
              }));
              if (term.modes.synchronizedOutputMode) {
                scheduleSynchronizedCursorRefresh();
              }
            })
          : { dispose: () => {} };
      // Coalesce scroll-derived UI state into one update per frame. This
      // drives both older-history loading near the top and the restored
      // jump-to-bottom affordance when the user scrolls away from the tail.
      const HISTORY_LOAD_TOP_THRESHOLD_ROWS = 2;
      const SCROLL_DOWN_THRESHOLD_ROWS = 3;
      let pendingScrollFrame: number | null = null;
      const updateScrollState = () => {
        if (pendingScrollFrame !== null) return;
        pendingScrollFrame = requestAnimationFrame(() => {
          pendingScrollFrame = null;
          const buf = term.buffer.active;
          if (replayRestoringRef.current) {
            traceTerminalEvent("terminal-scroll-state", {
              sessionId,
              viewportY: buf.viewportY,
              baseY: buf.baseY,
              reason: "replay-restoring",
            });
            return;
          }
          setShowScrollDown(
            buf.baseY - buf.viewportY > SCROLL_DOWN_THRESHOLD_ROWS,
          );
          if (selectionOverlayRef.current) {
            setSelectionOverlay((prev) => (prev ? { ...prev } : prev));
          }
          traceTerminalEvent("terminal-scroll-state", {
            sessionId,
            viewportY: buf.viewportY,
            baseY: buf.baseY,
            deferred: keyboardSettlingRef.current,
            reason: historyTopLoadArmedRef.current ? "armed" : "observed",
          });
          if (buf.viewportY > HISTORY_LOAD_TOP_THRESHOLD_ROWS) {
            historyTopLoadArmedRef.current = true;
          } else if (historyTopLoadArmedRef.current) {
            if (
              keyboardSettlingRef.current ||
              performance.now() < keyboardHistoryLoadSuppressUntilRef.current
            ) {
              traceTerminalEvent("terminal-history-load-suppressed", {
                sessionId,
                viewportY: buf.viewportY,
                baseY: buf.baseY,
                reason: "keyboard-settle",
              });
              return;
            }
            historyTopLoadArmedRef.current = false;
            void loadOlderHistory();
          }
        });
      };
      const scrollDisposable = term.onScroll(updateScrollState);
      updateScrollState();
      // Shift+Enter -> ESC+CR. Chat TUIs (Claude Code etc) parse ESC+CR as
      // newline. preventDefault stops the hidden textarea from also receiving
      // a newline that would re-fire xterm.onData and submit the prompt.
      // IME guard: while composition is active (isComposing or legacy
      // keyCode=229), return false to also block xterm's default Enter->CR
      // path. xterm's CompositionHelper.keydown finalizes composition and
      // returns true for non-229 keys, which would otherwise convert Enter to
      // CR and submit the JP/CJK candidate as a prompt on browsers that fire
      // keydown before compositionend (e.g. Firefox).
      term.attachCustomKeyEventHandler((event) => {
        const composing =
          event.isComposing ||
          (event as KeyboardEvent & { keyCode?: number }).keyCode === 229;
        if (
          event.type === "keydown" &&
          event.key === "Enter" &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey
        ) {
          if (composing) return false;
          event.preventDefault();
          if (!isEnded) send({ type: "input", data: "\x1b\r" });
          return false;
        }
        return true;
      });
      const screenElement =
        term.element?.querySelector(".xterm-screen") ??
        container.querySelector(".xterm-screen");
      const cleanupTapGestures = attachTerminalTapGestures({
        term,
        container,
        screenElement,
      });

      const cleanupTouchSelection = attachTerminalTouchSelection({
        term,
        screenElement,
        openUrl: openUrlFromTerminal,
        openFilePath: openFilePathFromTerminal,
        getWorktreePath: () => worktreePathRef.current,
        onSelectionCleared: () => {
          setHasSelection(false);
          setSelectionOverlay(null);
          setInputToolbarAnchor(null);
        },
        onInputToolbarRequest: (anchor) => {
          if (!hasTerminalPasteCandidate()) return;
          setHasSelection(false);
          setSelectionOverlay(null);
          setInputToolbarAnchor(anchor);
        },
        onSelectionCommit: commitSelectionOverlay,
      });

      const selectionDisposable = term.onSelectionChange(() => {
        const selected = term.getSelection().length > 0;
        setHasSelection(selected);
        if (!selected) {
          setSelectionOverlay(null);
          setInputToolbarAnchor(null);
          return;
        }
        const range = getTerminalSelectionRange(term);
        if (range) {
          setSelectionOverlay((prev) => (prev ? { ...prev, range } : prev));
        }
      });

      const emitRendererTrace = (type: string) => {
        const renderer = rendererTraceRef.current;
        traceTerminalEvent(type, {
          sessionId,
          requestedWebgl: renderer?.requestedWebgl,
          effectiveRenderer: renderer?.effectiveRenderer,
          webglStatus: renderer?.webglStatus,
          webglFailureReason: renderer?.webglFailureReason,
          contextLossCount: renderer?.contextLossCount,
          fontLoadingDoneCount: renderer?.fontLoadingDoneCount,
          atlasRebuildCount: renderer?.atlasRebuildCount,
          iosFontPrefetchStatus: renderer?.iosFontPrefetchStatus,
          unicodeVersion: renderer?.unicodeVersion,
          isTouch: renderer?.isTouch,
          isIos: renderer?.isIos,
        });
      };
      const onRendererFontEvent = (event: TerminalRendererFontEvent) => {
        const renderer = rendererTraceRef.current;
        if (!renderer) return;
        switch (event.type) {
          case "webgl-skip":
            renderer.requestedWebgl = false;
            renderer.effectiveRenderer = "dom";
            renderer.webglStatus = "disabled";
            renderer.webglFailureReason = event.reason;
            emitRendererTrace("terminal-renderer-webgl-skip");
            break;
          case "webgl-attach":
            renderer.effectiveRenderer = "webgl";
            renderer.webglStatus = "attached";
            renderer.webglFailureReason = undefined;
            emitRendererTrace("terminal-renderer-webgl-attach");
            break;
          case "webgl-error":
            renderer.effectiveRenderer = "dom";
            renderer.webglStatus = "failed";
            renderer.webglFailureReason = event.reason;
            emitRendererTrace("terminal-renderer-webgl-error");
            break;
          case "webgl-context-loss":
            renderer.effectiveRenderer = "dom";
            renderer.webglStatus = "context-lost";
            renderer.contextLossCount += 1;
            emitRendererTrace("terminal-renderer-webgl-context-loss");
            break;
          case "font-loadingdone":
            renderer.fontLoadingDoneCount += 1;
            renderer.atlasRebuildCount += 1;
            renderer.fontFamily =
              term.options.fontFamily ?? terminalConfigRef.current.fontFamily;
            emitRendererTrace("terminal-renderer-font-loadingdone");
            break;
          case "ios-font-prefetch":
            renderer.iosFontPrefetchStatus = event.status;
            emitRendererTrace("terminal-renderer-ios-font-prefetch");
            break;
        }
      };
      const detachRendererFontAtlas = attachWebglRendererAndFontAtlas(term, {
        isIos,
        enableWebgl: webglEnabled,
        onEvent: onRendererFontEvent,
      });

      xtermRef.current = term;
      fitRef.current = fitAddon;
      resetOutputPipeline(false);
      const cachedReplay =
        cachedReplayRef.current?.entry ?? getTerminalReplayCache(sessionId);
      if (cachedReplay) {
        cachedReplayRef.current = { sessionId, entry: cachedReplay };
      }
      const restoreInitialCachedReplay = () => {
        if (cachedReplay) {
          restoreCachedReplay(term, cachedReplay.data);
        }
      };

      // Register onData outside commitInit so pre-init keystrokes are not
      // dropped while we wait for the container to report real dims (WebView,
      // slow layout). `useTerminalSocket.send()` queues frames until init
      // has been sent, so the payloads here are preserved and flushed in
      // order once sendInit lands.
      if (!isEnded) {
        term.onData((data) => {
          const now = performance.now();
          const imeGate = imeDuplicateGateRef.current;
          const inImeWindow = imeGate.composing || now <= imeGate.suppressUntil;
          const isImeText = isPrintableImeData(data);
          if (
            inImeWindow &&
            isImeText &&
            imeGate.lastSentSerial === imeGate.activeSerial &&
            imeGate.lastSentText === data &&
            now - imeGate.lastSentAt <= IME_DUPLICATE_SUPPRESS_MS
          ) {
            traceTerminalEvent("terminal-ime-duplicate-suppressed", {
              sessionId,
              dataLength: data.length,
              durationMs: Math.round((now - imeGate.lastSentAt) * 10) / 10,
              reason: "same-composition-text",
            });
            return;
          }
          if (inImeWindow && isImeText) {
            imeGate.lastSentText = data;
            imeGate.lastSentAt = now;
            imeGate.lastSentSerial = imeGate.activeSerial;
          }
          traceTerminalEvent("xterm-on-data", {
            sessionId,
            dataLength: data.length,
          });
          const out = ctrlStickyRef.current ? applyCtrlModifier(data) : data;
          const inputStatus = ctrlStickyRef.current ? "ctrl-modified" : "raw";
          if (ctrlStickyRef.current) setCtrl(false);
          traceTerminalEvent("terminal-send-input", {
            sessionId,
            dataLength: out.length,
          });
          send({ type: "input", data: out });
          scheduleInputDiagnostics(term, out.length, inputStatus);
        });
      }

      const cleanupViewportLifecycle = attachViewportLifecycle({
        container,
        term,
        fitAddon,
        onInitCommitted: restoreInitialCachedReplay,
      });

      // Drop any dangling Ctrl sticky the moment xterm's hidden textarea
      // loses focus. iOS "Done" dismisses the keyboard by blurring the
      // textarea, and visualViewport resize alone occasionally misses that
      // transition -- blur is the most direct signal that no soft-keyboard
      // input is coming next, so we key the clear off it as well.
      const textarea = term.textarea;
      const onImeCompositionStart = () => {
        const imeGate = imeDuplicateGateRef.current;
        imeGate.composing = true;
        imeGate.serial += 1;
        imeGate.activeSerial = imeGate.serial;
        imeGate.suppressUntil = 0;
        imeGate.lastSentText = "";
        imeGate.lastSentAt = 0;
        imeGate.lastSentSerial = -1;
      };
      const onImeCompositionEnd = () => {
        const imeGate = imeDuplicateGateRef.current;
        imeGate.composing = false;
        imeGate.suppressUntil = performance.now() + IME_DUPLICATE_SUPPRESS_MS;
      };
      const traceDomInputEvent = (event: Event) => {
        const inputEvent = event as InputEvent;
        traceTerminalEvent(`dom-${event.type}`, {
          sessionId,
          dataLength:
            typeof inputEvent.data === "string" ? inputEvent.data.length : 0,
          inputType:
            typeof inputEvent.inputType === "string"
              ? inputEvent.inputType
              : undefined,
          isComposing:
            typeof inputEvent.isComposing === "boolean"
              ? inputEvent.isComposing
              : undefined,
        });
      };
      const traceDomKeyEvent = (event: Event) => {
        const keyEvent = event as KeyboardEvent;
        traceTerminalEvent(`dom-${event.type}`, {
          sessionId,
          dataLength:
            typeof keyEvent.key === "string" ? keyEvent.key.length : 0,
          isComposing: keyEvent.isComposing,
        });
      };
      const traceTextareaFocusState = (event: Event) => {
        traceTerminalEvent(`dom-${event.type}`, {
          sessionId,
          surface: "xterm-textarea",
          visible: document.activeElement === textarea,
        });
      };
      const traceTerminalSurfaceEvent = (event: Event) => {
        traceTerminalEvent("terminal-surface-event", {
          sessionId,
          status: event.type,
          surface:
            event.target instanceof Element
              ? event.target.className.toString()
              : undefined,
          visible: document.activeElement === textarea,
          skipped: event.defaultPrevented,
        });
      };
      const suppressSyntheticMouseAfterToolbarAction = (event: Event) => {
        if (performance.now() > toolbarSyntheticMouseSuppressUntilRef.current) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        traceTerminalEvent("terminal-toolbar-synthetic-mouse-suppressed", {
          sessionId,
          status: event.type,
          surface:
            event.target instanceof Element
              ? event.target.className.toString()
              : undefined,
        });
      };
      const traceDomEvents = isTerminalTraceEnabled();
      screenElement?.addEventListener(
        "mousedown",
        suppressSyntheticMouseAfterToolbarAction,
        { capture: true },
      );
      screenElement?.addEventListener(
        "click",
        suppressSyntheticMouseAfterToolbarAction,
        { capture: true },
      );
      if (traceDomEvents) {
        textarea?.addEventListener("focus", traceTextareaFocusState);
        textarea?.addEventListener("blur", traceTextareaFocusState);
        textarea?.addEventListener("keydown", traceDomKeyEvent);
        textarea?.addEventListener("beforeinput", traceDomInputEvent);
        textarea?.addEventListener("input", traceDomInputEvent);
        textarea?.addEventListener("compositionstart", traceDomInputEvent);
        textarea?.addEventListener("compositionupdate", traceDomInputEvent);
        textarea?.addEventListener("compositionend", traceDomInputEvent);
        screenElement?.addEventListener(
          "pointerdown",
          traceTerminalSurfaceEvent,
          {
            capture: true,
          },
        );
        screenElement?.addEventListener(
          "pointerup",
          traceTerminalSurfaceEvent,
          {
            capture: true,
          },
        );
        screenElement?.addEventListener(
          "touchstart",
          traceTerminalSurfaceEvent,
          {
            capture: true,
          },
        );
        screenElement?.addEventListener("touchend", traceTerminalSurfaceEvent, {
          capture: true,
        });
        screenElement?.addEventListener(
          "mousedown",
          traceTerminalSurfaceEvent,
          {
            capture: true,
          },
        );
        screenElement?.addEventListener("click", traceTerminalSurfaceEvent, {
          capture: true,
        });
      }
      textarea?.addEventListener("compositionstart", onImeCompositionStart);
      textarea?.addEventListener("compositionend", onImeCompositionEnd);
      const onTextareaBlur = () => {
        const imeGate = imeDuplicateGateRef.current;
        imeGate.composing = false;
        imeGate.suppressUntil = 0;
        setCtrl(false);
      };
      textarea?.addEventListener("blur", onTextareaBlur);

      // Clipboard image paste: when the user hits ⌘V / Ctrl+V inside xterm
      // and the clipboard carries image data, upload via the same
      // `/api/projects/:id/drops` endpoint as OS-file DnD and inject the
      // returned absolute paths (POSIX single-quoted, space-joined). Text-
      // only paste falls through to xterm's default handling untouched.
      // iOS Safari may expose an empty `clipboardData.items` for image
      // paste -- `extractImageFiles` returns `[]` in that case and we also
      // fall through silently (no toast).
      const onPaste = (e: ClipboardEvent): void => {
        // Same gate as OS-file DnD: attached PTY + !isEnded. Otherwise let
        // xterm handle text fallback normally. Read via ref so socket
        // reconnect / runUpload identity changes do not re-run this effect.
        if (!dropEnabledRef.current) return;
        // serviceConfig.dropSizeMaxBytes is not available in this component
        // without a new store subscription -- rely on the server's 413 for
        // oversize instead.
        const images = extractImageFiles(e.clipboardData);
        if (images.length === 0) return;
        // Text+image combo: preventDefault the whole paste so binary
        // content doesn't get dumped into the pty.
        e.preventDefault();
        void runUploadRef.current(images);
      };
      textarea?.addEventListener("paste", onPaste);

      return () => {
        cleanupViewportLifecycle();
        cleanupTapGestures();
        cleanupTouchSelection();
        stopMainThreadTrace();
        screenElement?.removeEventListener(
          "mousedown",
          suppressSyntheticMouseAfterToolbarAction,
          { capture: true },
        );
        screenElement?.removeEventListener(
          "click",
          suppressSyntheticMouseAfterToolbarAction,
          { capture: true },
        );
        if (traceDomEvents) {
          textarea?.removeEventListener("focus", traceTextareaFocusState);
          textarea?.removeEventListener("blur", traceTextareaFocusState);
          textarea?.removeEventListener("keydown", traceDomKeyEvent);
          textarea?.removeEventListener("beforeinput", traceDomInputEvent);
          textarea?.removeEventListener("input", traceDomInputEvent);
          textarea?.removeEventListener("compositionstart", traceDomInputEvent);
          textarea?.removeEventListener(
            "compositionupdate",
            traceDomInputEvent,
          );
          textarea?.removeEventListener("compositionend", traceDomInputEvent);
          screenElement?.removeEventListener(
            "pointerdown",
            traceTerminalSurfaceEvent,
            { capture: true },
          );
          screenElement?.removeEventListener(
            "pointerup",
            traceTerminalSurfaceEvent,
            { capture: true },
          );
          screenElement?.removeEventListener(
            "touchstart",
            traceTerminalSurfaceEvent,
            { capture: true },
          );
          screenElement?.removeEventListener(
            "touchend",
            traceTerminalSurfaceEvent,
            { capture: true },
          );
          screenElement?.removeEventListener(
            "mousedown",
            traceTerminalSurfaceEvent,
            { capture: true },
          );
          screenElement?.removeEventListener(
            "click",
            traceTerminalSurfaceEvent,
            {
              capture: true,
            },
          );
        }
        textarea?.removeEventListener(
          "compositionstart",
          onImeCompositionStart,
        );
        textarea?.removeEventListener("compositionend", onImeCompositionEnd);
        textarea?.removeEventListener("blur", onTextareaBlur);
        textarea?.removeEventListener("paste", onPaste);
        for (const timer of inputDiagnosticTimersRef.current) {
          window.clearTimeout(timer);
        }
        inputDiagnosticTimersRef.current.clear();
        container.removeEventListener("focusin", markBottomRowsSnapshotActive);
        detachRendererFontAtlas();
        renderDisposable.dispose();
        cursorMoveDisposable.dispose();
        selectionDisposable.dispose();
        scrollDisposable.dispose();
        unregisterBottomRowsSnapshot();
        fileLinkProviderDisposable.dispose();
        if (pendingScrollFrame !== null) {
          cancelAnimationFrame(pendingScrollFrame);
          pendingScrollFrame = null;
        }
        cancelSynchronizedCursorRefresh();
        setHasSelection(false);
        setSelectionOverlay(null);
        setInputToolbarAnchor(null);
        resetOutputPipeline(true);
        term.dispose();
        xtermRef.current = null;
        fitRef.current = null;
        rendererTraceRef.current = null;
      };
    }, [
      attachViewportLifecycle,
      dropEnabledRef,
      isIos,
      isTouch,
      isEnded,
      loadOlderHistory,
      resetOutputPipeline,
      restoreCachedReplay,
      refreshVisibleRows,
      commitSelectionOverlay,
      send,
      scheduleInputDiagnostics,
      sessionId,
      paneId,
      setCtrl,
      runUploadRef,
      webglEnabled,
    ]);

    useEffect(() => {
      applyTerminalConfig();
    }, [applyTerminalConfig]);

    const reconnectingOverlayDelayMs =
      isTouch &&
      lastForegroundAtMs > 0 &&
      Date.now() - lastForegroundAtMs <= FOREGROUND_RECONNECTING_GRACE_MS
        ? FOREGROUND_RECONNECTING_OVERLAY_DELAY_MS
        : DEFAULT_RECONNECTING_OVERLAY_DELAY_MS;

    const selectionOverlayLayout = (() => {
      const term = xtermRef.current;
      const rootElement = rootRef.current;
      const overlay = selectionOverlay;
      if (!term || !rootElement || !overlay || !hasSelection) return null;
      const screenElement = getXtermScreenElement(term, containerRef.current);
      if (!screenElement) return null;
      return {
        startHandle: pointToOverlayPosition(
          overlay.range.start,
          term,
          screenElement,
          rootElement,
        ),
        endHandle: pointToOverlayPosition(
          overlay.range.end,
          term,
          screenElement,
          rootElement,
        ),
        toolbar:
          overlay.toolbarAnchor && !overlay.draggingHandle
            ? toolbarPositionFromAnchor(overlay.toolbarAnchor, rootElement, 72)
            : null,
      };
    })();
    const inputToolbarPosition =
      inputToolbarAnchor && rootRef.current
        ? toolbarPositionFromAnchor(inputToolbarAnchor, rootRef.current, 72)
        : null;

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: terminal pane owns drag-and-drop events for uploads.
      <div
        ref={rootRef}
        className="relative flex h-full w-full flex-col bg-bg-terminal"
        style={kbHeight > 0 ? { paddingBottom: kbHeight } : undefined}
        onDragEnter={dragHandlers.onDragEnter}
        onDragOver={dragHandlers.onDragOver}
        onDragLeave={dragHandlers.onDragLeave}
        onDrop={dragHandlers.onDrop}
      >
        {/*
         * Padding lives on this intermediate wrapper, not on containerRef.
         * containerRef is the parent FitAddon reads via getComputedStyle to
         * size cols/rows; putting padding there would over-count the
         * available column space (FitAddon only subtracts `.xterm`'s own
         * padding, not the parent's). The wrapper inherits `bg-bg-terminal`
         * -- same token fed into the xterm theme background -- so the padded
         * strip and the canvas share a color and no seam is visible.
         */}
        <div className="relative flex min-h-0 flex-1 flex-col px-1.5 pb-1">
          <div ref={containerRef} className="min-h-0 flex-1" />
          {visibleHistoryLoadStatus !== "hidden" && !isEnded && (
            <button
              type="button"
              aria-label={
                visibleHistoryLoadStatus === "loading"
                  ? "Loading older terminal history"
                  : "Load older terminal history"
              }
              disabled={visibleHistoryLoadStatus === "loading"}
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={() => {
                void loadOlderHistory();
              }}
              className="absolute left-1/2 top-3 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-bg-secondary/95 text-text-primary shadow-md transition-opacity hover:bg-bg-secondary active:bg-bg-tertiary disabled:opacity-60"
            >
              {visibleHistoryLoadStatus === "loading" ? (
                <HistoryLoadingIcon />
              ) : (
                <ChevronUpIcon />
              )}
            </button>
          )}
          {showScrollDown && (
            <button
              type="button"
              aria-label="Scroll to bottom"
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={() => xtermRef.current?.scrollToBottom()}
              className="absolute bottom-3 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-bg-secondary/95 text-text-primary shadow-md transition-opacity hover:bg-bg-secondary active:bg-bg-tertiary"
            >
              <ChevronDownIcon />
            </button>
          )}
        </div>
        {selectionOverlayLayout && (
          <TerminalSelectionOverlay
            startHandle={selectionOverlayLayout.startHandle}
            endHandle={selectionOverlayLayout.endHandle}
            toolbar={selectionOverlayLayout.toolbar}
            draggingHandle={selectionOverlay?.draggingHandle ?? null}
            onHandlePointerDown={handleSelectionHandlePointerDown}
            onCopy={() => {
              void handleCopySelection();
            }}
            onPaste={() => {
              void handlePasteFromTerminalToolbar();
            }}
            onActionEvent={handleToolbarActionEvent}
            pasteEnabled={false}
          />
        )}
        {inputToolbarPosition && (
          <TerminalSelectionOverlay
            startHandle={null}
            endHandle={null}
            toolbar={inputToolbarPosition}
            draggingHandle={null}
            copyEnabled={false}
            onHandlePointerDown={handleSelectionHandlePointerDown}
            onCopy={() => {
              void handleCopySelection();
            }}
            onPaste={() => {
              void handlePasteFromTerminalToolbar();
            }}
            onActionEvent={handleToolbarActionEvent}
          />
        )}
        {isDragOver && dropEnabled && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/30 ring-2 ring-inset ring-accent">
            <div className="rounded-window border border-border bg-bg-secondary/95 px-3 py-1.5 text-sm text-text-primary shadow-lg">
              {dragOverlayLabel}
            </div>
          </div>
        )}
        {uploadState.status !== "idle" && (
          <div className="pointer-events-none absolute right-2 top-2 z-10">
            <div
              className={[
                "rounded-window border px-2 py-1 text-xs shadow-sm",
                uploadState.status === "error"
                  ? "border-red-500/60 bg-red-500/10 text-red-400"
                  : "border-border bg-bg-secondary/95 text-text-primary",
              ].join(" ")}
            >
              {uploadState.status === "uploading"
                ? "Uploading..."
                : uploadState.status === "slow"
                  ? "Still uploading..."
                  : uploadState.message}
            </div>
          </div>
        )}
        {socketStatus === "reconnecting" && !isEnded && (
          <ReconnectingOverlay showDelayMs={reconnectingOverlayDelayMs} />
        )}
        {(socketStatus === "connecting" || socketStatus === "open") &&
          !isEnded && (
            <ReconnectingOverlay
              title="Connecting…"
              detail="checking session"
            />
          )}
        {isReplayRestoring && !isEnded && (
          <ReconnectingOverlay
            showDelayMs={250}
            title="Restoring…"
            detail="loading terminal history"
          />
        )}
        {showKeyBar && (
          <MobileKeyBar
            onSend={sendTerminalInput}
            ctrlActive={ctrlActive}
            onCtrlToggle={toggleCtrl}
            onAfterSend={focusTerm}
            keyboardOpen={keyboardOpen}
            onKeyboardToggle={handleKeyboardToggle}
            onAttachFiles={dropEnabled ? runUpload : undefined}
          />
        )}
        {showError ? (
          <SessionErrorState
            sessionTitle={sessionTitle ?? sessionId}
            command={sessionCommand}
            endReason={sessionEndReason}
            onRestart={() => onRestart?.()}
            onClose={() => onCloseSession?.()}
          />
        ) : socketEnded ? (
          <SessionErrorState
            sessionTitle={sessionTitle ?? sessionId}
            command={sessionCommand}
            endReason={sessionEndReason}
            socketDisconnectedReason={socketEndedReason}
            onClose={() => onCloseSession?.()}
          />
        ) : null}
      </div>
    );
  },
);
