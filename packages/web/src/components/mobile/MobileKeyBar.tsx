import { type ReactNode, useCallback, useRef } from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CirclePlusIcon,
  CornerDownLeftIcon,
  KeyboardIcon,
  KeyCtrlIcon,
  KeyEscIcon,
  KeyTabIcon,
} from "../icons/index.js";

/**
 * Soft-key bar for mobile terminal surfaces. Sends raw VT escape sequences
 * through the provided `onSend` -- same path xterm.onData uses -- so the PTY
 * sees keystrokes identical to a physical keyboard. Rendered by Terminal
 * only on touch devices; parent is responsible for positioning it above
 * the on-screen keyboard via padding-bottom on the pane wrapper.
 *
 * Information architecture:
 *   bar = 10 keys (Esc/Tab/Ctrl/Return/4 arrows + attach trigger + keyboard)
 *
 * Ctrl is a one-shot sticky modifier owned by the parent Terminal so the
 * same flag can also gate the soft-keyboard path (xterm.onData). The bar
 * only renders the toggle button and displays the active state.
 */
export interface MobileKeyBarProps {
  onSend: (data: string) => void;
  ctrlActive: boolean;
  onCtrlToggle: () => void;
  /**
   * Called after a key is sent so the parent can re-focus xterm and keep
   * the soft keyboard from collapsing on tap. Optional -- when omitted the
   * bar still works for TUI dialogs that don't need text input focus.
   */
  onAfterSend?: () => void;
  /**
   * Manual keyboard toggle. The bar reports tap intent; the parent decides
   * whether to focus xterm (opens the soft keyboard) or blur the textarea
   * (dismisses it). `keyboardOpen` feeds the icon/aria-pressed state.
   */
  keyboardOpen: boolean;
  onKeyboardToggle: () => void;
  /**
   * Forward attached files to the project drops endpoint. When undefined,
   * the attach trigger is disabled.
   */
  onAttachFiles?: (files: File[]) => void;
}

/** VT sequences for Ctrl-modified cursor keys (xterm application mode off). */
const CTRL_ARROWS: Record<string, string> = {
  "\x1b[A": "\x1b[1;5A",
  "\x1b[B": "\x1b[1;5B",
  "\x1b[C": "\x1b[1;5C",
  "\x1b[D": "\x1b[1;5D",
};

interface KeyDef {
  icon: ReactNode;
  seq: string;
  title: string;
}

interface IconKeyDef {
  icon: ReactNode;
  seq: string;
  title: string;
}

const KEYBAR_ICON_PROPS = { width: 20, height: 20 } as const;

const LEADING_KEYS: KeyDef[] = [
  { icon: <KeyEscIcon {...KEYBAR_ICON_PROPS} />, seq: "\x1b", title: "Escape" },
  { icon: <KeyTabIcon {...KEYBAR_ICON_PROPS} />, seq: "\t", title: "Tab" },
];

const ARROW_KEYS: IconKeyDef[] = [
  { icon: <ArrowUpIcon {...KEYBAR_ICON_PROPS} />, seq: "\x1b[A", title: "Up" },
  {
    icon: <ArrowDownIcon {...KEYBAR_ICON_PROPS} />,
    seq: "\x1b[B",
    title: "Down",
  },
  {
    icon: <ArrowLeftIcon {...KEYBAR_ICON_PROPS} />,
    seq: "\x1b[D",
    title: "Left",
  },
  {
    icon: <ArrowRightIcon {...KEYBAR_ICON_PROPS} />,
    seq: "\x1b[C",
    title: "Right",
  },
];

const BUTTON_BASE =
  "flex h-tap-lg min-w-0 flex-1 shrink items-center justify-center rounded-control px-1 text-sm active:bg-accent active:text-bg-primary";

export function MobileKeyBar({
  onSend,
  ctrlActive,
  onCtrlToggle,
  onAfterSend,
  keyboardOpen,
  onKeyboardToggle,
  onAttachFiles,
}: MobileKeyBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleKey = useCallback(
    (seq: string) => {
      const out = ctrlActive && CTRL_ARROWS[seq] ? CTRL_ARROWS[seq] : seq;
      onSend(out);
      if (ctrlActive) onCtrlToggle();
      onAfterSend?.();
    },
    [onSend, onAfterSend, ctrlActive, onCtrlToggle],
  );

  const handleFilesPicked = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) {
        onAttachFiles?.(Array.from(files));
      }
      onAfterSend?.();
    },
    [onAttachFiles, onAfterSend],
  );

  // preventDefault on pointerdown keeps xterm's hidden textarea focused so
  // mobile taps do not collapse the keyboard or clear terminal selection.
  const stealProof = (e: React.PointerEvent) => e.preventDefault();

  const attachDisabled = !onAttachFiles;
  const safeAreaPadding = keyboardOpen ? "" : "cm-safe-area-bottom-standalone";

  return (
    <>
      <div className={`w-full shrink-0 bg-bg-secondary ${safeAreaPadding}`}>
        <div className="flex h-bar w-full items-center gap-1 border-t border-border bg-bg-secondary px-1.5 py-0.5">
          {LEADING_KEYS.map((k) => (
            <button
              key={k.title}
              type="button"
              title={k.title}
              aria-label={k.title}
              onPointerDown={stealProof}
              onClick={() => handleKey(k.seq)}
              className={`${BUTTON_BASE} text-text-primary`}
            >
              {k.icon}
            </button>
          ))}
          <button
            key="ctrl"
            type="button"
            title="Ctrl (sticky -- next key)"
            aria-label="Ctrl"
            aria-pressed={ctrlActive}
            onPointerDown={stealProof}
            onClick={() => {
              onCtrlToggle();
              onAfterSend?.();
            }}
            className={`${BUTTON_BASE} ${
              ctrlActive ? "bg-accent text-bg-primary" : "text-text-primary"
            }`}
          >
            <KeyCtrlIcon {...KEYBAR_ICON_PROPS} />
          </button>
          <button
            key="return"
            type="button"
            title="Return"
            aria-label="Return"
            onPointerDown={stealProof}
            onClick={() => handleKey("\n")}
            className={`${BUTTON_BASE} text-text-primary`}
          >
            <CornerDownLeftIcon {...KEYBAR_ICON_PROPS} />
          </button>
          {ARROW_KEYS.map((k) => (
            <button
              key={k.title}
              type="button"
              title={k.title}
              aria-label={k.title}
              onPointerDown={stealProof}
              onClick={() => handleKey(k.seq)}
              className={`${BUTTON_BASE} text-text-primary`}
            >
              {k.icon}
            </button>
          ))}
          <button
            key="attach"
            type="button"
            title="Attach files"
            aria-label="Attach files"
            disabled={attachDisabled}
            onPointerDown={(e) => {
              // Keep xterm focused so opening the OS picker does not clear selection.
              e.preventDefault();
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`${BUTTON_BASE} text-text-primary disabled:opacity-40 disabled:active:bg-transparent`}
          >
            <CirclePlusIcon {...KEYBAR_ICON_PROPS} />
          </button>
          <button
            key="keyboard"
            type="button"
            title={keyboardOpen ? "Hide keyboard" : "Show keyboard"}
            aria-label={keyboardOpen ? "Hide keyboard" : "Show keyboard"}
            aria-pressed={keyboardOpen}
            onPointerDown={stealProof}
            onClick={onKeyboardToggle}
            className={`${BUTTON_BASE} ${
              keyboardOpen ? "bg-accent text-bg-primary" : "text-text-primary"
            }`}
          >
            <KeyboardIcon {...KEYBAR_ICON_PROPS} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          handleFilesPicked(e.target.files);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}
