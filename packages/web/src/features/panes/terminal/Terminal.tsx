import type {
  SessionCommand,
  SessionEndReason,
  TerminalLastSeen,
  WsTerminalClientMessage,
} from "@parasor/shared";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import {
  forwardRef,
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
import type { OpenUrlOptions } from "../../../lib/open-url-options.js";
import { isAutoResumable } from "../../../lib/session-resume.js";
import { useSettings } from "../../../lib/settings-context.js";
import {
  startTerminalMainThreadTrace,
  traceTerminalEvent,
} from "../../../lib/terminal-trace.js";
import { TerminalExternalCopyDialog } from "./TerminalExternalCopyDialog.js";
import type { TerminalSelectionAction } from "./TerminalSelectionOverlay.js";
import { TerminalSelectionOverlays } from "./TerminalSelectionOverlays.js";
import { attachTerminalActiveRegistrationLifecycle } from "./terminal-active-registration-lifecycle.js";
import { attachTerminalBottomRowsSnapshotProvider } from "./terminal-bottom-rows-snapshot-provider.js";
import { attachTerminalDomLifecycle } from "./terminal-dom-lifecycle.js";
import {
  isIosWebKit,
  isTouchDevice,
  resolveTerminalWebglEnabled,
} from "./terminal-environment.js";
import { useTerminalHistoryLoadLifecycle } from "./terminal-history-load-lifecycle.js";
import { prepareInitialReplayRestore } from "./terminal-initial-replay.js";
import {
  attachTerminalDataInput,
  attachTerminalShiftEnterHandler,
} from "./terminal-input-lifecycle.js";
import { createTerminalInstance } from "./terminal-instance.js";
import { attachTerminalMountedInstance } from "./terminal-mounted-instance-lifecycle.js";
import { createTerminalOpenHandlers } from "./terminal-open-handlers.js";
import { useTerminalOutputPipeline } from "./terminal-output-pipeline.js";
import { attachTerminalRenderObservers } from "./terminal-render-observers.js";
import { attachTerminalRendererLifecycle } from "./terminal-renderer-lifecycle.js";
import { attachTerminalScrollState } from "./terminal-scroll-state.js";
import {
  getXtermScreenElement,
  resolveSelectionOverlayLayout,
  toolbarPositionFromAnchor,
} from "./terminal-selection-layout.js";
import { attachTerminalTextareaAdjunctLifecycle } from "./terminal-textarea-adjunct-lifecycle.js";
import { attachTerminalToolbarDismissLifecycle } from "./terminal-toolbar-dismiss-lifecycle.js";
import { attachTerminalTouchLifecycle } from "./terminal-touch-lifecycle.js";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";
import { useTerminalViewportLifecycle } from "./terminal-viewport-lifecycle.js";
import { useTerminalClipboardActions } from "./use-terminal-clipboard-actions.js";
import { useTerminalSelectionOverlay } from "./use-terminal-selection-overlay.js";
import { useTerminalUploadInteractions } from "./useTerminalUploadInteractions.js";
import "@xterm/xterm/css/xterm.css";

const FOREGROUND_RECONNECTING_OVERLAY_DELAY_MS = 2500;
const FOREGROUND_RECONNECTING_GRACE_MS = 3000;

const TOOLBAR_SYNTHETIC_MOUSE_SUPPRESS_MS = 700;
const TERMINAL_UNICODE_VERSION = "11";

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
    const lastDesktopInputClaimAtRef = useRef(Number.NEGATIVE_INFINITY);

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

    const { height: kbHeight, settling: keyboardSettling } =
      useVirtualKeyboard();
    const {
      cachedReplayRef,
      replayRestoringRef,
      keyboardSettlingRef,
      keyboardHistoryLoadSuppressUntilRef,
      historyTopLoadArmedRef,
      visibleHistoryLoadStatus,
      isReplayRestoring,
      loadOlderHistory: loadOlderHistoryWithRestore,
      startFullReplay,
      handleReplayWriteComplete,
      resolveInitialLastSeen,
      suppressHistoryLoadAfterResize,
    } = useTerminalHistoryLoadLifecycle({
      sessionId,
      xtermRef,
      keyboardSettling,
    });

    const {
      firstDataTimerRef,
      hasReceivedDataRef,
      onData,
      onFullReplay,
      refreshVisibleRows,
      restoreExpandedReplay,
      restoreCachedReplay,
      resetOutputPipeline,
      flushPendingOutput,
    } = useTerminalOutputPipeline({
      sessionId,
      xtermRef,
      sendRef,
      onReplayWriteComplete: handleReplayWriteComplete,
    });

    const handleFullReplay = useCallback(
      (lastSeen: TerminalLastSeen | null) =>
        startFullReplay(lastSeen, onFullReplay),
      [onFullReplay, startFullReplay],
    );

    const loadOlderHistory = useCallback(async () => {
      await loadOlderHistoryWithRestore(restoreExpandedReplay);
    }, [loadOlderHistoryWithRestore, restoreExpandedReplay]);

    const {
      send,
      sendInit,
      status: socketStatus,
      endedReason: socketEndedReason,
    } = useTerminalSocket({
      sessionId: showError ? null : sessionId,
      resolveInitialLastSeen,
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

    const [isTouch] = useState<boolean>(() => isTouchDevice());
    const [isIos] = useState<boolean>(() =>
      isIosWebKit(navigator.userAgent, navigator.maxTouchPoints),
    );
    const [webglEnabled] = useState<boolean>(() =>
      resolveTerminalWebglEnabled(isTouch),
    );
    const [lastForegroundAtMs, setLastForegroundAtMs] = useState(0);
    const showKeyBar = isTouch && !isEnded;
    const [inputToolbarAnchor, setInputToolbarAnchor] = useState<{
      clientX: number;
      clientY: number;
    } | null>(null);
    const inputToolbarAnchorRef = useRef<typeof inputToolbarAnchor>(null);
    inputToolbarAnchorRef.current = inputToolbarAnchor;
    const getSelectionScreenElement = useCallback(
      (term: XTerm) => getXtermScreenElement(term, containerRef.current),
      [],
    );
    const {
      hasSelection,
      setHasSelection,
      selectionOverlay,
      setSelectionOverlay,
      clearSelectionOverlay,
      commitSelectionOverlay,
      handleSelectionHandlePointerDown,
    } = useTerminalSelectionOverlay({
      sessionId,
      xtermRef,
      getScreenElement: getSelectionScreenElement,
      setInputToolbarAnchor,
    });
    const inputToolbarDismissSuppressUntilRef = useRef(0);
    const toolbarSyntheticMouseSuppressUntilRef = useRef(0);
    const [showScrollDown, setShowScrollDown] = useState(false);

    useEffect(() => {
      return attachTerminalToolbarDismissLifecycle({
        sessionId,
        inputToolbarAnchorRef,
        inputToolbarDismissSuppressUntilRef,
        setInputToolbarAnchor,
      });
    }, [sessionId]);

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
    const clearSelectionUi = useCallback(() => {
      clearSelectionOverlay();
      setInputToolbarAnchor(null);
    }, [clearSelectionOverlay]);
    const {
      externalCopyText,
      closeExternalCopyDialog,
      handleCopySelection,
      openExternalCopyDialog,
      copyExternalText,
      handlePasteFromTerminalToolbar,
    } = useTerminalClipboardActions({
      sessionId,
      xtermRef,
      send,
      clearSelectionUi,
    });
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
      return attachTerminalActiveRegistrationLifecycle({
        container,
        sendInput: (data) => send({ type: "input", data }),
      });
    }, [send, isEnded]);

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
    const { attachViewportLifecycle, applyTerminalConfig, claimViewport } =
      useTerminalViewportLifecycle({
        sessionId,
        isEnded,
        terminalConfig: terminalConfigRef.current,
        xtermRef,
        fitRef,
        refreshVisibleRows,
        flushPendingOutput,
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

      const openHandlers = createTerminalOpenHandlers({
        openUrlRef,
        openFilePathRef,
        projectIdRef,
        worktreePathRef,
      });

      const { term, fitAddon, fileLinkProviderDisposable } =
        createTerminalInstance({
          fontFamily: initialConfig.fontFamily,
          fontSize: initialConfig.fontSize,
          theme: initialConfig.theme,
          isEnded,
          unicodeVersion: TERMINAL_UNICODE_VERSION,
          openUrl: openHandlers.openUrl,
          getWorktreePath: openHandlers.getWorktreePath,
          openFilePath: openHandlers.openFilePath,
        });
      const bottomRowsSnapshot = attachTerminalBottomRowsSnapshotProvider({
        sessionId,
        paneId,
        term,
        getActiveTerm: () => xtermRef.current,
        rendererTraceRef,
      });

      term.open(container);
      container.addEventListener("focusin", bottomRowsSnapshot.markActive);
      traceTerminalEvent("xterm-open", { sessionId });
      const cleanupRenderObservers = attachTerminalRenderObservers({
        sessionId,
        term,
        getActiveTerm: () => xtermRef.current,
        refreshVisibleRows,
      });
      const cleanupScrollState = attachTerminalScrollState({
        sessionId,
        term,
        replayRestoringRef,
        keyboardSettlingRef,
        keyboardHistoryLoadSuppressUntilRef,
        historyTopLoadArmedRef,
        setShowScrollDown,
        refreshSelectionOverlayLayout: () => {
          setSelectionOverlay((prev) => (prev ? { ...prev } : prev));
        },
        loadOlderHistory,
      });
      attachTerminalShiftEnterHandler({
        term,
        isEnded,
        send,
      });
      const screenElement =
        term.element?.querySelector(".xterm-screen") ??
        container.querySelector(".xterm-screen");
      const cleanupTouchLifecycle = attachTerminalTouchLifecycle({
        sessionId,
        term,
        container,
        screenElement,
        openUrl: openHandlers.openUrl,
        openFilePath: openHandlers.openFilePath,
        getWorktreePath: openHandlers.getWorktreePath,
        inputToolbarDismissSuppressUntilRef,
        setHasSelection,
        setSelectionOverlay,
        setInputToolbarAnchor,
        onSelectionCommit: commitSelectionOverlay,
      });

      const detachRendererLifecycle = attachTerminalRendererLifecycle({
        sessionId,
        term,
        rendererTraceRef,
        getFallbackFontFamily: () => terminalConfigRef.current.fontFamily,
        isIos,
        enableWebgl: webglEnabled,
      });

      const mountedInstance = attachTerminalMountedInstance({
        term,
        fitAddon,
        xtermRef,
        fitRef,
        rendererTraceRef,
        resetOutputPipeline,
      });
      const restoreInitialCachedReplay = prepareInitialReplayRestore({
        sessionId,
        term,
        cachedReplayRef,
        restoreCachedReplay,
      });

      // Register onData outside commitInit so pre-init keystrokes are not
      // dropped while we wait for the container to report real dims (WebView,
      // slow layout). `useTerminalSocket.send()` queues frames until init
      // has been sent, so the payloads here are preserved and flushed in
      // order once sendInit lands.
      const cleanupTerminalDataInput = attachTerminalDataInput({
        enabled: !isEnded,
        sessionId,
        term,
        isTouch,
        send,
        setCtrl,
        ctrlStickyRef,
        imeDuplicateGateRef,
        lastDesktopInputClaimAtRef,
        inputDiagnosticTimersRef,
        claimViewport,
      });

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
      const cleanupDomLifecycle = attachTerminalDomLifecycle({
        sessionId,
        textarea,
        screenElement,
        toolbarSyntheticMouseSuppressUntilRef,
      });
      const cleanupTextareaAdjunctLifecycle =
        attachTerminalTextareaAdjunctLifecycle({
          textarea,
          imeDuplicateGateRef,
          inputDiagnosticTimersRef,
          dropEnabledRef,
          runUploadRef,
          setCtrl,
        });

      return () => {
        cleanupViewportLifecycle();
        cleanupTouchLifecycle();
        stopMainThreadTrace();
        cleanupDomLifecycle();
        cleanupTextareaAdjunctLifecycle();
        container.removeEventListener("focusin", bottomRowsSnapshot.markActive);
        detachRendererLifecycle();
        cleanupScrollState();
        bottomRowsSnapshot.dispose();
        fileLinkProviderDisposable.dispose();
        cleanupRenderObservers();
        setHasSelection(false);
        setSelectionOverlay(null);
        setInputToolbarAnchor(null);
        mountedInstance.resetOutputPipelineForUnmount();
        cleanupTerminalDataInput();
        mountedInstance.dispose();
      };
    }, [
      attachViewportLifecycle,
      cachedReplayRef,
      claimViewport,
      dropEnabledRef,
      historyTopLoadArmedRef,
      keyboardHistoryLoadSuppressUntilRef,
      keyboardSettlingRef,
      isIos,
      isTouch,
      isEnded,
      loadOlderHistory,
      resetOutputPipeline,
      replayRestoringRef,
      restoreCachedReplay,
      refreshVisibleRows,
      commitSelectionOverlay,
      send,
      sessionId,
      paneId,
      setCtrl,
      setHasSelection,
      setSelectionOverlay,
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
      return resolveSelectionOverlayLayout({
        term,
        rootElement,
        screenElement: term
          ? getXtermScreenElement(term, containerRef.current)
          : null,
        overlay,
        hasSelection,
      });
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
        <TerminalSelectionOverlays
          selectionLayout={selectionOverlayLayout}
          selectionDraggingHandle={selectionOverlay?.draggingHandle ?? null}
          inputToolbarPosition={inputToolbarPosition}
          externalCopyOpen={externalCopyText !== null}
          onHandlePointerDown={handleSelectionHandlePointerDown}
          onCopy={() => {
            void handleCopySelection();
          }}
          onCopyLongPress={openExternalCopyDialog}
          onPaste={() => {
            void handlePasteFromTerminalToolbar();
          }}
          onActionEvent={handleToolbarActionEvent}
        />
        <TerminalExternalCopyDialog
          open={externalCopyText !== null}
          text={externalCopyText ?? ""}
          isMobile={isTouch}
          onClose={closeExternalCopyDialog}
          onCopy={copyExternalText}
        />
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
