import { useCallback, useRef, useState } from "react";
import { BottomSheet } from "../primitives/index.js";

/**
 * Soft-key bar for mobile terminal surfaces. Sends raw VT escape sequences
 * through the provided `onSend` -- same path xterm.onData uses -- so the PTY
 * sees keystrokes identical to a physical keyboard. Rendered by Terminal
 * only on touch devices; parent is responsible for positioning it above
 * the on-screen keyboard via padding-bottom on the pane wrapper.
 *
 * Information architecture:
 *   bar = 10 keys (Esc/Tab/Ctrl/Return/4 arrows + sheet trigger + keyboard)
 *   sheet = photo actions (Camera/Library)
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
   * Forward attached files to the project drops endpoint. When undefined
   * the camera/library rows in the sheet are disabled.
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
  glyph: KeyGlyphName;
  seq: string;
  title: string;
}

interface IconKeyDef {
  icon: LucideIconName;
  seq: string;
  title: string;
}

const LEADING_KEYS: KeyDef[] = [
  { glyph: "esc", seq: "\x1b", title: "Escape" },
  { glyph: "tab", seq: "\t", title: "Tab" },
];

const ARROW_KEYS: IconKeyDef[] = [
  { icon: "arrow-up", seq: "\x1b[A", title: "Up" },
  { icon: "arrow-down", seq: "\x1b[B", title: "Down" },
  { icon: "arrow-left", seq: "\x1b[D", title: "Left" },
  { icon: "arrow-right", seq: "\x1b[C", title: "Right" },
];

const BUTTON_BASE =
  "flex h-tap-lg min-w-0 flex-1 shrink items-center justify-center rounded-control px-1 text-sm active:bg-accent active:text-bg-primary";

const SHEET_ROW =
  "flex w-full items-center gap-3 px-5 py-3 text-left text-sm text-text-primary active:bg-row-hover-bg disabled:opacity-40 disabled:active:bg-transparent";

export function MobileKeyBar({
  onSend,
  ctrlActive,
  onCtrlToggle,
  onAfterSend,
  keyboardOpen,
  onKeyboardToggle,
  onAttachFiles,
}: MobileKeyBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  const dismissSheet = useCallback(() => setSheetOpen(false), []);

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
      dismissSheet();
      onAfterSend?.();
    },
    [onAttachFiles, dismissSheet, onAfterSend],
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
              <KeyGlyph name={k.glyph} />
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
            <KeyGlyph name="ctrl" />
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
            <LucideIcon name="corner-down-left" />
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
              <LucideIcon name={k.icon} />
            </button>
          ))}
          <button
            key="more"
            type="button"
            title="More actions"
            aria-label="More actions"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onPointerDown={(e) => {
              // Keep xterm focused so opening More does not clear selection.
              e.preventDefault();
            }}
            onClick={() => setSheetOpen(true)}
            className={`${BUTTON_BASE} text-text-primary`}
          >
            <LucideIcon name="circle-plus" />
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
            <LucideIcon name="keyboard" />
          </button>
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onDismiss={dismissSheet}
        manageFocus={false}
        ariaLabel="Mobile actions"
      >
        <div className="flex flex-col py-2">
          <button
            type="button"
            disabled={attachDisabled}
            onPointerDown={stealProof}
            onClick={() => cameraInputRef.current?.click()}
            className={SHEET_ROW}
          >
            <SheetIcon name="camera" />
            <span>Take Photo</span>
          </button>
          <button
            type="button"
            disabled={attachDisabled}
            onPointerDown={stealProof}
            onClick={() => libraryInputRef.current?.click()}
            className={SHEET_ROW}
          >
            <SheetIcon name="library" />
            <span>Photo Library</span>
          </button>
          <div className="mt-2 border-t border-border px-4 pt-3 pb-1">
            <button
              type="button"
              onPointerDown={stealProof}
              onClick={dismissSheet}
              className="flex h-tap-touch w-full items-center justify-center rounded-control border border-border text-sm text-text-primary active:bg-row-hover-bg"
            >
              Close
            </button>
          </div>
        </div>
      </BottomSheet>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => handleFilesPicked(e.target.files)}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFilesPicked(e.target.files)}
      />
    </>
  );
}

interface SheetIconProps {
  name: "camera" | "library";
}

type KeyGlyphName = "ctrl" | "esc" | "tab";

type LucideIconName =
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "circle-plus"
  | "corner-down-left"
  | "keyboard";

function LucideIcon({ name }: { name: LucideIconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: `lucide lucide-${name}`,
  };

  switch (name) {
    case "arrow-down":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...common}>
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      );
    case "circle-plus":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </svg>
      );
    case "corner-down-left":
      return (
        <svg {...common}>
          <path d="m9 10-5 5 5 5" />
          <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>
      );
    case "keyboard":
      return (
        <svg {...common}>
          <path d="M10 8h.01" />
          <path d="M12 12h.01" />
          <path d="M14 8h.01" />
          <path d="M16 12h.01" />
          <path d="M18 8h.01" />
          <path d="M6 8h.01" />
          <path d="M7 16h10" />
          <path d="M8 12h.01" />
          <rect width="20" height="16" x="2" y="4" rx="2" />
        </svg>
      );
  }
}

function KeyGlyph({ name }: { name: KeyGlyphName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 16 16",
    fill: "currentColor",
    "aria-hidden": true,
    className: `key-glyph key-glyph-${name}`,
  };

  switch (name) {
    case "esc":
      return (
        <svg {...common}>
          <path d="M12.8266 13.112C12.1639 13.112 11.6319 12.916 11.2306 12.524C10.8386 12.132 10.6426 11.614 10.6426 10.97V7.94595C10.6426 7.31129 10.8432 6.79795 11.2446 6.40595C11.6459 6.00462 12.1732 5.80396 12.8266 5.80396C13.2652 5.80396 13.6526 5.89262 13.9886 6.06995C14.3246 6.24729 14.5812 6.48529 14.7586 6.78395C14.9452 7.07329 15.0386 7.39529 15.0386 7.74996V7.88995C15.0386 7.98329 14.9919 8.02995 14.8986 8.02995L14.1846 8.05795C14.0912 8.05795 14.0446 8.01129 14.0446 7.91796V7.81995C14.0446 7.51195 13.9279 7.24595 13.6946 7.02195C13.4706 6.78862 13.1812 6.67196 12.8266 6.67196C12.4719 6.67196 12.1826 6.79796 11.9586 7.04996C11.7439 7.29262 11.6366 7.61462 11.6366 8.01595V10.9C11.6366 11.3013 11.7439 11.628 11.9586 11.88C12.1826 12.1226 12.4719 12.244 12.8266 12.244C13.1812 12.244 13.4706 12.132 13.6946 11.908C13.9279 11.6746 14.0446 11.404 14.0446 11.096V10.998C14.0446 10.9046 14.0912 10.858 14.1846 10.858L14.8986 10.872C14.9919 10.872 15.0386 10.9186 15.0386 11.012V11.166C15.0386 11.726 14.8332 12.1926 14.4226 12.566C14.0212 12.93 13.4892 13.112 12.8266 13.112Z" />
          <path d="M7.68824 13.0699C7.04424 13.0699 6.52624 12.9066 6.13424 12.5799C5.75158 12.2439 5.56024 11.8006 5.56024 11.2499V11.1519C5.56024 11.0586 5.60691 11.0119 5.70024 11.0119H6.37224C6.46558 11.0119 6.51224 11.0586 6.51224 11.1519V11.2359C6.51224 11.5346 6.61958 11.7866 6.83424 11.9919C7.05824 12.1973 7.34757 12.2999 7.70224 12.2999C8.03824 12.2999 8.30891 12.1973 8.51424 11.9919C8.71958 11.7866 8.82224 11.5253 8.82224 11.2079C8.82224 10.9653 8.75691 10.7646 8.62624 10.6059C8.49558 10.4379 8.34158 10.3073 8.16424 10.2139C7.99624 10.1206 7.73958 9.99928 7.39424 9.84995C7.03024 9.70061 6.72691 9.55595 6.48424 9.41595C6.25091 9.26661 6.04558 9.06128 5.86824 8.79995C5.70024 8.52928 5.61624 8.18861 5.61624 7.77795C5.61624 7.18061 5.79824 6.70928 6.16224 6.36395C6.53558 6.01861 7.03491 5.84595 7.66024 5.84595C8.29491 5.84595 8.79891 6.02328 9.17224 6.37795C9.54558 6.73261 9.73224 7.20395 9.73224 7.79195V7.83395C9.73224 7.92728 9.68558 7.97395 9.59224 7.97395H8.94824C8.85491 7.97395 8.80824 7.92728 8.80824 7.83395V7.74995C8.80824 7.43261 8.70091 7.17128 8.48624 6.96595C8.28091 6.76061 8.01024 6.65795 7.67424 6.65795C7.33824 6.65795 7.06758 6.76528 6.86224 6.97995C6.66624 7.18528 6.56824 7.44195 6.56824 7.74995C6.56824 7.97395 6.62891 8.16528 6.75024 8.32395C6.87158 8.47328 7.02091 8.59928 7.19824 8.70195C7.37557 8.79528 7.62291 8.91195 7.94024 9.05195C8.32291 9.21995 8.63558 9.37861 8.87824 9.52795C9.13024 9.67728 9.34958 9.88728 9.53624 10.1579C9.72291 10.4286 9.81624 10.7646 9.81624 11.1659C9.81624 11.7446 9.62491 12.2066 9.24224 12.5519C8.85958 12.8973 8.34157 13.0699 7.68824 13.0699Z" />
          <path d="M4.946 3.92795C4.946 4.02129 4.89933 4.06795 4.806 4.06795H1.558C1.52066 4.06795 1.502 4.08662 1.502 4.12395V7.59595C1.502 7.63328 1.52066 7.65195 1.558 7.65195H3.602C3.69533 7.65195 3.742 7.69862 3.742 7.79195V8.39395C3.742 8.48729 3.69533 8.53395 3.602 8.53395H1.558C1.52066 8.53395 1.502 8.55262 1.502 8.58995V12.076C1.502 12.1133 1.52066 12.132 1.558 12.132H4.806C4.89933 12.132 4.946 12.1786 4.946 12.272V12.86C4.946 12.9533 4.89933 13 4.806 13H0.647996C0.554662 13 0.507996 12.9533 0.507996 12.86V3.33995C0.507996 3.24662 0.554662 3.19995 0.647996 3.19995H4.806C4.89933 3.19995 4.946 3.24662 4.946 3.33995V3.92795Z" />
        </svg>
      );
    case "tab":
      return (
        <svg {...common}>
          <path d="M13.1244 5.80395C13.7124 5.80395 14.1837 5.99995 14.5384 6.39195C14.9024 6.77462 15.0844 7.29262 15.0844 7.94595V10.97C15.0844 11.6046 14.907 12.1226 14.5524 12.524C14.1977 12.916 13.7217 13.112 13.1244 13.112C12.8724 13.112 12.6297 13.0653 12.3964 12.972C12.163 12.8693 11.9577 12.72 11.7804 12.524C11.7617 12.5053 11.743 12.5006 11.7244 12.51C11.715 12.5193 11.7104 12.5333 11.7104 12.552V12.86C11.7104 12.9533 11.6637 13 11.5704 13H10.8564C10.763 13 10.7164 12.9533 10.7164 12.86V3.33995C10.7164 3.24662 10.763 3.19995 10.8564 3.19995H11.5704C11.6637 3.19995 11.7104 3.24662 11.7104 3.33995V6.36395C11.7104 6.38262 11.7197 6.39662 11.7384 6.40595C11.757 6.41528 11.7757 6.40595 11.7944 6.37795C11.9624 6.19128 12.163 6.05128 12.3964 5.95795C12.6297 5.85529 12.8724 5.80395 13.1244 5.80395ZM14.0904 8.01595C14.0904 7.61462 13.9784 7.29262 13.7544 7.04995C13.5304 6.79795 13.2364 6.67195 12.8724 6.67195C12.527 6.67195 12.247 6.79795 12.0324 7.04995C11.8177 7.29262 11.7104 7.61462 11.7104 8.01595V10.914C11.7104 11.306 11.8177 11.628 12.0324 11.88C12.247 12.1226 12.527 12.244 12.8724 12.244C13.2364 12.244 13.5304 12.1226 13.7544 11.88C13.9784 11.628 14.0904 11.306 14.0904 10.914V8.01595Z" />
          <path d="M7.42514 5.80396C8.07848 5.80396 8.60114 6.01862 8.99314 6.44795C9.38514 6.86795 9.58114 7.43262 9.58114 8.14196V12.86C9.58114 12.9533 9.53448 13 9.44114 13H8.72714C8.63381 13 8.58714 12.9533 8.58714 12.86V12.44C8.58714 12.4213 8.57781 12.412 8.55914 12.412C8.54981 12.4026 8.53581 12.4073 8.51714 12.426C8.17181 12.8833 7.65381 13.112 6.96314 13.112C6.44981 13.112 6.00181 12.9673 5.61914 12.678C5.24581 12.3793 5.05914 11.8566 5.05914 11.11C5.05914 10.3166 5.28781 9.73795 5.74514 9.37395C6.20248 9.00062 6.80448 8.81395 7.55114 8.81395H8.53114C8.56848 8.81395 8.58714 8.79529 8.58714 8.75796V8.21196C8.58714 7.74529 8.47981 7.37196 8.26514 7.09196C8.05048 6.81196 7.76114 6.67196 7.39714 6.67196C7.11714 6.67196 6.87448 6.76529 6.66914 6.95195C6.47314 7.13862 6.35648 7.37662 6.31914 7.66595C6.31914 7.75929 6.27248 7.80595 6.17914 7.80595L5.39514 7.79195C5.34848 7.79195 5.31114 7.77796 5.28314 7.74996C5.26448 7.72196 5.25981 7.68929 5.26914 7.65195C5.31581 7.10129 5.53981 6.65795 5.94114 6.32195C6.34248 5.97662 6.83714 5.80396 7.42514 5.80396ZM7.17314 12.244C7.55581 12.244 7.88714 12.1226 8.16714 11.88C8.44714 11.628 8.58714 11.2826 8.58714 10.844V9.66796C8.58714 9.63062 8.56848 9.61195 8.53114 9.61195H7.53714C7.08914 9.61195 6.73448 9.73329 6.47314 9.97596C6.21181 10.2093 6.08114 10.5593 6.08114 11.026C6.08114 11.4366 6.17914 11.7446 6.37514 11.95C6.58048 12.146 6.84648 12.244 7.17314 12.244Z" />
          <path d="M5.30601 3.19995C5.39935 3.19995 5.44601 3.24662 5.44601 3.33995V3.92795C5.44601 4.02129 5.39935 4.06795 5.30601 4.06795H3.45801C3.42068 4.06795 3.40201 4.08662 3.40201 4.12395V12.86C3.40201 12.9533 3.35535 13 3.26201 13H2.54801C2.45468 13 2.40801 12.9533 2.40801 12.86V4.12395C2.40801 4.08662 2.38935 4.06795 2.35201 4.06795H0.616013C0.52268 4.06795 0.476013 4.02129 0.476013 3.92795V3.33995C0.476013 3.24662 0.52268 3.19995 0.616013 3.19995H5.30601Z" />
        </svg>
      );
    case "ctrl":
      return (
        <svg {...common}>
          <path d="M13.2984 13C13.2051 13 13.1584 12.9533 13.1584 12.86V3.33995C13.1584 3.24662 13.2051 3.19995 13.2984 3.19995H14.0124C14.1057 3.19995 14.1524 3.24662 14.1524 3.33995V12.86C14.1524 12.9533 14.1057 13 14.0124 13H13.2984Z" />
          <path d="M12.1085 5.84595C12.3418 5.84595 12.5425 5.89728 12.7105 5.99995C12.7758 6.03728 12.7991 6.09795 12.7805 6.18195L12.6125 6.90995C12.6031 6.99395 12.5471 7.02195 12.4445 6.99395C12.3325 6.93795 12.1925 6.90995 12.0245 6.90995C11.9498 6.90995 11.8938 6.91461 11.8565 6.92395C11.5205 6.94261 11.2451 7.11995 11.0305 7.45595C10.8158 7.78261 10.7085 8.18395 10.7085 8.65995V12.8599C10.7085 12.9533 10.6618 12.9999 10.5685 12.9999H9.85448C9.76114 12.9999 9.71448 12.9533 9.71448 12.8599V6.05595C9.71448 5.96261 9.76114 5.91595 9.85448 5.91595H10.5685C10.6618 5.91595 10.7085 5.96261 10.7085 6.05595V6.89595C10.7085 6.92395 10.7131 6.93795 10.7225 6.93795C10.7411 6.93795 10.7598 6.92861 10.7785 6.90995C11.0491 6.20061 11.4925 5.84595 12.1085 5.84595Z" />
          <path d="M9.03406 6.51798C9.03406 6.61131 8.9874 6.65798 8.89406 6.65798H7.83006C7.79273 6.65798 7.77406 6.67664 7.77406 6.71398V10.998C7.77406 11.4273 7.84873 11.726 7.99806 11.894C8.1474 12.0526 8.37606 12.1273 8.68406 12.118H8.82406C8.9174 12.118 8.96406 12.1646 8.96406 12.258V12.86C8.96406 12.9533 8.9174 13 8.82406 13H8.47406C7.9234 13 7.5034 12.8833 7.21406 12.65C6.93406 12.4073 6.79406 11.9546 6.79406 11.292V6.71398C6.79406 6.67664 6.7754 6.65798 6.73806 6.65798H6.19206C6.09873 6.65798 6.05206 6.61131 6.05206 6.51798V6.05598C6.05206 5.96264 6.09873 5.91598 6.19206 5.91598H6.73806C6.7754 5.91598 6.79406 5.89731 6.79406 5.85998V4.29198C6.79406 4.19864 6.84073 4.15198 6.93406 4.15198H7.63406C7.7274 4.15198 7.77406 4.19864 7.77406 4.29198V5.85998C7.77406 5.89731 7.79273 5.91598 7.83006 5.91598H8.89406C8.9874 5.91598 9.03406 5.96264 9.03406 6.05598V6.51798Z" />
          <path d="M3.15002 13.112C2.43135 13.112 1.85269 12.8927 1.41402 12.454C0.984686 12.0153 0.77002 11.4273 0.77002 10.69V5.49601C0.77002 4.76801 0.984686 4.18468 1.41402 3.74601C1.85269 3.30735 2.43135 3.08801 3.15002 3.08801C3.87802 3.08801 4.45669 3.30735 4.88602 3.74601C5.32469 4.17535 5.54402 4.75868 5.54402 5.49601V5.73401C5.54402 5.82735 5.49735 5.87401 5.40402 5.87401L4.67602 5.91601C4.58269 5.91601 4.53602 5.86935 4.53602 5.77601V5.42601C4.53602 4.98735 4.41002 4.63268 4.15802 4.36201C3.90602 4.09135 3.57002 3.95601 3.15002 3.95601C2.73935 3.95601 2.40335 4.09135 2.14202 4.36201C1.89002 4.63268 1.76402 4.98735 1.76402 5.42601V10.774C1.76402 11.2127 1.89002 11.5673 2.14202 11.838C2.40335 12.1087 2.73935 12.244 3.15002 12.244C3.57002 12.244 3.90602 12.1087 4.15802 11.838C4.41002 11.5673 4.53602 11.2127 4.53602 10.774V10.424C4.53602 10.3307 4.58269 10.284 4.67602 10.284L5.40402 10.326C5.49735 10.326 5.54402 10.3727 5.54402 10.466V10.69C5.54402 11.4273 5.32469 12.0153 4.88602 12.454C4.44735 12.8927 3.86869 13.112 3.15002 13.112Z" />
        </svg>
      );
  }
}

function SheetIcon({ name }: SheetIconProps) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "camera":
      return (
        <svg {...common}>
          <path d="M3 7.5h2.5l1.5-2h6l1.5 2H17v8.5H3z" />
          <circle cx="10" cy="11.5" r="3" />
        </svg>
      );
    case "library":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="14" height="11" rx="1.5" />
          <path d="M3 12.5l3.5-3.5 3 3 3-2.5L17 13" />
          <circle cx="13" cy="7.5" r="1" />
        </svg>
      );
  }
}
