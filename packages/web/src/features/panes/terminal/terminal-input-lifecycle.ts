import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import { applyCtrlModifier } from "./terminal-ctrl-modifier.js";
import { scheduleTerminalInputDiagnostics } from "./terminal-input-diagnostics.js";

const IME_DUPLICATE_SUPPRESS_MS = 120;
const DESKTOP_INPUT_CLAIM_MIN_INTERVAL_MS = 1000;

type ImeDuplicateGate = {
  composing: boolean;
  serial: number;
  activeSerial: number;
  suppressUntil: number;
  lastSentText: string;
  lastSentAt: number;
  lastSentSerial: number;
};

type AttachTerminalDataInputArgs = {
  enabled: boolean;
  sessionId: string;
  term: XTerm;
  isTouch: boolean;
  send: (msg: { type: "input"; data: string }) => void;
  setCtrl: (value: boolean) => void;
  ctrlStickyRef: MutableRefObject<boolean>;
  imeDuplicateGateRef: MutableRefObject<ImeDuplicateGate>;
  lastDesktopInputClaimAtRef: MutableRefObject<number>;
  inputDiagnosticTimersRef: MutableRefObject<Set<number>>;
  claimViewport: (reason: "desktop-input") => void;
};

type AttachTerminalImeLifecycleArgs = {
  textarea: HTMLTextAreaElement | undefined;
  imeDuplicateGateRef: MutableRefObject<ImeDuplicateGate>;
  setCtrl: (value: boolean) => void;
};

type AttachTerminalShiftEnterHandlerArgs = {
  term: XTerm;
  isEnded: boolean;
  send: (msg: { type: "input"; data: string }) => void;
};

function isPrintableImeData(data: string): boolean {
  if (data.length === 0) return false;
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function attachTerminalDataInput({
  enabled,
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
}: AttachTerminalDataInputArgs): () => void {
  if (!enabled) return () => {};

  const disposable = term.onData((data) => {
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
    if (!isTouch) {
      const sinceLastClaim = now - lastDesktopInputClaimAtRef.current;
      if (sinceLastClaim >= DESKTOP_INPUT_CLAIM_MIN_INTERVAL_MS) {
        lastDesktopInputClaimAtRef.current = now;
        claimViewport("desktop-input");
      }
    }
    send({ type: "input", data: out });
    scheduleTerminalInputDiagnostics({
      sessionId,
      term,
      dataLength: out.length,
      status: inputStatus,
      timers: inputDiagnosticTimersRef.current,
    });
  });

  return () => disposable?.dispose?.();
}

export function attachTerminalShiftEnterHandler({
  term,
  isEnded,
  send,
}: AttachTerminalShiftEnterHandlerArgs): void {
  // Shift+Enter -> ESC+CR. Chat TUIs (Claude Code etc) parse ESC+CR as
  // newline. preventDefault stops the hidden textarea from also receiving a
  // newline that would re-fire xterm.onData and submit the prompt.
  // IME guard: while composition is active (isComposing or legacy keyCode=229),
  // return false to also block xterm's default Enter->CR path.
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
}

export function attachTerminalImeLifecycle({
  textarea,
  imeDuplicateGateRef,
  setCtrl,
}: AttachTerminalImeLifecycleArgs): () => void {
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
  const onTextareaBlur = () => {
    const imeGate = imeDuplicateGateRef.current;
    imeGate.composing = false;
    imeGate.suppressUntil = 0;
    setCtrl(false);
  };

  textarea?.addEventListener("compositionstart", onImeCompositionStart);
  textarea?.addEventListener("compositionend", onImeCompositionEnd);
  textarea?.addEventListener("blur", onTextareaBlur);

  return () => {
    textarea?.removeEventListener("compositionstart", onImeCompositionStart);
    textarea?.removeEventListener("compositionend", onImeCompositionEnd);
    textarea?.removeEventListener("blur", onTextareaBlur);
  };
}
