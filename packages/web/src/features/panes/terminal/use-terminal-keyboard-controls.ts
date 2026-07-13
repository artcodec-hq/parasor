import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type UseTerminalKeyboardControlsArgs = {
  kbHeight: number;
  xtermRef: RefObject<XTerm | null>;
};

type UseTerminalKeyboardControlsResult = {
  ctrlActive: boolean;
  ctrlStickyRef: RefObject<boolean>;
  keyboardOpen: boolean;
  setCtrl: (value: boolean) => void;
  toggleCtrl: () => void;
  handleKeyboardToggle: () => void;
};

export function useTerminalKeyboardControls({
  kbHeight,
  xtermRef,
}: UseTerminalKeyboardControlsArgs): UseTerminalKeyboardControlsResult {
  const [ctrlActive, setCtrlActive] = useState(false);
  const ctrlStickyRef = useRef(false);

  const setCtrl = useCallback((value: boolean) => {
    ctrlStickyRef.current = value;
    setCtrlActive(value);
  }, []);
  const toggleCtrl = useCallback(
    () => setCtrl(!ctrlStickyRef.current),
    [setCtrl],
  );

  const keyboardOpen = kbHeight > 0;
  useEffect(() => {
    if (!keyboardOpen && ctrlStickyRef.current) setCtrl(false);
  }, [keyboardOpen, setCtrl]);

  const handleKeyboardToggle = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    const textarea = term.textarea;
    const isFocused = !!textarea && document.activeElement === textarea;
    if (isFocused || keyboardOpen) {
      textarea?.blur();
    } else {
      term.focus();
    }
  }, [keyboardOpen, xtermRef]);

  return {
    ctrlActive,
    ctrlStickyRef,
    keyboardOpen,
    setCtrl,
    toggleCtrl,
    handleKeyboardToggle,
  };
}
