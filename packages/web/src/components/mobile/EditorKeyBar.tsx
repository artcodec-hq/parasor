import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineUp,
  insertTab,
  redo,
  undo,
} from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  KeyboardIcon,
  RedoIcon,
  UndoIcon,
} from "../icons/index.js";

/**
 * Soft-key bar for the mobile editor pane. Routes taps to CodeMirror
 * commands so the contenteditable receives the same effect a physical
 * keystroke would.
 *
 * 8 keys: Tab / Undo / Redo / ↑ / ↓ / ← / -> / ⌨️.
 *
 * Key glyphs come from the shared icon module so mobile terminal/editor
 * controls stay on the same 16px / 1px icon basis as the rest of the UI.
 */
export interface EditorKeyBarProps {
  view: EditorView | null;
  keyboardOpen: boolean;
  onKeyboardToggle: () => void;
}

interface KeyDef {
  label: ReactNode;
  cmd: (view: EditorView) => boolean;
  title: string;
}

const ACTION_KEYS: KeyDef[] = [
  { label: "Tab", cmd: insertTab, title: "Tab" },
  { label: <UndoIcon />, cmd: undo, title: "Undo" },
  { label: <RedoIcon />, cmd: redo, title: "Redo" },
];

const ARROW_KEYS: KeyDef[] = [
  { label: <ArrowUpIcon />, cmd: cursorLineUp, title: "Up" },
  { label: <ArrowDownIcon />, cmd: cursorLineDown, title: "Down" },
  { label: <ArrowLeftIcon />, cmd: cursorCharLeft, title: "Left" },
  { label: <ArrowRightIcon />, cmd: cursorCharRight, title: "Right" },
];

const BUTTON_BASE =
  "flex h-tap-lg min-w-[2.5rem] shrink-0 items-center justify-center rounded-control px-2 text-sm font-medium active:bg-accent active:text-bg-primary";

export function EditorKeyBar({
  view,
  keyboardOpen,
  onKeyboardToggle,
}: EditorKeyBarProps) {
  const runKey = (key: KeyDef) => {
    if (!view) return;
    key.cmd(view);
    if (!view.hasFocus) view.focus();
  };

  // preventDefault on pointerdown keeps the contenteditable focused so the
  // iOS soft keyboard does not collapse every time the user taps a key.
  const stealProof = (e: React.PointerEvent) => e.preventDefault();

  const divider = (
    <div
      aria-hidden
      className="mx-0.5 h-5 w-px shrink-0 self-center bg-border"
    />
  );
  const safeAreaPadding = keyboardOpen ? "" : "cm-safe-area-bottom-standalone";

  return (
    <div className={`w-full shrink-0 bg-bg-secondary ${safeAreaPadding}`}>
      <div className="flex h-tap-touch w-full items-center gap-1 border-t border-border bg-bg-secondary px-1.5">
        {ACTION_KEYS.map((k) => (
          <button
            key={k.title}
            type="button"
            title={k.title}
            aria-label={k.title}
            onPointerDown={stealProof}
            onClick={() => runKey(k)}
            className={`${BUTTON_BASE} text-text-primary`}
          >
            {k.label}
          </button>
        ))}
        {divider}
        {ARROW_KEYS.map((k) => (
          <button
            key={k.title}
            type="button"
            title={k.title}
            aria-label={k.title}
            onPointerDown={stealProof}
            onClick={() => runKey(k)}
            className={`${BUTTON_BASE} text-text-primary`}
          >
            {k.label}
          </button>
        ))}
        <button
          key="keyboard"
          type="button"
          title={keyboardOpen ? "Hide keyboard" : "Show keyboard"}
          aria-label={keyboardOpen ? "Hide keyboard" : "Show keyboard"}
          aria-pressed={keyboardOpen}
          onPointerDown={stealProof}
          onClick={onKeyboardToggle}
          className={`${BUTTON_BASE} ml-auto ${
            keyboardOpen ? "bg-accent text-bg-primary" : "text-text-primary"
          }`}
        >
          <KeyboardIcon />
        </button>
      </div>
    </div>
  );
}
