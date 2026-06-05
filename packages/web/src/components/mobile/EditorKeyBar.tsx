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
import type { ReactNode, SVGProps } from "react";

/**
 * Soft-key bar for the mobile editor pane. Routes taps to CodeMirror
 * commands so the contenteditable receives the same effect a physical
 * keystroke would.
 *
 * 8 keys: Tab / Undo / Redo / ↑ / ↓ / ← / -> / ⌨️.
 *
 * All glyphs share one inline-SVG style (24×24 viewBox, stroke 1.6) so the
 * Undo/Redo curves and arrow heads sit on the same optical baseline as the
 * keyboard icon. Mixing PaGlyph icons (12×12 viewBox, thin stroke) with
 * unicode arrows (font-dependent) made undo/redo feel undersized in the
 * earlier iteration.
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

const ICON_PROPS: SVGProps<SVGSVGElement> = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

const Undo = (
  <svg {...ICON_PROPS}>
    <path d="M8 6L4 10l4 4" />
    <path d="M4 10h10a4 4 0 0 1 4 4v4" />
  </svg>
);

const Redo = (
  <svg {...ICON_PROPS}>
    <path d="M16 6l4 4-4 4" />
    <path d="M20 10H10a4 4 0 0 0-4 4v4" />
  </svg>
);

const ArrowUp = (
  <svg {...ICON_PROPS}>
    <path d="M12 5v14" />
    <path d="M6 11l6-6 6 6" />
  </svg>
);

const ArrowDown = (
  <svg {...ICON_PROPS}>
    <path d="M12 5v14" />
    <path d="M6 13l6 6 6-6" />
  </svg>
);

const ArrowLeft = (
  <svg {...ICON_PROPS}>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </svg>
);

const ArrowRight = (
  <svg {...ICON_PROPS}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

const KeyboardIcon = (
  <svg {...ICON_PROPS}>
    <rect x="2" y="6" width="20" height="12" rx="1.6" />
    <path d="M6 11h0M10 11h0M14 11h0M18 11h0M7 15h10" />
  </svg>
);

const ACTION_KEYS: KeyDef[] = [
  { label: "Tab", cmd: insertTab, title: "Tab" },
  { label: Undo, cmd: undo, title: "Undo" },
  { label: Redo, cmd: redo, title: "Redo" },
];

const ARROW_KEYS: KeyDef[] = [
  { label: ArrowUp, cmd: cursorLineUp, title: "Up" },
  { label: ArrowDown, cmd: cursorLineDown, title: "Down" },
  { label: ArrowLeft, cmd: cursorCharLeft, title: "Left" },
  { label: ArrowRight, cmd: cursorCharRight, title: "Right" },
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
          {KeyboardIcon}
        </button>
      </div>
    </div>
  );
}
